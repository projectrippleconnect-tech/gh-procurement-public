'use client'

import {poNextStep} from '@/lib/purchasing-next-step.mjs'
import {DeliveryProgress} from './delivery-progress'
import {RejectionFollowup} from './rejection-followup'
import {receiptReview,pendingReceiptOrderIds} from '@/lib/receiving-guidance.mjs'

import {DeleteRecordButton} from './delete-record'

import {ModernSelect} from './modern-select'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useDangerConfirmation,useActionConfirmation,useTextPrompt} from './danger-confirmation'
import {businessDate,money,qty,itemTitle,whatsappUrl} from '@/lib/helpers'
import {exportPurchaseOrderPdf} from '@/lib/pdf'
import {PO_SHARE_FIELDS,defaultPoShareFields,resolvePoShareFields,buildPurchaseOrderText,buildPurchaseOrderCaption,createPurchaseOrderPng,downloadPurchaseOrderPng,sharePurchaseOrderPng} from '@/lib/po-share'
import {allRows} from '@/lib/query-pages'
import {StockSubmitAction,ItemLabel,Badge,ListPages,DataTable,configuredColumns,fieldEnabled,fieldLabel,Empty} from './ui'
import {InfoButton} from './help-ui'
import {PoBulkSend} from './po-bulk-send'
import {ReceiptOcr} from './receipt-ocr'
import {SupplierDocumentEditor} from './supplier-document-editor'
import {defaultSupplierTemplate,documentCompany,documentLines} from '@/lib/supplier-template.mjs'
import {remainingDelivery,receivingValue,poSendBlock} from '@/lib/procurement-flow'

export function PurchaseOrders({onOrderSelected=()=>{},activeView='po',initialFilter='',profile,fields,company,footer,flash,fail,can=()=>false,language='en',navigate=()=>{},t=(k,f)=>f||k}){
 const textPrompt=useTextPrompt()
 const[documentTemplate,setDocumentTemplate]=useState(()=>defaultSupplierTemplate('po'))
 useEffect(()=>{let live=true;const key='gh-po-document:'+profile.id;let local=null;try{local=JSON.parse(localStorage.getItem(key)||'null')}catch{}
  if(local)setDocumentTemplate({...defaultSupplierTemplate('po'),...local})
  else supabase.rpc('proc_supplier_document_settings_v1').then(({data,error})=>{if(live&&!error)setDocumentTemplate(current=>JSON.stringify(current)===JSON.stringify(defaultSupplierTemplate('po'))?{...defaultSupplierTemplate('po'),...data?.po}:current)})
  return()=>{live=false}
 },[profile.id])
 function changeDocumentTemplate(v){setDocumentTemplate(v);try{localStorage.setItem('gh-po-document:'+profile.id,JSON.stringify(v))}catch{}}
 const confirmAction=useActionConfirmation()
 const confirmDanger=useDangerConfirmation()
 const canEdit=can('procurement.orders.edit')
 const canApprove=can('procurement.orders.approve')
 const[rows,setRows]=useState([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[active,setActive]=useState(null),[lines,setLines]=useState([]),[filter,setFilter]=useState(['open','non_cancelled','overdue','pending_approval','approved','sent','partially_received','received','closed','cancelled'].includes(initialFilter)?initialFilter:'all'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[poMeta,setPoMeta]=useState({expected_date:'',terms:'',notes:''})
 const[shareFields,setShareFields]=useState(defaultPoShareFields),[shareReady,setShareReady]=useState(false),[shareBusy,setShareBusy]=useState(false),[linesReady,setLinesReady]=useState(false),[gateway,setGateway]=useState(null),[gatewayLoading,setGatewayLoading]=useState(false)
 const settingsKey='gh_po_supplier_fields_v1:'+String(profile?.id||'anonymous')
 useEffect(()=>{try{setShareFields(resolvePoShareFields(JSON.parse(localStorage.getItem(settingsKey)||'null')))}catch{setShareFields(defaultPoShareFields())}setShareReady(true)},[settingsKey])
 function changeShareField(key,value){const next={...shareFields,[key]:value};setShareFields(next);try{localStorage.setItem(settingsKey,JSON.stringify(next))}catch{flash('Fields updated for this session; this browser could not save the preference.')}}
 const shareArgs={po:active,lines:documentLines(lines,documentTemplate),company:documentCompany(company,documentTemplate),selection:shareFields}
 async function refreshPoGateway(poId=active?.id){
  setGateway(null);setGatewayLoading(true)
  if(!poId||!canEdit){setGatewayLoading(false);return}
  try{const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)return
   const response=await fetch('/api/integrations/whatsapp/po?poId='+encodeURIComponent(poId),{headers:{Authorization:'Bearer '+session.access_token}})
   const result=await response.json();if(opening.currentPoId===poId)setGateway(response.ok?result:{error:result.error})
  }catch{if(opening.currentPoId===poId)setGateway({error:'Could not check WhatsApp status.'})}finally{if(opening.currentPoId===poId)setGatewayLoading(false)}
 }
 async function exportPo(type){if(!linesReady||shareBusy)return;setShareBusy(true)
  try{
   if(type==='pdf')exportPurchaseOrderPdf({...shareArgs,footer})
   else if(type==='share'){
    const result=await sharePurchaseOrderPng(shareArgs)
    flash(result.shared
     ?'Share sheet opened. Choose WhatsApp and the correct supplier. Check the PNG and caption before sending; use Copy PO Caption if WhatsApp omits text.'
     :result.captionCopied
      ?'PO PNG downloaded and caption copied. Open the supplier chat, attach the saved PNG, paste the caption and send.'
      :'PO PNG downloaded. Use Copy PO Caption, open the supplier chat, attach the saved PNG and paste the caption.')
   }else await downloadPurchaseOrderPng(shareArgs)
  }catch(e){if(e?.name!=='AbortError')fail(e)}finally{setShareBusy(false)}
 }
 async function sendPoImage(){
  if(!active||!canEdit||shareBusy||!linesReady)return
  if(active.status!=='approved')return fail(new Error('Approve this purchase order before sending.'))
  if(!gateway?.connected||!gateway?.sendingEnabled)return fail(new Error('WhatsApp gateway must be linked and sending enabled. Use the PNG sharing fallback.'))
  if(gateway.dispatches?.length)return fail(new Error('A send attempt already exists. Check WhatsApp and its audit status before any resend.'))
  const edited=await textPrompt('Caption for '+active.supplier?.name,buildPurchaseOrderCaption(shareArgs));if(edited===null)return
  const caption=edited.trim();if(!caption||caption.length>2000)return fail(new Error('Caption must contain 1–2000 characters.'))
  if(!await confirmAction('Send this purchase-order image and caption to '+active.supplier?.name+' ('+(active.supplier?.whatsapp||active.supplier?.phone)+')?'))return
  setShareBusy(true)
  try{const png=await createPurchaseOrderPng(shareArgs);if(png.blob.size>4_500_000)throw new Error('Image is too large for WhatsApp gateway. Use PDF or fewer fields.')
   const pngBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read PO image.'));reader.readAsDataURL(png.blob)})
   const {data:{session}}=await supabase.auth.getSession();if(!session?.access_token)throw new Error('Sign in again before sending.')
   const response=await fetch('/api/integrations/whatsapp/po',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({poId:active.id,pngBase64,caption})})
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not send purchase-order image.')
   flash('WhatsApp gateway accepted the PO image + caption. Check WhatsApp before confirming Sent.')
  }catch(e){fail(e)}finally{setShareBusy(false);await refreshPoGateway(active.id)}
 }
 const batchIds=initialFilter.startsWith('batch:')?initialFilter.slice(6).split(',').filter(id=>/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)):[]
 const batchKey=batchIds.join(',')
 const [orderTab,setOrderTab]=useState(()=>batchIds.length?'selected':'general')
 function changeOrderTab(next){opening.current++;opening.currentPoId=null;setActive(null);setLines([]);setLinesReady(false);setPage(0);setOrderTab(next)}
 const pageSize=20
 const opening=useRef(0)
 const listRequest=useRef(0)
 const load=useCallback(async()=>{
  const request=++listRequest.current
  let q=supabase.from('proc_purchase_orders').select('*,proc_po_is_company,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)',{count:'exact'}).order('created_at',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1)
  if(orderTab==='selected'&&batchKey)q=q.in('id',batchKey.split(','))
  else q=q.eq('proc_po_is_company',orderTab==='company')
  if(filter==='open')q=q.in('status',['pending_approval','approved','sent','partially_received'])
  else if(filter==='non_cancelled')q=q.neq('status','cancelled')
  else if(filter==='overdue')q=q.lt('expected_date',businessDate()).in('status',['sent','partially_received'])
  else if(filter!=='all')q=q.eq('status',filter)
  const r=await q
  if(request!==listRequest.current)return
  if(r.error)fail(r.error);else{setRows(r.data||[]);setTotal(r.count||0)}
 },[filter,page,fail,batchKey,orderTab])
 useEffect(()=>{if(activeView==='po')load()},[load,activeView])
 useEffect(()=>{setPage(0)},[filter])
 useEffect(()=>{if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(initialFilter))return;let cancelled=false;(async()=>{const r=await supabase.from('proc_purchase_orders').select('*,proc_po_is_company,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)').eq('id',initialFilter).single();if(cancelled)return;if(r.error)return fail(r.error);void open(r.data)})();return()=>{cancelled=true}},[initialFilter,fail])

 async function open(po){
  const request=++opening.current
  opening.currentPoId=po.id;setLines([]);setLinesReady(false);setGateway(null);refreshPoGateway(po.id)
  if(orderTab!=='selected')setOrderTab(po.company_id||po.proc_po_is_company?'company':'general')
  onOrderSelected(po.id);setActive(po);setPoMeta({expected_date:po.expected_date||'',terms:po.terms||'',notes:po.notes||''})
  const r=await allRows(()=>supabase.from('proc_po_lines').select('*,item:proc_items(item_code,description,size,uom,colour,variation,brand),grn:proc_grn_lines(accepted_qty,receipt:proc_grns(status)),balance_actions:proc_po_balance_actions(action,reason,released_qty,created_at)').eq('po_id',po.id).order('id'))
  if(request!==opening.current)return
  if(r.error)fail(r.error);else {setLines(r.data||[]);setLinesReady(true)}
 }
 async function saveMeta(){
  if(!active||!canEdit)return
  setBusy(true)
  const patch={expected_date:poMeta.expected_date||null,notes:poMeta.notes||null}
  if(active.status==='pending_approval')patch.terms=poMeta.terms||null
  const r=await supabase.from('proc_purchase_orders').update(patch).eq('id',active.id).select('*,proc_po_is_company,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)').single()
  setBusy(false)
  if(r.error)return fail(r.error)
  setActive(r.data);flash('Purchase order details updated.');load()
 }
 async function clearOrder(){
  if(!active||(profile.role_key||profile.role)!=='admin')return
  await confirmDanger({title:'Clear purchase order',message:'Permanently clear '+active.po_no+' and release its purchase quantities? Orders with receipts or invoices must be cleared through Admin Data Management.',confirmation:active.po_no,requireReason:true,confirmLabel:'Confirm clear order',onConfirm:async({confirmation,reason})=>{
   setBusy(true);try{const r=await supabase.rpc('proc_admin_clear_po_v1',{p_po_id:active.id,p_confirmation:confirmation,p_reason:reason});if(r.error)throw r.error;setActive(null);setLines([]);flash('Order cleared. Purchase quantities released.');await load()}finally{setBusy(false)}
  }})
 }
 async function action(type){
  if(!active)return
  const message=type==='approve'?'Approve this purchase order?':'Confirm that this purchase order was actually sent to the supplier?'
  if(!await confirmAction(message))return
  setBusy(true)
  const r=type==='approve'?await supabase.rpc('proc_approve_po_v2',{p_po_id:active.id}):await supabase.rpc('proc_mark_po_sent_v2',{p_po_id:active.id})
  setBusy(false)
  if(r.error)return fail(r.error)
  flash(type==='approve'?'Purchase order approved.':'Purchase order marked as sent.')
  const u=await supabase.from('proc_purchase_orders').select('*,proc_po_is_company,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)').eq('id',active.id).single()
  if(!u.error)setActive(u.data)
  load()
 }
 function copy(){
  if(!active||!linesReady)return
  try{navigator.clipboard.writeText(buildPurchaseOrderText(shareArgs)).then(()=>flash('Purchase order copied with the selected fields.')).catch(fail)}catch(e){fail(e)}
 }
 async function copyPoCaption(){
  try{
   await navigator.clipboard.writeText(buildPurchaseOrderCaption(shareArgs))
   flash('PO caption copied. Paste it with the PNG in the supplier chat.')
  }catch(e){fail(e)}
 }
 function whatsapp(){
  const url=whatsappUrl(active?.supplier?.whatsapp||active?.supplier?.phone,'')
  if(!url)return fail(new Error(t('validation.no_whatsapp','This supplier has no valid WhatsApp number.')))
  window.open(url,'_blank','noopener,noreferrer')
 }
 const sendBlock=poSendBlock({po:active,canEdit,ready:linesReady&&shareReady,loading:gatewayLoading,gateway,busy:shareBusy})
 const filtered=useMemo(()=>rows.filter(r=>(r.po_no+' '+(r.supplier?.name||'')).toLowerCase().includes(search.toLowerCase())),[rows,search])
 async function releaseBalance(line,action){
  let reason=''
  if(!await confirmAction('Release '+qty(remainingDelivery(line))+' '+(line.item?.uom||'units')+' from '+active.supplier?.name+'? Notify the supplier separately. '+(action==='buy_elsewhere'?'This quantity will return to Still to order.':'This quantity will be removed from the approved need.'),{title:action==='buy_elsewhere'?'Buy the balance elsewhere':'Cancel the outstanding balance',requireReason:true,onConfirm:values=>{reason=values.reason}}))return
  setBusy(true);try{const r=await supabase.rpc('proc_release_po_balance_v1',{p_po_line_id:line.id,p_action:action,p_reason:reason});if(r.error)throw r.error;flash(qty(r.data.released_qty)+' released. Supplier notification is still required.');await load();const fresh=await supabase.from('proc_purchase_orders').select('*,proc_po_is_company,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)').eq('id',active.id).single();if(fresh.error)throw fresh.error;await open(fresh.data)}catch(e){fail(e)}finally{setBusy(false)}
 }
 async function closeOrder(){
  if(busy||!active||!await confirmAction('Close '+active.po_no+'? All delivery balances must be settled and rejected-goods cases resolved.',{title:'Complete this order',confirmLabel:'Close order'}))return
  setBusy(true)
  try{const r=await supabase.rpc('proc_close_po_v1',{p_po_id:active.id});if(r.error)throw r.error;setActive(x=>({...x,status:'closed'}));flash('Order closed. Delivery and rejection checks passed.');await load()}catch(e){fail(e)}finally{setBusy(false)}
 }
 const directPo=Boolean(active?.company_id&&active?.quantity_only)
 const poCols=configuredColumns(fields,'po',[
  {key:'item_code',label:'Code',render:l=><span className="mono tiny">{l.item?.item_code}</span>},
  {key:'description',label:'Item',render:l=><strong>{[itemTitle(l.item||{}),l.item?.colour,l.item?.variation].filter(Boolean).join(' · ')}</strong>},
  {key:'size',label:'Size',render:l=>l.item?.size||'—'},
  {key:'uom',label:'UOM',render:l=>l.item?.uom||'—'},
  {key:'qty',label:'Qty',render:l=><>{qty(l.qty)}{Number(l.cancelled_qty)>0&&<div className="muted tiny">Cancelled {qty(l.cancelled_qty)}</div>}</>},
  {key:'unit_price',label:directPo?'Unit Rate':'Unit Price',render:l=>directPo?'Direct PO':money(l.unit_price)},
  {key:'discount_percent',label:'Discount %',render:l=>Number(l.discount_percent||0).toFixed(2)+'%'},
  {key:'tax_percent',label:'Tax %',render:l=>Number(l.tax_percent||0).toFixed(2)+'%'},
  {key:'effective_unit_cost',label:'Effective Unit Cost',render:l=>money(Number(l.unit_price||0)*(1-Number(l.discount_percent||0)/100)*(1+Number(l.tax_percent||0)/100))},
  {key:'landed_unit_cost',label:'Landed Unit Cost',render:l=>l.landed_unit_cost==null?'—':money(l.landed_unit_cost)},
  {key:'line_total',label:'Line Total',render:l=>money(l.line_total)}
 ]).filter(c=>!active?.quantity_only||(directPo&&c.key==='unit_price')||!['unit_price','discount_percent','tax_percent','effective_unit_cost','landed_unit_cost','line_total'].includes(c.key))
 if(directPo&&!poCols.some(c=>c.key==='unit_price'))poCols.push({key:'unit_price',label:'Unit Rate',render:()=> 'Direct PO'})
 const renderOrder=()=> <div className="po-expanded" id={'po-details-'+active.id}>
   <div className="order-progress" role="status"><strong>{['sent','partially_received'].includes(active.status)?'PO sent · track delivery below':['received','closed'].includes(active.status)?'Order '+active.status:active.status==='cancelled'?'Order cancelled':active.status==='approved'?'Approved · ready to send':'Created · awaiting approval'}</strong><small>Delivery is tracked below.</small></div>
   <DeliveryProgress lines={lines} loaded={linesReady}/>
   {directPo&&<p className="notice section"><strong>Direct PO — RFQ bypassed</strong></p>}
   <div className="workflow-next-card section"><small>Next step</small><strong>{poNextStep(active.status)}</strong><span>Supplier: {active.supplier?.name||'Unavailable'} · {active.supplier?.whatsapp||active.supplier?.phone||'Add a contact number'}</span></div>
   <div className="sectionhead"><div><h3>{active.po_no}</h3><p>{active.supplier?.name} · {active.po_date}</p></div><Badge>{active.status}</Badge></div>
   <details className="section po-order-meta"><summary>Order details · dates, terms & remarks</summary><div className="document-meta">
    {fieldEnabled(fields,'po','supplier')&&<div><span>{fieldLabel(fields,'po','supplier','Supplier')}</span><b>{active.supplier?.name||'—'}</b></div>}
    <div><span>Phone</span><b>{active.supplier?.phone||'—'}</b></div>
    {fieldEnabled(fields,'po','po_date')&&<div><span>{fieldLabel(fields,'po','po_date','PO Date')}</span><b>{active.po_date||'—'}</b></div>}
    {fieldEnabled(fields,'po','expected_date')&&<div><span>{fieldLabel(fields,'po','expected_date','Expected Delivery')}</span>{canEdit&&!['received','closed','cancelled'].includes(active.status)?<input className="input" type="date" value={poMeta.expected_date} onChange={e=>setPoMeta(x=>({...x,expected_date:e.target.value}))}/>:<b>{active.expected_date||'—'}</b>}</div>}
    {fieldEnabled(fields,'po','terms')&&<div><span>{fieldLabel(fields,'po','terms','Terms')}</span>{canEdit&&active.status==='pending_approval'?<input className="input" value={poMeta.terms} placeholder={active.supplier?.payment_terms||''} onChange={e=>setPoMeta(x=>({...x,terms:e.target.value}))}/>:<b>{active.terms||active.supplier?.payment_terms||'—'}</b>}</div>}
    {fieldEnabled(fields,'po','freight_total')&&<div><span>{fieldLabel(fields,'po','freight_total','Freight')}</span><b>{money(active.freight_total||0)}</b></div>}
    {fieldEnabled(fields,'po','notes')&&<div><span>{fieldLabel(fields,'po','notes','Notes')}</span>{canEdit&&!['closed','cancelled'].includes(active.status)?<input className="input" value={poMeta.notes} onChange={e=>setPoMeta(x=>({...x,notes:e.target.value}))}/>:<b>{active.notes||'—'}</b>}</div>}
   {canEdit&&['pending_approval','approved','sent','partially_received'].includes(active.status)&&<button className="btn" disabled={busy||shareBusy} onClick={saveMeta}>Save Details</button>}
   </div></details>
   {!linesReady?<p role="status">Loading PO items…</p>:<div className="po-bill section work-items-window" style={{'--po-numeric-columns':poCols.filter(c=>['qty','unit_price','line_total'].includes(c.key)).length}} role="region" aria-label="Purchase order bill">
    <div className="po-bill-head"><span>Item / size</span>{poCols.filter(c=>['qty','unit_price','line_total'].includes(c.key)).map(c=><span key={c.key}>{c.label}</span>)}</div>
    {lines.map(l=><details className="po-bill-line" key={l.id}>
     <summary><strong title={itemTitle(l.item||{})}><ItemLabel item={l.item||{}}/></strong>{poCols.filter(c=>['qty','unit_price','line_total'].includes(c.key)).map(c=><span key={c.key}>{c.key==='qty'?qty(l.qty):directPo&&c.key==='unit_price'?'Direct PO':Number(l[c.key]||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>)}</summary>
     <div className="po-line-details"><strong>{itemTitle(l.item||{})}</strong><dl>{poCols.map(c=><div key={c.key}><dt>{c.label}</dt><dd>{c.render(l)}</dd></div>)}{l.notes&&<div><dt>Remarks</dt><dd>{l.notes}</dd></div>}</dl></div>
    </details>)}
   </div>}
   {lines.some(l=>Number(l.cancelled_qty)>0)&&<div className="notice section">Original PO quantities and values are retained. Cancelled balances are shown separately in the delivery audit.</div>}
   {canEdit&&canApprove&&['sent','partially_received'].includes(active.status)&&<details className="section"><summary>Outstanding delivery balances</summary><p className="muted tiny">Wait for delivery, cancel an unneeded balance, or release it to buy elsewhere. These actions require a reason and supplier notification.</p>{lines.filter(l=>remainingDelivery(l)>0).map(l=><div className="procurement-data-row" key={l.id}><strong>{itemTitle(l.item||{})}</strong><p>{qty(remainingDelivery(l))} {l.item?.uom} outstanding</p><div className="toolbar"><button className="btn small" disabled={busy||shareBusy} onClick={()=>releaseBalance(l,'buy_elsewhere')}>Buy elsewhere</button><button className="btn small bad" disabled={busy||shareBusy} onClick={()=>releaseBalance(l,'cancel')}>Cancel balance</button></div></div>)}</details>}
   {lines.some(l=>l.balance_actions?.length)&&<details className="section"><summary>Balance action history</summary>{lines.flatMap(l=>(l.balance_actions||[]).map((a,i)=><p key={l.id+'-'+i}>{itemTitle(l.item||{})} · {qty(a.released_qty)} · {a.action} · {a.reason} · {new Date(a.created_at).toLocaleString()}</p>))}</details>}
   {!active.quantity_only&&fieldEnabled(fields,'po','total')&&<div className="document-total"><span>{fieldLabel(fields,'po','total','Total LKR')}</span><strong>{money(active.total)}</strong></div>}
   <SupplierDocumentEditor kind="po" value={documentTemplate} onChange={changeDocumentTemplate} company={company} lines={lines} po={active} disabled={busy||shareBusy}/>
   <details className="section no-print"><summary>Supplier document fields</summary><p className="muted tiny">Choose fields for PDF, PNG and copied text. Saved for your account on this device. Order values and approvals are unchanged.</p><div className="formgrid">{PO_SHARE_FIELDS.map(([key,label])=><label className="checkline" key={key}><input type="checkbox" checked={shareFields[key]} disabled={!shareReady||shareBusy} onChange={e=>changeShareField(key,e.target.checked)}/>{label}</label>)}</div><button className="btn small section" disabled={shareBusy} onClick={()=>{const next=defaultPoShareFields();setShareFields(next);try{localStorage.setItem(settingsKey,JSON.stringify(next))}catch{}}}>Reset to quantity-only fields</button></details>
   <div className="toolbar section no-print po-primary-action">
    {canApprove&&active.status==='pending_approval'&&<button className="btn good" disabled={busy||shareBusy} onClick={()=>action('approve')}>Approve PO</button>}
    {canEdit&&active.status==='approved'&&<><button className="btn primary" disabled={busy||shareBusy||!linesReady||!shareReady} title="Choose the supplier in WhatsApp and review the PNG plus caption before sending" onClick={()=>exportPo('share')}>{shareBusy?'Preparing PO PNG…':'Share PO PNG + Caption'}</button><button className="btn" disabled={busy||shareBusy} onClick={()=>action('send')}>Confirm Sent</button></>}
    {can('receiving.view')&&active.status==='received'&&<button className="btn" onClick={()=>navigate('receiving','followup:'+active.po_no)}>Review follow-ups</button>}
    {canEdit&&canApprove&&active.status==='received'&&<button className="btn primary" disabled={busy||shareBusy||!linesReady} onClick={closeOrder}>Complete order →</button>}
    {can('receiving.view')&&['sent','partially_received'].includes(active.status)&&<button className="btn primary" onClick={()=>navigate('receiving',active.id)}>Receive this order →</button>}
   </div>
   {(profile.role_key||profile.role)==='admin'&&can('admin.configure_app')&&<DeleteRecordButton profile={profile} table="proc_purchase_orders" record={active} label="purchase order" fail={fail} disabled={busy||shareBusy} onDeleted={async()=>{opening.current++;setActive(null);setLines([]);flash('Purchase order and reviewed linked records deleted.');await load()}}/>}
   <details className="section no-print"><summary>Document & Sharing Options</summary><div className="toolbar section">
    <button className="btn" disabled={!linesReady||shareBusy||!shareReady} onClick={()=>exportPo('pdf')}>Download PDF</button>
    <button className="btn" disabled={!linesReady||shareBusy||!shareReady} onClick={()=>exportPo('png')}>Download PO PNG</button>
    <button className="btn" disabled={!linesReady||shareBusy||!shareReady} onClick={()=>exportPo('share')}>Share PO Image + Caption</button>
    <button className="btn" disabled={!linesReady||shareBusy||!shareReady} onClick={copy}>Copy</button>
    {(active.supplier?.whatsapp||active.supplier?.phone)&&<button className="btn" onClick={whatsapp}>Open Supplier WhatsApp</button>}
    <button className="btn" onClick={copyPoCaption}>Copy PO Caption</button>
   </div></details>
   {canEdit&&active.status==='approved'&&<section className="section no-print" aria-label="Manual supplier WhatsApp PO sharing">
    <div className="notice"><b>Manual WhatsApp sharing · works without a gateway</b>
     <p className="muted tiny">Tap Share to open your phone's sharing options. Choose WhatsApp and the correct supplier. Check the PNG and caption before sending. If WhatsApp drops the caption, paste it manually. Only use Confirm Sent after the message is actually sent.</p>
     <div className="toolbar section">
      <button className="btn primary" disabled={busy||shareBusy||!linesReady||!shareReady} onClick={()=>exportPo('share')}>{shareBusy?'Preparing PNG…':'Share PO PNG + Caption'}</button>
      <button className="btn small" disabled={shareBusy} onClick={copyPoCaption}>Copy PO Caption</button>
      <button className="btn small" disabled={shareBusy} onClick={whatsapp}>Open Supplier Chat</button>
      <button className="btn small" disabled={shareBusy||!linesReady||!shareReady} onClick={()=>exportPo('png')}>Download PNG</button>
     </div>
     <details className="section"><summary>Automatic WhatsApp gateway · optional</summary>
      <p className="muted tiny">Gateway: {gateway?.connected?'Connected':gateway?.configured?'Not linked / offline':gateway?.error||(gatewayLoading?'Checking connection…':'Not configured')} · Automatic sending {gateway?.sendingEnabled?'enabled':'disabled'}. The gateway requires secure private configuration; manual sharing above does not.</p>
      <div className="toolbar">
       <button className="btn small" disabled={shareBusy} onClick={()=>refreshPoGateway()}>Refresh Gateway Status</button>
       <button className="btn small" disabled={Boolean(sendBlock)||busy||shareBusy} title={sendBlock||'Send through the verified private gateway'} onClick={sendPoImage}>{shareBusy?'Sending…':'Automatic gateway send'}</button>
      </div>
      {sendBlock&&<p role="status" className="muted tiny">{sendBlock}</p>}
      {gateway?.dispatches?.map(d=><p className="tiny" key={d.id}>Gateway attempt: {d.status}{d.status==='unknown'?' — check WhatsApp before resending':''}</p>)}
      <p className="muted tiny">Gateway acceptance does not confirm delivery. Never retry an uncertain attempt without checking WhatsApp.</p>
     </details>
    </div>
   </section>}
 </div>
 return <div className="card pad po-orders">
  <div className="sectionhead"><div><h3>{t('documents.po_title','Purchase Orders')} <InfoButton topic="po_approval" language={language}/></h3><p>Tap a PO row to expand its bill, details and supplier actions.</p></div></div>
  <div className="rfq-workspace-tabs section" role="tablist" aria-label="Purchase order type">
   <button className={'btn '+(orderTab==='general'?'primary':'')} type="button" role="tab" aria-selected={orderTab==='general'} onClick={()=>changeOrderTab('general')}>General Items</button>
   <button className={'btn '+(orderTab==='company'?'primary':'')} type="button" role="tab" aria-selected={orderTab==='company'} onClick={()=>changeOrderTab('company')}>Company Items</button>
   {batchKey&&<button className={'btn '+(orderTab==='selected'?'primary':'')} type="button" role="tab" aria-selected={orderTab==='selected'} onClick={()=>changeOrderTab('selected')}>Selected orders</button>}
  </div>
  {canEdit&&orderTab==='selected'&&batchKey&&<PoBulkSend orderIds={batchIds} company={documentCompany(company,documentTemplate)} documentTemplate={documentTemplate} selection={shareFields} ready={shareReady} refreshKey={rows.map(po=>po.id+po.status).join(',')} otherBusy={busy||shareBusy} onBusy={setShareBusy} onRefresh={async()=>{await load();if(active)await refreshPoGateway(active.id)}}/>}
  {orderTab==='selected'&&batchKey&&<div className="notice section">Showing the {batchIds.length} PO(s) created for this order. <button className="btn small" onClick={()=>navigate('po','all')}>View all orders</button></div>}
  <div className="filters two section"><input className="input" placeholder="Filter this page by PO or supplier" value={search} onChange={e=>setSearch(e.target.value)}/><ModernSelect className="select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="open">Open POs</option><option value="non_cancelled">Non-cancelled POs</option><option value="overdue">Overdue deliveries</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="sent">Sent</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></ModernSelect></div>
  <div className="po-order-list section">{filtered.map(po=><div className="po-order" key={po.id}>
   <button type="button" className={'po-order-row '+(active?.id===po.id?'active-record':'')} disabled={busy||shareBusy} aria-expanded={active?.id===po.id} aria-controls={active?.id===po.id?'po-details-'+po.id:undefined} onClick={()=>{if(active?.id===po.id){opening.current++;opening.currentPoId=null;setActive(null)}else void open(po)}}><strong>{po.po_no}</strong><span title={po.supplier?.name}>{po.supplier?.name}</span><b>{po.quantity_only?(po.company_id?'Direct PO':'Quantity only'):money(po.total)}</b><span aria-hidden="true">{active?.id===po.id?'▾':'▸'}</span></button>
   {active?.id===po.id&&renderOrder()}
  </div>)}</div>
  {!filtered.length&&<Empty>No purchase orders match this page.</Empty>}
  {active&&!filtered.some(po=>po.id===active.id)&&renderOrder()}
  <div className="toolbar section"><button className="btn" disabled={busy||shareBusy||page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Previous</button><span className="muted tiny">{total?page*pageSize+1:0}–{Math.min((page+1)*pageSize,total)} of {total}</span><button className="btn" disabled={busy||shareBusy||(page+1)*pageSize>=total} onClick={()=>setPage(x=>x+1)}>Next</button></div>
 </div>
}

export function Invoices({initialFilter='',profile,fields,features=[],flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const canEdit=can('invoices.manage')
 const canResolve=features.find(x=>x.feature_key==='invoices.variance_resolution')?.enabled!==false
 const[invoiceFilter,setInvoiceFilter]=useState(initialFilter==='variance'?'variance':'all')
 const[pos,setPos]=useState([]),[invoices,setInvoices]=useState([]),[invoiceTotal,setInvoiceTotal]=useState(0),[page,setPage]=useState(0),[poId,setPoId]=useState(''),[lines,setLines]=useState([]),[vals,setVals]=useState({}),[receiptMap,setReceiptMap]=useState({}),[invoice,setInvoice]=useState(''),[file,setFile]=useState(null),[busy,setBusy]=useState(false)
 const[resolutionTarget,setResolutionTarget]=useState(null),[resolutionAction,setResolutionAction]=useState('request_revised_invoice'),[resolutionNotes,setResolutionNotes]=useState(''),[creditNote,setCreditNote]=useState('')
 const pageSize=100
 const load=useCallback(async()=>{try{
  const[a,b]=await Promise.all([
   allRows(()=>supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name)').in('status',['approved','sent','partially_received','received']).order('created_at',{ascending:false}).order('id')),
   (invoiceFilter==='variance'?supabase.from('proc_supplier_invoices').select('*,supplier:proc_suppliers(name),po:proc_purchase_orders(po_no)',{count:'exact'}).eq('status','variance'):supabase.from('proc_supplier_invoices').select('*,supplier:proc_suppliers(name),po:proc_purchase_orders(po_no)',{count:'exact'})).order('created_at',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1)
  ])
  if(a.error)throw a.error;if(b.error)throw b.error;setPos(a.data||[]);setInvoices(b.data||[]);setInvoiceTotal(b.count||0)
 }catch(e){fail(e)}},[fail,page,invoiceFilter])
 useEffect(()=>{load()},[load])
 useEffect(()=>{let cancelled=false;setLines([]);setVals({});setReceiptMap({});if(!poId)return;(async()=>{
  const[a,b]=await Promise.all([
   allRows(()=>supabase.from('proc_po_lines').select('*,item:proc_items(description,size,uom)').eq('po_id',poId).order('id')),
   allRows(()=>supabase.from('proc_v_invoiceable_po_lines').select('po_line_id,accepted_qty,invoiced_qty,invoiceable_qty').eq('po_id',poId).order('po_line_id'))
  ])
  if(cancelled)return
  if(a.error)return fail(a.error);if(b.error)return fail(b.error)
  setLines(a.data||[])
  setReceiptMap(Object.fromEntries((b.data||[]).map(x=>[x.po_line_id,{
   accepted:Number(x.accepted_qty||0),invoiced:Number(x.invoiced_qty||0),invoiceable:Number(x.invoiceable_qty||0)
  }])))
  setVals(Object.fromEntries((a.data||[]).map(x=>[x.id,{qty:'',price:'',discount:'',tax:''}])))
 })();return()=>{cancelled=true}},[poId,fail])

 function sameAsPo(line){
  const available=Number(receiptMap[line.id]?.invoiceable||0)
  setVals(v=>({...v,[line.id]:{qty:available>0?String(available):'',price:String(line.unit_price),discount:String(line.discount_percent??0),tax:String(line.tax_percent??0)}}))
 }
 function allSameAsPo(){
  setVals(Object.fromEntries(lines.map(x=>{
   const available=Number(receiptMap[x.id]?.invoiceable||0)
   return [x.id,{qty:available>0?String(available):'',price:available>0?String(x.unit_price):'',discount:available>0?String(x.discount_percent??0):'',tax:available>0?String(x.tax_percent??0):''}]
  })))
 }

 async function save(){
  if(!canEdit)return fail(new Error(t('invoices.read_only_error','Your role has read-only invoice access.')))
  const po=pos.find(x=>x.id===poId)
  if(!po||!invoice.trim())return fail(new Error(t('invoices.select_po_number','Select a PO and enter the supplier invoice number.')))
  if(!lines.length)return fail(new Error(t('invoices.no_lines','The selected purchase order has no lines.')))
  if(lines.some(l=>{const v=vals[l.id]?.qty;return v!==undefined&&v!==''&&(!Number.isFinite(Number(v))||Number(v)<0)}))return fail(new Error('Invoice quantities must be finite, non-negative numbers.'))
  const invoiceLines=lines.filter(l=>vals[l.id]?.qty!==undefined&&vals[l.id]?.qty!==''&&Number(vals[l.id]?.qty)>0)
  if(!invoiceLines.length)return fail(new Error('Enter at least one invoiced quantity. Leave lines not on this supplier invoice blank.'))
  const incomplete=invoiceLines.some(l=>['price','discount','tax'].some(k=>vals[l.id]?.[k]===undefined||vals[l.id]?.[k]===''))
  if(incomplete)return fail(new Error('Complete price, discount and tax for each line included on this supplier invoice.'))
  if(invoiceLines.some(l=>{const v=vals[l.id];return !Number.isFinite(Number(v.price))||Number(v.price)<0||['discount','tax'].some(k=>!Number.isFinite(Number(v[k]))||Number(v[k])<0||Number(v[k])>100)}))return fail(new Error('Enter a valid non-negative price and discount/tax percentages from 0 to 100.'))
  let path=null;setBusy(true)
  try{
   if(file){
    path='invoices/'+po.id+'/'+Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const u=await supabase.storage.from('gh-procurement').upload(path,file);if(u.error)throw u.error
   }
   const payload=invoiceLines.map(l=>({po_line_id:l.id,qty:Number(vals[l.id].qty),unit_price:Number(vals[l.id].price),discount_percent:Number(vals[l.id].discount),tax_percent:Number(vals[l.id].tax)}))
   const r=await supabase.rpc('proc_create_invoice_v4',{p_po_id:po.id,p_invoice_no:invoice.trim(),p_lines:payload,p_attachment_path:path,p_notes:null})
   if(r.error)throw r.error
   flash('Invoice '+invoice+' saved — '+String(r.data.status).replaceAll('_',' ')+'.')
   setInvoice('');setFile(null);setPoId('');setLines([]);setVals({});load()
  }catch(e){if(path)await supabase.storage.from('gh-procurement').remove([path]);fail(e)}finally{setBusy(false)}
 }

 async function resolveVariance(){
  if(!canEdit||!resolutionTarget||busy)return
  if(resolutionAction==='credit_note_received'&&!creditNote.trim())return fail(new Error(t('invoices.credit_note','Enter the credit note number.')))
  setBusy(true)
  const r=await supabase.rpc('proc_resolve_invoice_variance_v1',{
   p_invoice_id:resolutionTarget.id,p_action:resolutionAction,p_notes:resolutionNotes||null,p_credit_note_no:creditNote||null
  })
  setBusy(false)
  if(r.error)return fail(r.error)
  flash('Invoice variance action recorded: '+resolutionAction.replaceAll('_',' ')+'.')
  setResolutionTarget(null);setResolutionNotes('');setCreditNote('');load()
 }

 const show=k=>fieldEnabled(fields,'invoices',k)
 const label=(k,v)=>fieldLabel(fields,'invoices',k,v)
 const lineBad=(l,v)=>v.qty!==''&&v.price!==''&&v.discount!==''&&v.tax!==''&&(
  Number(v.qty)>Number(receiptMap[l.id]?.invoiceable||0)||Number(v.price)!==Number(l.unit_price)||Number(v.discount)!==Number(l.discount_percent||0)||Number(v.tax)!==Number(l.tax_percent||0)
 )
 return <div className="split">
  <div className="card pad"><div className="sectionhead"><div><h3>{t('invoices.matching','Invoice Matching')}</h3><p>{t('invoices.matching_hint','Three-way match checks Supplier Invoice ↔ Purchase Order ↔ posted GRN. Invoice values start blank to avoid confirmation bias.')}</p></div>{canEdit&&lines.length>0&&<button className="btn" onClick={allSameAsPo}>{t('invoices.same_all','Use GRN Qty + PO Price')}</button>}</div>
   {canEdit?<div className="stack">
    <div className="field"><label>{label('purchase_order','Purchase Order')}</label><ModernSelect aria-label="Purchase Order" className="select" value={poId} disabled={busy} onChange={e=>setPoId(e.target.value)}><option value="">Select PO…</option>{pos.map(p=><option key={p.id} value={p.id}>{p.po_no} · {p.supplier?.name}</option>)}</ModernSelect></div>
    <div className="field"><label>{label('invoice_no','Supplier Invoice Number')}</label><input className="input" value={invoice} onChange={e=>setInvoice(e.target.value)}/></div>
    {show('attachment')&&<div className="field"><label>{label('attachment','Invoice PDF / Image')}</label><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></div>}
   </div>:<div className="notice">{t('invoices.read_only','Your role can review invoices but cannot create or modify them.')}</div>}
   {canEdit&&lines.length>0&&<><div className="desktop-table tablewrap section"><table className="table"><thead><tr>
    {show('description')&&<th>{label('description','Item')}</th>}<th>Confirm</th>
    {show('po_qty')&&<th>{label('po_qty','PO Qty')}</th>}<th>Accepted</th><th>Already Invoiced</th><th>Invoiceable</th>{show('invoice_qty')&&<th>{label('invoice_qty','Invoice Qty')}</th>}
    {show('po_price')&&<th>{label('po_price','PO Price')}</th>}{show('invoice_price')&&<th>{label('invoice_price','Invoice Price')}</th>}
    {show('po_discount')&&<th>{label('po_discount','PO Disc %')}</th>}{show('invoice_discount')&&<th>{label('invoice_discount','Invoice Disc %')}</th>}
    {show('po_tax')&&<th>{label('po_tax','PO Tax %')}</th>}{show('invoice_tax')&&<th>{label('invoice_tax','Invoice Tax %')}</th>}
    {show('match_status')&&<th>{label('match_status','Check')}</th>}
   </tr></thead><tbody>{lines.map(l=>{const v=vals[l.id]||{};const bad=lineBad(l,v);return <tr key={l.id}>
    {show('description')&&<td><strong>{itemTitle(l.item||{})}</strong></td>}<td><button className="btn small" onClick={()=>sameAsPo(l)}>{t('invoices.same','Use GRN Qty')}</button></td>
    {show('po_qty')&&<td>{qty(l.qty)}</td>}<td>{qty(receiptMap[l.id]?.accepted||0)}</td><td>{qty(receiptMap[l.id]?.invoiced||0)}</td><td><b>{qty(receiptMap[l.id]?.invoiceable||0)}</b></td>{show('invoice_qty')&&<td><input className="input stock-entry" inputMode="decimal" value={v.qty??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,qty:e.target.value}}))}/></td>}
    {show('po_price')&&<td>{money(l.unit_price)}</td>}{show('invoice_price')&&<td><input className="input stock-entry" inputMode="decimal" value={v.price??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,price:e.target.value}}))}/></td>}
    {show('po_discount')&&<td>{Number(l.discount_percent||0).toFixed(2)}%</td>}{show('invoice_discount')&&<td><input className="input short-entry" inputMode="decimal" value={v.discount??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,discount:e.target.value}}))}/></td>}
    {show('po_tax')&&<td>{Number(l.tax_percent||0).toFixed(2)}%</td>}{show('invoice_tax')&&<td><input className="input short-entry" inputMode="decimal" value={v.tax??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,tax:e.target.value}}))}/></td>}
    {show('match_status')&&<td><Badge>{v.qty===''?'unconfirmed':bad?'variance':'matched'}</Badge></td>}
   </tr>})}</tbody></table></div>
   <div className="mobile-card-list section invoice-rows" role="region" aria-label="Invoice item rows">{lines.map(l=>{const v=vals[l.id]||{},bad=lineBad(l,v),title=itemTitle(l.item||{});return <div className="invoice-entry-row" key={l.id}>
    <div className="invoice-row-main"><div className="row-item-name"><strong title={title}>{title}</strong><span className="muted tiny">Invoiceable {qty(receiptMap[l.id]?.invoiceable||0)}</span></div>{show('invoice_qty')&&<label className="field">Qty<input aria-label={'Invoice quantity '+title} className="input row-quantity" inputMode="decimal" value={v.qty??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,qty:e.target.value}}))}/></label>}{show('invoice_price')&&<label className="field">Price<input aria-label={'Invoice price '+title} className="input row-quantity" inputMode="decimal" value={v.price??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,price:e.target.value}}))}/></label>}</div>
    <details className="row-details"><summary>Details / match {show('match_status')&&<Badge>{v.qty===''?'unconfirmed':bad?'variance':'matched'}</Badge>}</summary><div className="muted tiny">PO {qty(l.qty)} · Accepted {qty(receiptMap[l.id]?.accepted||0)} · Already invoiced {qty(receiptMap[l.id]?.invoiced||0)}{show('po_price')&&' · PO price '+money(l.unit_price)}</div><button className="btn small" onClick={()=>sameAsPo(l)}>{t('invoices.same','Same as PO')}</button><div className="row-extra-fields">{show('invoice_discount')&&<label className="field">Discount %<input className="input" inputMode="decimal" value={v.discount??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,discount:e.target.value}}))}/></label>}{show('invoice_tax')&&<label className="field">Tax %<input className="input" inputMode="decimal" value={v.tax??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,tax:e.target.value}}))}/></label>}</div></details>
   </div>})}</div>
   <button className="btn primary section" disabled={busy} onClick={save}>{busy?t('common.saving','Saving…'):t('invoices.save_match','Save & Match Invoice')}</button></>}
  </div>

  <div className="card pad"><div className="sectionhead"><div><h3>{t('invoices.supplier_invoices','Supplier Invoices')}</h3><p>{t('invoices.supplier_hint','Variance invoices have a tracked resolution lifecycle instead of a permanent red flag.')}</p></div></div>
   <ModernSelect aria-label="Invoice status" className="select" value={invoiceFilter} onChange={e=>{setInvoiceFilter(e.target.value);setPage(0)}}><option value="all">All invoices</option><option value="variance">Invoice variances</option></ModernSelect>
   <div className="stack">{invoices.map(inv=><button className="btn record-button" key={inv.id} onClick={()=>inv.status==='variance'&&canEdit&&canResolve&&setResolutionTarget(inv)}><div><strong>{inv.invoice_no}</strong><div className="muted tiny">{inv.supplier?.name} · {inv.po?.po_no||'No PO'} · {inv.invoice_date}</div></div><div className="right"><Badge>{inv.status}</Badge>{inv.variance_resolution_status&&inv.variance_resolution_status!=='not_required'&&<Badge>{inv.variance_resolution_status}</Badge>}<div>{money(inv.total)}</div></div></button>)}</div>
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{invoiceTotal?page*pageSize+1:0}–{Math.min((page+1)*pageSize,invoiceTotal)} {t('common.of','of')} {invoiceTotal}</span><button className="btn" disabled={(page+1)*pageSize>=invoiceTotal} onClick={()=>setPage(x=>x+1)}>{t('common.next','Next')}</button></div>
   {resolutionTarget&&<div className="card pad section variance-resolution"><div className="sectionhead"><div><h4>{t('invoices.resolve','Resolve')} {resolutionTarget.invoice_no}</h4><p>{t('invoices.current_status','Current status')}: {resolutionTarget.variance_resolution_status||'open'}</p></div><button className="btn small" onClick={()=>setResolutionTarget(null)}>{t('common.close','Close')}</button></div><div className="formgrid"><div className="field"><label>Action</label><ModernSelect className="select" value={resolutionAction} onChange={e=>setResolutionAction(e.target.value)}><option value="request_revised_invoice">Request Revised Invoice</option><option value="request_credit_note">Request Credit Note</option><option value="credit_note_received">Credit Note Received</option><option value="dispute">Dispute</option>{canEdit&&<><option value="approve_difference">Approve Difference</option><option value="resolve">Resolve / Close</option><option value="reject">Reject Invoice</option></>}</ModernSelect></div><div className="field"><label>Reference / Credit Note</label><input className="input" value={creditNote} onChange={e=>setCreditNote(e.target.value)}/></div><div className="field wide"><label>Resolution Notes</label><input className="input" value={resolutionNotes} onChange={e=>setResolutionNotes(e.target.value)}/></div></div><button className="btn primary section" disabled={busy} onClick={resolveVariance}>Record Variance Action</button></div>}
  </div>
 </div>
}

export function Receiving({navigate=()=>{},onReceivingSelected=()=>{},activeView='receiving',initialFilter='',profile,fields,features=[],flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const confirmAction=useActionConfirmation()
 const canReceive=can('receiving.manage')
 const[pos,setPos]=useState([]),[poId,setPoId]=useState(''),[lines,setLines]=useState([]),[vals,setVals]=useState({}),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[cases,setCases]=useState([])
 const[casePage,setCasePage]=useState(0),[caseSearch,setCaseSearch]=useState('')
 const filteredCases=cases.filter(c=>[c.po_no,c.supplier_name,c.description,c.size,c.grn_no].join(' ').toLowerCase().includes(caseSearch.trim().toLowerCase()))
 const rejectionEnabled=features.find(x=>x.feature_key==='receiving.rejection_followup')?.enabled!==false
 const receiptKeys=useRef(new Map()),draftOwner=useRef(null),postLock=useRef(false),handledFilter=useRef(null),resultPanel=useRef(null)
 const[workspace,setWorkspace]=useState('delivery'),[followup,setFollowup]=useState(null),[result,setResult]=useState(null),[loadState,setLoadState]=useState('loading')
 const[search,setSearch]=useState(''),[showCompleted,setShowCompleted]=useState(false),[draftReady,setDraftReady]=useState(false),[draftStatus,setDraftStatus]=useState(''),[attempt,setAttempt]=useState(null)
 const draftKey=poId?'gh_receiving_draft_v1:'+profile.id+':'+poId:null
 const visibleLines=lines.filter(l=>(showCompleted||remainingDelivery(l)>0)&&[l.item?.description,l.item?.size,l.item?.item_code].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
 useEffect(()=>{if(initialFilter.startsWith('followup:')&&handledFilter.current!==initialFilter){handledFilter.current=initialFilter;setCaseSearch(initialFilter.slice(9));setWorkspace('followup');return}if(initialFilter&&handledFilter.current!==initialFilter&&pos.some(p=>p.id===initialFilter)){handledFilter.current=initialFilter;setPoId(initialFilter);setWorkspace('delivery')}},[initialFilter,pos])
 useEffect(()=>{if(result)resultPanel.current?.scrollIntoView({block:'start'})},[result])
 useEffect(()=>{if(!draftReady||!draftKey||draftOwner.current!==draftKey)return;try{localStorage.setItem(draftKey,JSON.stringify({vals,notes,receiptKey:receiptKeys.current.get(poId)||null,attempt}));setDraftStatus('Saved on this device')}catch{setDraftStatus('Could not save draft on this device. Keep this screen open.')}},[vals,notes,attempt,draftReady,draftKey,poId])

 const loadPos=useCallback(async()=>{setLoadState('loading');try{
  const pendingIds=pendingReceiptOrderIds(globalThis.localStorage,profile.id)
  const promises=[allRows(()=>supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name)').in('status',['sent','partially_received']).order('created_at',{ascending:false}).order('id'))]
  let caseIndex=-1,recoveryIndex=-1
  if(rejectionEnabled&&can('receiving.view')){caseIndex=promises.length;promises.push(allRows(()=>supabase.from('proc_v_rejection_cases').select('*').neq('status','resolved').order('created_at',{ascending:false}).order('id')))}
  if(pendingIds.length){recoveryIndex=promises.length;promises.push(allRows(()=>supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name)').in('id',pendingIds).order('id')))}
  const data=await Promise.all(promises)
  for(const r of data)if(r.error)throw r.error
  setPos([...new Map([...(data[0].data||[]),...(data[recoveryIndex]?.data||[])].map(p=>[p.id,p])).values()])
  if(caseIndex>=0){setCases(data[caseIndex].data||[]);setCasePage(0)}
  setLoadState('ready')
 }catch(e){setLoadState('error');fail(e)}},[fail,rejectionEnabled,can,profile.id])
 useEffect(()=>{if(activeView==='receiving')loadPos()},[loadPos,activeView])
 useEffect(()=>{let cancelled=false;setLines([]);setVals({});setDraftReady(false);setAttempt(null);setNotes('');if(!poId)return;(async()=>{const r=await allRows(()=>supabase.from('proc_po_lines').select('*,item:proc_items(item_code,description,size,uom,colour,variation,brand),grn:proc_grn_lines(accepted_qty,receipt:proc_grns(status))').eq('po_id',poId).order('id'));if(cancelled)return;if(r.error)return fail(r.error);const data=r.data||[];setLines(data);let saved=null;try{saved=JSON.parse(localStorage.getItem('gh_receiving_draft_v1:'+profile.id+':'+poId)||'null')}catch{};setVals(Object.fromEntries(data.map(x=>[x.id,saved?.vals?.[x.id]||{received:'',accepted:'',rejected:'0',reason:''}])));setNotes(saved?.notes||'');if(saved?.receiptKey)receiptKeys.current.set(poId,saved.receiptKey);setAttempt(saved?.attempt||null);draftOwner.current='gh_receiving_draft_v1:'+profile.id+':'+poId;setDraftReady(true)})();return()=>{cancelled=true}},[poId,profile.id,fail])

 const already=l=>(l.grn||[]).filter(g=>!g.receipt||g.receipt.status==='posted').reduce((s,x)=>s+Number(x.accepted_qty||0),0)
 const remaining=remainingDelivery
 const isFull=l=>{const v=vals[l.id]||{},rem=remaining(l);return rem>0&&Number(v.received||0)===rem&&Number(v.accepted||0)===rem&&Number(v.rejected||0)===0}
 function setFull(l,on){const rem=remaining(l);setVals(x=>({...x,[l.id]:on?{...x[l.id],received:String(rem),accepted:String(rem),rejected:'0',reason:''}:{...x[l.id],received:'',accepted:'',rejected:'0',reason:''}}))}
 function setAllFull(){setVals(x=>{const next={...x};for(const l of visibleLines){const rem=remaining(l);if(rem>0)next[l.id]={...next[l.id],received:String(rem),accepted:String(rem),rejected:'0',reason:''}}return next})}

 async function post(){if(postLock.current)return;postLock.current=true;try{await postReceipt()}finally{postLock.current=false}}
 async function postReceipt(){
  if(!canReceive||busy)return
  const po=pos.find(x=>x.id===poId);if(!po)return fail(new Error(t('validation.select_po','Select a purchase order.')))
  if(lines.some(l=>['received','accepted','rejected'].some(k=>{const v=vals[l.id]?.[k];return v!==undefined&&v!==''&&(!Number.isFinite(Number(v))||Number(v)<0)})))return fail(new Error('Receiving quantities must be finite, non-negative numbers.'))
  const payload=attempt?.lines||lines.filter(l=>Number(vals[l.id]?.received||0)>0||Number(vals[l.id]?.accepted||0)>0||Number(vals[l.id]?.rejected||0)>0).map(l=>({po_line_id:l.id,received_qty:Number(vals[l.id]?.received||0),accepted_qty:Number(vals[l.id]?.accepted||0),rejected_qty:Number(vals[l.id]?.rejected||0),rejection_reason:vals[l.id]?.reason||null}))
  if(!payload.length)return fail(new Error(t('validation.receive_one','Enter at least one received quantity.')))
  for(const x of attempt?[]:payload){
   if(x.received_qty<0||x.accepted_qty<0||x.rejected_qty<0||x.accepted_qty+x.rejected_qty>x.received_qty)return fail(new Error(t('validation.receive_math','Accepted + rejected must not exceed received quantity, and quantities cannot be negative.')))
   if(Math.abs(x.accepted_qty+x.rejected_qty-x.received_qty)>0.000001)return fail(new Error('Inspect every received item: accepted + rejected must equal received.'))
   if(x.accepted_qty>remaining(lines.find(l=>l.id===x.po_line_id)))return fail(new Error('Accepted quantity exceeds the outstanding delivery balance. Refresh this order.'))
   if(x.rejected_qty>0&&!String(x.rejection_reason||'').trim())return fail(new Error('Enter a rejection reason for every rejected quantity.'))
  }
  const review=receiptReview(lines,payload)
  if(!await confirmAction(attempt?'Retry the exact saved receipt for '+po.po_no+'. An already posted receipt will not add stock again.':'Check quantities for '+po.po_no+'. Only accepted goods will enter stock.',{title:'2. Review receipt',details:<div className="receipt-review-list">{review.map(x=><div className="receipt-review-row" key={x.po_line_id}><strong>{itemTitle(x.item||{})}</strong><div>{qty(x.received_qty)} received · {qty(x.accepted_qty)} accepted · {qty(x.rejected_qty)} rejected</div><small>{qty(x.remaining)} {x.item?.uom||'units'} still due{x.rejected_qty>0?' · Rejected goods need follow-up':''}</small>{x.rejection_reason&&<div>Reason: {x.rejection_reason}</div>}</div>)}</div>,confirmLabel:'Post receipt'}))return
  setBusy(true)
  if(!receiptKeys.current.has(po.id))receiptKeys.current.set(po.id,globalThis.crypto.randomUUID())
  const pending=attempt||{lines:payload,notes:notes||null};setAttempt(pending)
  // Persist the exact retry key and payload before the request leaves this browser.
  try{localStorage.setItem(draftKey,JSON.stringify({vals,notes,receiptKey:receiptKeys.current.get(po.id),attempt:pending}))}catch{}
  let r;try{r=await supabase.rpc('proc_receive_po_v3',{p_po_id:po.id,p_receipt_key:receiptKeys.current.get(po.id),p_lines:pending.lines,p_notes:pending.notes})}catch(e){setBusy(false);fail(new Error('Receipt result unknown. Retry the same saved receipt; do not enter it again.'));return}
  setBusy(false)
  if(r.error){if(['P0001','42501','23514','22P02'].includes(r.error.code)){setAttempt(null);receiptKeys.current.delete(po.id)}return fail(r.error)}
  flash(r.data.grn_no+(r.data.replayed?' already posted — duplicate retry ignored.':' posted. Stock and reconciliation updated.'))
  try{localStorage.removeItem(draftKey)}catch{}
  setDraftReady(false);setAttempt(null);receiptKeys.current.delete(po.id)
  setResult({poId:po.id,poNo:po.po_no,grnNo:r.data.grn_no,replayed:r.data.replayed,rejected:payload.some(x=>x.rejected_qty>0)});setPoId('');onReceivingSelected('');setLines([]);setVals({});setNotes('');loadPos()
 }

 async function saveFollowup(payload){
  const r=await supabase.rpc('proc_resolve_rejection_case_v1',payload)
  if(r.error)throw r.error
  flash('Follow-up saved. '+(r.data.status==='resolved'?'Review any remaining delivery balance in Orders.':'The case remains open.'))
  await loadPos()
 }
 const enteredCount=lines.filter(l=>Number(vals[l.id]?.received||0)>0).length
 const show=k=>fieldEnabled(fields,'receiving',k)
 const label=(k,v)=>fieldLabel(fields,'receiving',k,v)
 const receiveColumns='minmax(0,1fr) '+(show('received_qty')?'56px ':'')+(show('accepted_qty')?'56px ':'')+'32px'
 return <div className="stack">
  {rejectionEnabled&&can('receiving.view')&&<div className="toolbar" role="tablist" aria-label="Receiving workspace"><button className={'btn '+(workspace==='delivery'?'primary':'')} role="tab" aria-selected={workspace==='delivery'} onClick={()=>setWorkspace('delivery')}>Deliveries</button><button className={'btn '+(workspace==='followup'?'primary':'')} role="tab" aria-selected={workspace==='followup'} onClick={()=>setWorkspace('followup')}>Follow-ups{loadState==='ready'?' ('+cases.length+')':''}</button></div>}
  {loadState==='error'&&<div role="alert" className="notice">Could not refresh deliveries and follow-ups. <button className="btn small" onClick={loadPos}>Retry receiving</button></div>}
  {workspace==='delivery'&&<>
  {result&&<div className="card pad" ref={resultPanel} role="region" aria-label="Receipt result"><h3>3. Receipt saved</h3><p>{result.grnNo} · {result.poNo}{result.replayed?' · Saved receipt confirmed':''}</p><p>Stock includes accepted goods only.{result.rejected?' Rejected goods need follow-up.':' Review delivery progress in Orders.'}</p><div className="toolbar">{result.rejected&&rejectionEnabled&&can('receiving.view')?<button className="btn primary" onClick={()=>setWorkspace('followup')}>Settle rejected goods →</button>:can('procurement.orders.view')&&<button className="btn primary" onClick={()=>navigate('po',result.poId)}>Track / complete order →</button>}<button className="btn" onClick={()=>setResult(null)}>Next delivery</button></div></div>}
  <div className="card pad">
   <div className="sectionhead"><div><h3>{t('receiving.title','Goods Receiving')} <InfoButton topic="receiving" language={language}/></h3><p>{t('receiving.hint','1. Choose an order and inspect delivery. Then review and save. Partial deliveries are welcome.')}</p></div>{canReceive&&<div className="toolbar"><button className="btn" disabled={!visibleLines.length||busy||Boolean(attempt)} onClick={setAllFull}>✓ Mark All Remaining Received</button><StockSubmitAction active={activeView==='receiving'}><button className="btn primary receive-post-dock" aria-label={busy?'Posting…':attempt?'Retry saved receipt':'Review receipt ('+enteredCount+') →'} disabled={busy||!draftReady||!enteredCount} onClick={post}><span className="receive-review-full">{busy?'Posting…':attempt?'Retry saved receipt':'Review receipt ('+enteredCount+') →'}</span><span className="receive-review-compact">{busy?'Posting…':attempt?'Retry receipt':'Review ('+enteredCount+') →'}</span></button></StockSubmitAction></div>}</div>
   <div className="formgrid"><div className="field"><label>{label('purchase_order','Purchase Order')}</label><ModernSelect aria-label="Purchase Order" className="select" value={poId} disabled={busy} onChange={e=>{setPoId(e.target.value);onReceivingSelected(e.target.value)}}><option value="">Select a sent PO…</option>{pos.map(p=><option key={p.id} value={p.id}>{p.po_no} · {p.supplier?.name}{['received','closed'].includes(p.status)?' · Confirm saved receipt':''}</option>)}</ModernSelect></div>{show('notes')&&<div className="field"><label>{label('notes','Receiving Notes')}</label><input className="input" disabled={busy||Boolean(attempt)} value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional"/></div>}</div>
   {canReceive&&poId&&draftReady&&<ReceiptOcr poId={poId} lines={lines} disabled={busy||Boolean(attempt)} fail={fail} onApply={async rows=>{if(!await confirmAction('Apply '+rows.length+' reviewed OCR row(s)? This replaces their draft quantities; accepted and rejected quantities must be entered after inspection.'))return false;setVals(v=>{const next={...v};for(const row of rows)next[row.lineId]={received:row.received,accepted:'',rejected:'0',reason:''};return next});flash('Reviewed received quantities applied. Inspect goods and enter accepted / rejected quantities before posting.')}}/>}
   {lines.length>0&&<><DeliveryProgress lines={lines}/><div className="sticky-work-search receiving-search section"><input aria-label="Search receiving items" className="input" placeholder="Search item, size or code" value={search} onChange={e=>setSearch(e.target.value)}/><label className="checkline"><input type="checkbox" checked={showCompleted} onChange={e=>setShowCompleted(e.target.checked)}/>Show completed lines</label><p className="muted tiny">{visibleLines.length} shown · {lines.filter(l=>remaining(l)>0).length} awaiting delivery · {draftStatus}</p>{attempt&&<p role="status">A receipt attempt is saved. Retry saved receipt retries that exact receipt safely; quantities stay locked until its result is resolved.</p>}</div><div className="desktop-table tablewrap section"><table className="table"><thead><tr><th>✓ Full</th>{show('description')&&<th>Item</th>}{show('ordered_qty')&&<th>Ordered</th>}{show('previously_accepted')&&<th>Previously Accepted</th>}{show('received_qty')&&<th>Received Now</th>}{show('accepted_qty')&&<th>Accepted</th>}{show('rejected_qty')&&<th>Rejected</th>}{show('rejection_reason')&&<th>Reason</th>}</tr></thead><tbody>{visibleLines.map(l=>{const v=vals[l.id]||{};return <tr key={l.id}><td className="center"><input type="checkbox" checked={isFull(l)} disabled={!canReceive||busy||Boolean(attempt)||remaining(l)<=0} onChange={e=>setFull(l,e.target.checked)}/></td>{show('description')&&<td><strong>{itemTitle(l.item||{})}</strong></td>}{show('ordered_qty')&&<td>{qty(l.qty)}</td>}{show('previously_accepted')&&<td>{qty(already(l))}<div className="muted tiny">Remaining {qty(remaining(l))}</div></td>}{show('received_qty')&&<td><input className="input stock-entry" inputMode="decimal" disabled={!canReceive||busy||Boolean(attempt)} value={v.received??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'received',e.target.value)}))}/></td>}{show('accepted_qty')&&<td><input className="input stock-entry" inputMode="decimal" disabled={!canReceive||busy||Boolean(attempt)} value={v.accepted??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'accepted',e.target.value)}))}/></td>}{show('rejected_qty')&&<td><input className="input stock-entry" inputMode="decimal" disabled={!canReceive||busy||Boolean(attempt)} value={v.rejected??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'rejected',e.target.value)}))}/></td>}{show('rejection_reason')&&<td><input className="input" disabled={!canReceive||busy||Boolean(attempt)} value={v.reason??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'reason',e.target.value)}))}/></td>}</tr>})}</tbody></table></div>
   <div className="mobile-card-list receiving-rows" role="region" aria-label="Receiving item rows">
    <div className="receive-row-columns" style={{gridTemplateColumns:receiveColumns}}><span>Item · remaining</span>{show('received_qty')&&<span>Received</span>}{show('accepted_qty')&&<span>Accepted</span>}<span>Full</span></div>
    {visibleLines.map(l=>{const v=vals[l.id]||{},title=itemTitle(l.item||{});return <div className="receive-entry-row" key={l.id} style={{gridTemplateColumns:receiveColumns}}>
     <div className="row-item-name"><strong title={title}>{title}</strong><span className="muted tiny">Left {qty(remaining(l))} {l.item?.uom||''}</span></div>
     {show('received_qty')&&<input aria-label={'Received '+title} className="input row-quantity" inputMode="decimal" disabled={!canReceive||busy||Boolean(attempt)} value={v.received??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'received',e.target.value)}))}/>}
     {show('accepted_qty')&&<input aria-label={'Accepted '+title} className="input row-quantity" inputMode="decimal" disabled={!canReceive||busy||Boolean(attempt)} value={v.accepted??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'accepted',e.target.value)}))}/>}
     <label className="receive-full-check" title={'Receive full remaining quantity: '+title}><input aria-label={'Full receipt '+title} type="checkbox" checked={isFull(l)} disabled={!canReceive||busy||Boolean(attempt)||remaining(l)<=0} onChange={e=>setFull(l,e.target.checked)}/></label>
     <details className="receive-row-details"><summary>Details / damage {Number(v.rejected)>0?'· '+qty(v.rejected)+' rejected':''}</summary><div className="muted tiny">Ordered {qty(l.qty)} · Cancelled {qty(l.cancelled_qty)} · Previously accepted {qty(already(l))}</div><div className="row-extra-fields">{show('rejected_qty')&&<label className="field">Rejected<input aria-label={'Rejected '+title} className="input" inputMode="decimal" disabled={!canReceive||busy||Boolean(attempt)} value={v.rejected??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'rejected',e.target.value)}))}/></label>}{show('rejection_reason')&&<label className="field">Reason<input aria-label={'Rejection reason '+title} className="input" disabled={!canReceive||busy||Boolean(attempt)} value={v.reason??''} onChange={e=>setVals(x=>({...x,[l.id]:receivingValue(v,'reason',e.target.value)}))}/></label>}</div></details>
    </div>})}
   </div></>}
  </div>

  </>}
  {workspace==='followup'&&rejectionEnabled&&can('receiving.view')&&<div className="card pad"><div className="sectionhead"><div><h3>Rejected Goods Follow-up</h3><p>Choose a case, record what happens next, then review. Returning goods alone keeps the case open.</p></div><div className="toolbar"><Badge>{loadState==='ready'?cases.length+' open':loadState==='error'?'Unavailable':'Loading…'}</Badge><button className="btn small" disabled={busy} onClick={loadPos}>{t('common.refresh','Refresh')}</button></div></div><input className="input section" aria-label="Search rejected goods" placeholder="Find order, supplier or item" value={caseSearch} onChange={e=>{setCaseSearch(e.target.value);setCasePage(0)}}/>{loadState==='loading'?<Empty>Loading follow-ups…</Empty>:loadState==='error'?<Empty>Follow-ups unavailable. Retry above.</Empty>:filteredCases.length===0?<Empty>{caseSearch?'No matching follow-ups.':'No unresolved rejected goods.'}</Empty>:<div className="stack section">{filteredCases.slice(casePage*10,(casePage+1)*10).map(c=><div className="procurement-data-row" key={c.id}><div className="stock-card-title"><div><strong>{itemTitle(c)}</strong><div className="muted tiny">{c.grn_no} · {c.po_no} · {c.supplier_name}</div></div><Badge>{c.status}</Badge></div><div className="stock-mobile-grid"><div><span>Rejected</span><b>{qty(c.rejected_qty)}</b></div><div><span>Reason</span><b>{c.rejection_reason||'—'}</b></div><div><span>Due</span><b>{c.due_date||'—'}</b></div><div><span>Reference</span><b>{c.reference_no||'—'}</b></div></div>{canReceive&&<div className="toolbar section"><button className="btn primary small" onClick={()=>setFollowup(c)}>Update follow-up →</button>{can('procurement.orders.view')&&<button className="btn small" onClick={()=>navigate('po',c.po_id)}>View order</button>}</div>}</div>)}</div>}<ListPages total={filteredCases.length} page={casePage} onChange={setCasePage} pageSize={10} label="Rejected goods"/></div>}
 {followup&&<RejectionFollowup key={followup.id} record={followup} onClose={()=>setFollowup(null)} onSave={saveFollowup}/>}
 </div>
}
