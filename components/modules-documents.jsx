'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {money,qty,itemTitle,whatsappUrl} from '@/lib/helpers'
import {exportPurchaseOrderPdf} from '@/lib/pdf'
import {Badge,DataTable,configuredColumns,fieldEnabled,fieldLabel,Empty,ProcurementPath} from './ui'
import {InfoButton} from './help-ui'

export function PurchaseOrders({profile,fields,company,footer,flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const canEdit=can('procurement.orders.edit')
 const canApprove=can('procurement.orders.approve')
 const[rows,setRows]=useState([]),[total,setTotal]=useState(0),[page,setPage]=useState(0),[active,setActive]=useState(null),[lines,setLines]=useState([]),[filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[busy,setBusy]=useState(false),[poMeta,setPoMeta]=useState({expected_date:'',terms:'',notes:''})
 const pageSize=100
 const load=useCallback(async()=>{
  let q=supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)',{count:'exact'}).order('created_at',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1)
  if(filter!=='all')q=q.eq('status',filter)
  const r=await q
  if(r.error)fail(r.error);else{setRows(r.data||[]);setTotal(r.count||0)}
 },[filter,page,fail])
 useEffect(()=>{load()},[load])
 useEffect(()=>{setPage(0)},[filter])

 async function open(po){
  setActive(po);setPoMeta({expected_date:po.expected_date||'',terms:po.terms||'',notes:po.notes||''})
  const r=await supabase.from('proc_po_lines').select('*,item:proc_items(item_code,description,size,uom)').eq('po_id',po.id).order('id')
  if(r.error)fail(r.error);else setLines(r.data||[])
 }
 async function saveMeta(){
  if(!active||!canEdit)return
  setBusy(true)
  const patch={expected_date:poMeta.expected_date||null,notes:poMeta.notes||null}
  if(active.status==='pending_approval')patch.terms=poMeta.terms||null
  const r=await supabase.from('proc_purchase_orders').update(patch).eq('id',active.id).select('*,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)').single()
  setBusy(false)
  if(r.error)return fail(r.error)
  setActive(r.data);flash('Purchase order details updated.');load()
 }
 async function action(type){
  if(!active)return
  const message=type==='approve'?'Approve this purchase order?':'Confirm that this purchase order was actually sent to the supplier?'
  if(!confirm(message))return
  setBusy(true)
  const r=type==='approve'?await supabase.rpc('proc_approve_po_v2',{p_po_id:active.id}):await supabase.rpc('proc_mark_po_sent_v2',{p_po_id:active.id})
  setBusy(false)
  if(r.error)return fail(r.error)
  flash(type==='approve'?'Purchase order approved.':'Purchase order marked as sent.')
  const u=await supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name,whatsapp,email,phone,address,payment_terms)').eq('id',active.id).single()
  if(!u.error)setActive(u.data)
  load()
 }
 function copy(){
  if(!active)return
  navigator.clipboard.writeText([
   'GENERAL HARDWARE',active.po_no,'Supplier: '+(active.supplier?.name||''),'',
   ...lines.map(l=>`${itemTitle(l.item||{})} — ${qty(l.qty)} ${l.item?.uom||''} @ ${money(l.unit_price)}`),
   active.freight_total?'Freight: '+money(active.freight_total):'',
   '','TOTAL: '+money(active.total)
  ].filter(Boolean).join('\n')).then(()=>flash('Purchase order copied for sharing.')).catch(fail)
 }
 function whatsapp(){
  const url=whatsappUrl(active?.supplier?.whatsapp,`General Hardware — Purchase Order ${active?.po_no||''}\nTotal: ${money(active?.total)}\nPlease confirm availability and delivery.`)
  if(!url)return fail(new Error(t('validation.no_whatsapp','This supplier has no valid WhatsApp number.')))
  window.open(url,'_blank','noopener,noreferrer')
 }
 const filtered=useMemo(()=>rows.filter(r=>(r.po_no+' '+(r.supplier?.name||'')).toLowerCase().includes(search.toLowerCase())),[rows,search])
 const poCols=configuredColumns(fields,'po',[
  {key:'item_code',label:'Code',render:l=><span className="mono tiny">{l.item?.item_code}</span>},
  {key:'description',label:'Item',render:l=><strong>{itemTitle(l.item||{})}</strong>},
  {key:'size',label:'Size',render:l=>l.item?.size||'—'},
  {key:'uom',label:'UOM',render:l=>l.item?.uom||'—'},
  {key:'qty',label:'Qty',render:l=>qty(l.qty)},
  {key:'unit_price',label:'Unit Price',render:l=>money(l.unit_price)},
  {key:'discount_percent',label:'Discount %',render:l=>Number(l.discount_percent||0).toFixed(2)+'%'},
  {key:'tax_percent',label:'Tax %',render:l=>Number(l.tax_percent||0).toFixed(2)+'%'},
  {key:'effective_unit_cost',label:'Effective Unit Cost',render:l=>money(Number(l.unit_price||0)*(1-Number(l.discount_percent||0)/100)*(1+Number(l.tax_percent||0)/100))},
  {key:'landed_unit_cost',label:'Landed Unit Cost',render:l=>l.landed_unit_cost==null?'—':money(l.landed_unit_cost)},
  {key:'line_total',label:'Line Total',render:l=>money(l.line_total)}
 ])
 return <><ProcurementPath active={7} t={t}/><div className="split document-split">
  <div className="card pad"><div className="sectionhead"><div><h3>{t('documents.po_title','Purchase Orders')} <InfoButton topic="po_approval" language={language}/></h3><p>{t('documents.po_hint','Approval, supplier sharing and delivery tracking. Lists are explicitly paged instead of silently truncated.')}</p></div></div>
   <div className="filters two"><input className="input" placeholder="Filter this page by PO or supplier" value={search} onChange={e=>setSearch(e.target.value)}/><select className="select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All statuses</option><option value="pending_approval">Pending approval</option><option value="approved">Approved</option><option value="sent">Sent</option><option value="partially_received">Partially received</option><option value="received">Received</option><option value="closed">Closed</option><option value="cancelled">Cancelled</option></select></div>
   <div className="stack section">{filtered.map(po=><button className={'btn record-button '+(active?.id===po.id?'active-record':'')} key={po.id} onClick={()=>open(po)}><div><strong>{po.po_no}</strong><div className="muted tiny">{po.supplier?.name} · {po.po_date}</div></div><div className="right"><Badge>{po.status}</Badge><div>{money(po.total)}</div></div></button>)}</div>
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Previous</button><span className="muted tiny">{total?page*pageSize+1:0}–{Math.min((page+1)*pageSize,total)} of {total}</span><button className="btn" disabled={(page+1)*pageSize>=total} onClick={()=>setPage(x=>x+1)}>Next</button></div>
  </div>
  <div className="card pad">{!active?<Empty>Select a purchase order.</Empty>:<>
   <div className="sectionhead"><div><h3>{active.po_no}</h3><p>{active.supplier?.name} · {active.po_date}</p></div><Badge>{active.status}</Badge></div>
   <div className="document-meta">
    {fieldEnabled(fields,'po','supplier')&&<div><span>{fieldLabel(fields,'po','supplier','Supplier')}</span><b>{active.supplier?.name||'—'}</b></div>}
    <div><span>Phone</span><b>{active.supplier?.phone||'—'}</b></div>
    {fieldEnabled(fields,'po','po_date')&&<div><span>{fieldLabel(fields,'po','po_date','PO Date')}</span><b>{active.po_date||'—'}</b></div>}
    {fieldEnabled(fields,'po','expected_date')&&<div><span>{fieldLabel(fields,'po','expected_date','Expected Delivery')}</span>{canEdit&&!['received','closed','cancelled'].includes(active.status)?<input className="input" type="date" value={poMeta.expected_date} onChange={e=>setPoMeta(x=>({...x,expected_date:e.target.value}))}/>:<b>{active.expected_date||'—'}</b>}</div>}
    {fieldEnabled(fields,'po','terms')&&<div><span>{fieldLabel(fields,'po','terms','Terms')}</span>{canEdit&&active.status==='pending_approval'?<input className="input" value={poMeta.terms} placeholder={active.supplier?.payment_terms||''} onChange={e=>setPoMeta(x=>({...x,terms:e.target.value}))}/>:<b>{active.terms||active.supplier?.payment_terms||'—'}</b>}</div>}
    {fieldEnabled(fields,'po','freight_total')&&<div><span>{fieldLabel(fields,'po','freight_total','Freight')}</span><b>{money(active.freight_total||0)}</b></div>}
    {fieldEnabled(fields,'po','notes')&&<div><span>{fieldLabel(fields,'po','notes','Notes')}</span>{canEdit&&!['closed','cancelled'].includes(active.status)?<input className="input" value={poMeta.notes} onChange={e=>setPoMeta(x=>({...x,notes:e.target.value}))}/>:<b>{active.notes||'—'}</b>}</div>}
   </div>
   <DataTable columns={poCols} rows={lines} mobileCards/>
   {fieldEnabled(fields,'po','total')&&<div className="document-total"><span>{fieldLabel(fields,'po','total','Total LKR')}</span><strong>{money(active.total)}</strong></div>}
   <div className="toolbar section no-print">
    {canEdit&&['pending_approval','approved','sent','partially_received'].includes(active.status)&&<button className="btn" disabled={busy} onClick={saveMeta}>Save Details</button>}
    {canApprove&&active.status==='pending_approval'&&<button className="btn good" disabled={busy} onClick={()=>action('approve')}>Approve PO</button>}
    {canEdit&&active.status==='approved'&&<button className="btn primary" disabled={busy} onClick={()=>action('send')}>Confirm Sent</button>}
    <button className="btn" onClick={()=>exportPurchaseOrderPdf({po:active,lines,company,footer,fields})}>Download PDF</button>
    <button className="btn" onClick={copy}>Copy</button>
    {active.supplier?.whatsapp&&<button className="btn" onClick={whatsapp}>WhatsApp</button>}
   </div>
  </>}</div>
 </div>
 </>
}

export function Invoices({profile,fields,features=[],flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const canEdit=can('invoices.manage')
 const canResolve=features.find(x=>x.feature_key==='invoices.variance_resolution')?.enabled!==false
 const[pos,setPos]=useState([]),[invoices,setInvoices]=useState([]),[invoiceTotal,setInvoiceTotal]=useState(0),[page,setPage]=useState(0),[poId,setPoId]=useState(''),[lines,setLines]=useState([]),[vals,setVals]=useState({}),[receiptMap,setReceiptMap]=useState({}),[invoice,setInvoice]=useState(''),[file,setFile]=useState(null),[busy,setBusy]=useState(false)
 const[resolutionTarget,setResolutionTarget]=useState(null),[resolutionAction,setResolutionAction]=useState('request_revised_invoice'),[resolutionNotes,setResolutionNotes]=useState(''),[creditNote,setCreditNote]=useState('')
 const pageSize=100
 const load=useCallback(async()=>{try{
  const[a,b]=await Promise.all([
   supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name)').in('status',['approved','sent','partially_received','received']).order('created_at',{ascending:false}),
   supabase.from('proc_supplier_invoices').select('*,supplier:proc_suppliers(name),po:proc_purchase_orders(po_no)',{count:'exact'}).order('created_at',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1)
  ])
  if(a.error)throw a.error;if(b.error)throw b.error;setPos(a.data||[]);setInvoices(b.data||[]);setInvoiceTotal(b.count||0)
 }catch(e){fail(e)}},[fail,page])
 useEffect(()=>{load()},[load])
 useEffect(()=>{if(!poId){setLines([]);setVals({});setReceiptMap({});return}(async()=>{
  const[a,b]=await Promise.all([
   supabase.from('proc_po_lines').select('*,item:proc_items(description,size,uom)').eq('po_id',poId),
   supabase.from('proc_v_invoiceable_po_lines').select('po_line_id,accepted_qty,invoiced_qty,invoiceable_qty').eq('po_id',poId)
  ])
  if(a.error)return fail(a.error);if(b.error)return fail(b.error)
  setLines(a.data||[])
  setReceiptMap(Object.fromEntries((b.data||[]).map(x=>[x.po_line_id,{
   accepted:Number(x.accepted_qty||0),invoiced:Number(x.invoiced_qty||0),invoiceable:Number(x.invoiceable_qty||0)
  }])))
  setVals(Object.fromEntries((a.data||[]).map(x=>[x.id,{qty:'',price:'',discount:'',tax:''}])))
 })()},[poId,fail])

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
  const invoiceLines=lines.filter(l=>vals[l.id]?.qty!==undefined&&vals[l.id]?.qty!==''&&Number(vals[l.id]?.qty)>0)
  if(!invoiceLines.length)return fail(new Error('Enter at least one invoiced quantity. Leave lines not on this supplier invoice blank.'))
  const incomplete=invoiceLines.some(l=>['price','discount','tax'].some(k=>vals[l.id]?.[k]===undefined||vals[l.id]?.[k]===''))
  if(incomplete)return fail(new Error('Complete price, discount and tax for each line included on this supplier invoice.'))
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
  if(!resolutionTarget)return
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
    <div className="field"><label>{label('purchase_order','Purchase Order')}</label><select className="select" value={poId} onChange={e=>setPoId(e.target.value)}><option value="">Select PO…</option>{pos.map(p=><option key={p.id} value={p.id}>{p.po_no} · {p.supplier?.name}</option>)}</select></div>
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
   <div className="mobile-card-list section">{lines.map(l=>{const v=vals[l.id]||{};const bad=lineBad(l,v);return <div className="mobile-data-card" key={l.id}><div className="stock-card-title"><strong>{itemTitle(l.item||{})}</strong><button className="btn small" onClick={()=>sameAsPo(l)}>{t('invoices.same','Same as PO')}</button></div><div className="formgrid section">
     {show('po_qty')&&<div className="field"><label>PO Qty</label><div className="read-box">{qty(l.qty)}</div></div>}<div className="field"><label>Accepted</label><div className="read-box">{qty(receiptMap[l.id]?.accepted||0)}</div></div><div className="field"><label>Already Invoiced</label><div className="read-box">{qty(receiptMap[l.id]?.invoiced||0)}</div></div><div className="field"><label>Invoiceable</label><div className="read-box"><b>{qty(receiptMap[l.id]?.invoiceable||0)}</b></div></div>{show('invoice_qty')&&<div className="field"><label>Invoice Qty</label><input className="input" inputMode="decimal" value={v.qty??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,qty:e.target.value}}))}/></div>}
     {show('po_price')&&<div className="field"><label>PO Price</label><div className="read-box">{money(l.unit_price)}</div></div>}{show('invoice_price')&&<div className="field"><label>Invoice Price</label><input className="input" inputMode="decimal" value={v.price??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,price:e.target.value}}))}/></div>}
     {show('invoice_discount')&&<div className="field"><label>Invoice Discount %</label><input className="input" inputMode="decimal" value={v.discount??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,discount:e.target.value}}))}/></div>}
     {show('invoice_tax')&&<div className="field"><label>Invoice Tax %</label><input className="input" inputMode="decimal" value={v.tax??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,tax:e.target.value}}))}/></div>}
    </div>{show('match_status')&&<Badge>{v.qty===''?'unconfirmed':bad?'variance':'matched'}</Badge>}</div>})}</div>
   <button className="btn primary section" disabled={busy} onClick={save}>{busy?t('common.saving','Saving…'):t('invoices.save_match','Save & Match Invoice')}</button></>}
  </div>

  <div className="card pad"><div className="sectionhead"><div><h3>{t('invoices.supplier_invoices','Supplier Invoices')}</h3><p>{t('invoices.supplier_hint','Variance invoices have a tracked resolution lifecycle instead of a permanent red flag.')}</p></div></div>
   <div className="stack">{invoices.map(inv=><button className="btn record-button" key={inv.id} onClick={()=>inv.status==='variance'&&canResolve&&setResolutionTarget(inv)}><div><strong>{inv.invoice_no}</strong><div className="muted tiny">{inv.supplier?.name} · {inv.po?.po_no||'No PO'} · {inv.invoice_date}</div></div><div className="right"><Badge>{inv.status}</Badge>{inv.variance_resolution_status&&inv.variance_resolution_status!=='not_required'&&<Badge>{inv.variance_resolution_status}</Badge>}<div>{money(inv.total)}</div></div></button>)}</div>
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{invoiceTotal?page*pageSize+1:0}–{Math.min((page+1)*pageSize,invoiceTotal)} {t('common.of','of')} {invoiceTotal}</span><button className="btn" disabled={(page+1)*pageSize>=invoiceTotal} onClick={()=>setPage(x=>x+1)}>{t('common.next','Next')}</button></div>
   {resolutionTarget&&<div className="card pad section variance-resolution"><div className="sectionhead"><div><h4>{t('invoices.resolve','Resolve')} {resolutionTarget.invoice_no}</h4><p>{t('invoices.current_status','Current status')}: {resolutionTarget.variance_resolution_status||'open'}</p></div><button className="btn small" onClick={()=>setResolutionTarget(null)}>{t('common.close','Close')}</button></div><div className="formgrid"><div className="field"><label>Action</label><select className="select" value={resolutionAction} onChange={e=>setResolutionAction(e.target.value)}><option value="request_revised_invoice">Request Revised Invoice</option><option value="request_credit_note">Request Credit Note</option><option value="credit_note_received">Credit Note Received</option><option value="dispute">Dispute</option>{canEdit&&<><option value="approve_difference">Approve Difference</option><option value="resolve">Resolve / Close</option><option value="reject">Reject Invoice</option></>}</select></div><div className="field"><label>Reference / Credit Note</label><input className="input" value={creditNote} onChange={e=>setCreditNote(e.target.value)}/></div><div className="field wide"><label>Resolution Notes</label><input className="input" value={resolutionNotes} onChange={e=>setResolutionNotes(e.target.value)}/></div></div><button className="btn primary section" disabled={busy} onClick={resolveVariance}>Record Variance Action</button></div>}
  </div>
 </div>
}

export function Receiving({profile,fields,features=[],flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const canReceive=can('receiving.manage')
 const[pos,setPos]=useState([]),[poId,setPoId]=useState(''),[lines,setLines]=useState([]),[vals,setVals]=useState({}),[notes,setNotes]=useState(''),[busy,setBusy]=useState(false),[cases,setCases]=useState([])
 const rejectionEnabled=features.find(x=>x.feature_key==='receiving.rejection_followup')?.enabled!==false
 const receiptKey=useRef(globalThis.crypto?.randomUUID?.()||('receipt-'+Date.now()))

 const loadPos=useCallback(async()=>{try{
  const promises=[supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name)').in('status',['sent','partially_received']).order('created_at',{ascending:false})]
  if(rejectionEnabled&&can('receiving.view'))promises.push(supabase.from('proc_v_rejection_cases').select('*').neq('status','resolved').order('created_at',{ascending:false}).limit(500))
  const data=await Promise.all(promises)
  if(data[0].error)throw data[0].error;setPos(data[0].data||[])
  if(data[1]){if(data[1].error)throw data[1].error;setCases(data[1].data||[])}
 }catch(e){fail(e)}},[fail,rejectionEnabled,can])
 useEffect(()=>{loadPos()},[loadPos])
 useEffect(()=>{if(!poId){setLines([]);setVals({});return}(async()=>{const r=await supabase.from('proc_po_lines').select('*,item:proc_items(description,size,uom),grn:proc_grn_lines(accepted_qty)').eq('po_id',poId);if(r.error)return fail(r.error);const data=r.data||[];setLines(data);setVals(Object.fromEntries(data.map(x=>[x.id,{received:'',accepted:'',rejected:'0',reason:''}])))})()},[poId,fail])

 const already=l=>(l.grn||[]).reduce((s,x)=>s+Number(x.accepted_qty||0),0)
 const remaining=l=>Math.max(Number(l.qty||0)-already(l),0)
 const isFull=l=>{const v=vals[l.id]||{},rem=remaining(l);return rem>0&&Number(v.received||0)===rem&&Number(v.accepted||0)===rem&&Number(v.rejected||0)===0}
 function setFull(l,on){const rem=remaining(l);setVals(x=>({...x,[l.id]:on?{...x[l.id],received:String(rem),accepted:String(rem),rejected:'0',reason:''}:{...x[l.id],received:'',accepted:'',rejected:'0',reason:''}}))}
 function setAllFull(){setVals(x=>{const next={...x};for(const l of lines){const rem=remaining(l);if(rem>0)next[l.id]={...next[l.id],received:String(rem),accepted:String(rem),rejected:'0',reason:''}}return next})}

 async function post(){
  const po=pos.find(x=>x.id===poId);if(!po)return fail(new Error(t('validation.select_po','Select a purchase order.')))
  const payload=lines.filter(l=>Number(vals[l.id]?.received||0)>0||Number(vals[l.id]?.accepted||0)>0||Number(vals[l.id]?.rejected||0)>0).map(l=>({po_line_id:l.id,received_qty:Number(vals[l.id]?.received||0),accepted_qty:Number(vals[l.id]?.accepted||0),rejected_qty:Number(vals[l.id]?.rejected||0),rejection_reason:vals[l.id]?.reason||null}))
  if(!payload.length)return fail(new Error(t('validation.receive_one','Enter at least one received quantity.')))
  for(const x of payload){
   if(x.received_qty<0||x.accepted_qty<0||x.rejected_qty<0||x.accepted_qty+x.rejected_qty>x.received_qty)return fail(new Error(t('validation.receive_math','Accepted + rejected must not exceed received quantity, and quantities cannot be negative.')))
   if(x.rejected_qty>0&&!String(x.rejection_reason||'').trim())return fail(new Error('Enter a rejection reason for every rejected quantity.'))
  }
  if(!confirm(t('confirm.post_receipt','Post this goods receipt? Accepted quantities will immediately update stock.')))return
  setBusy(true)
  const r=await supabase.rpc('proc_receive_po_v3',{p_po_id:po.id,p_receipt_key:receiptKey.current,p_lines:payload,p_notes:notes||null})
  setBusy(false)
  if(r.error)return fail(r.error)
  flash(r.data.grn_no+(r.data.replayed?' already posted — duplicate retry ignored.':' posted. Stock and reconciliation updated.'))
  receiptKey.current=globalThis.crypto?.randomUUID?.()||('receipt-'+Date.now())
  setPoId('');setLines([]);setVals({});setNotes('');loadPos()
 }

 async function resolveCase(c,action){
  let reference=null,due=null,note=null
  if(['replacement_requested','credit_note_requested'].includes(action))due=prompt(t('prompt.followup_due','Follow-up due date (YYYY-MM-DD, optional):'),'')||null
  if(['returned_to_supplier','replacement_received','credit_note_received','close_other'].includes(action))reference=prompt(t('prompt.reference_optional','Reference / document number (optional):'),'')||null
  if(action==='credit_note_received'&&!reference)return fail(new Error(t('validation.credit_reference','Credit note/reference number is required.')))
  note=prompt(t('prompt.notes_optional','Notes (optional):'),'')||null
  const r=await supabase.rpc('proc_resolve_rejection_case_v1',{p_case_id:c.id,p_action:action,p_notes:note,p_reference_no:reference,p_due_date:due})
  if(r.error)return fail(r.error)
  flash('Rejected-goods case updated: '+String(r.data.status).replaceAll('_',' ')+'.');loadPos()
 }

 const show=k=>fieldEnabled(fields,'receiving',k)
 const label=(k,v)=>fieldLabel(fields,'receiving',k,v)
 return <div className="stack">
  <div className="card pad">
   <div className="sectionhead"><div><h3>{t('receiving.title','Goods Receiving')} <InfoButton topic="receiving" language={language}/></h3><p>{t('receiving.hint','Accepted stock is retry-safe and cannot exceed the outstanding PO quantity. Rejected quantities create follow-up cases automatically.')}</p></div>{canReceive&&<div className="toolbar"><button className="btn" disabled={!lines.length} onClick={setAllFull}>✓ Mark All Remaining Received</button><button className="btn primary" disabled={busy||!lines.length} onClick={post}>{busy?'Posting…':'Post GRN'}</button></div>}</div>
   <div className="formgrid"><div className="field"><label>{label('purchase_order','Purchase Order')}</label><select className="select" value={poId} onChange={e=>setPoId(e.target.value)}><option value="">Select a sent PO…</option>{pos.map(p=><option key={p.id} value={p.id}>{p.po_no} · {p.supplier?.name}</option>)}</select></div>{show('notes')&&<div className="field"><label>{label('notes','Receiving Notes')}</label><input className="input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Optional"/></div>}</div>
   {lines.length>0&&<><div className="desktop-table tablewrap section"><table className="table"><thead><tr><th>✓ Full</th>{show('description')&&<th>Item</th>}{show('ordered_qty')&&<th>Ordered</th>}{show('previously_accepted')&&<th>Previously Accepted</th>}{show('received_qty')&&<th>Received Now</th>}{show('accepted_qty')&&<th>Accepted</th>}{show('rejected_qty')&&<th>Rejected</th>}{show('rejection_reason')&&<th>Reason</th>}</tr></thead><tbody>{lines.map(l=>{const v=vals[l.id]||{};return <tr key={l.id}><td className="center"><input type="checkbox" checked={isFull(l)} disabled={!canReceive||remaining(l)<=0} onChange={e=>setFull(l,e.target.checked)}/></td>{show('description')&&<td><strong>{itemTitle(l.item||{})}</strong></td>}{show('ordered_qty')&&<td>{qty(l.qty)}</td>}{show('previously_accepted')&&<td>{qty(already(l))}<div className="muted tiny">Remaining {qty(remaining(l))}</div></td>}{show('received_qty')&&<td><input className="input stock-entry" inputMode="decimal" disabled={!canReceive} value={v.received??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,received:e.target.value}}))}/></td>}{show('accepted_qty')&&<td><input className="input stock-entry" inputMode="decimal" disabled={!canReceive} value={v.accepted??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,accepted:e.target.value}}))}/></td>}{show('rejected_qty')&&<td><input className="input stock-entry" inputMode="decimal" disabled={!canReceive} value={v.rejected??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,rejected:e.target.value}}))}/></td>}{show('rejection_reason')&&<td><input className="input" disabled={!canReceive} value={v.reason??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,reason:e.target.value}}))}/></td>}</tr>})}</tbody></table></div>
   <div className="mobile-card-list">{lines.map(l=>{const v=vals[l.id]||{};return <div className="mobile-data-card" key={l.id}><div className="stock-card-title"><strong>{itemTitle(l.item||{})}</strong><label className="receive-full-check"><input type="checkbox" checked={isFull(l)} disabled={!canReceive||remaining(l)<=0} onChange={e=>setFull(l,e.target.checked)}/> ✓ Full</label></div><div className="muted tiny">Ordered {qty(l.qty)} · Accepted {qty(already(l))} · Remaining {qty(remaining(l))}</div><div className="formgrid section">{show('received_qty')&&<div className="field"><label>Received</label><input className="input" inputMode="decimal" disabled={!canReceive} value={v.received??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,received:e.target.value}}))}/></div>}{show('accepted_qty')&&<div className="field"><label>Accepted</label><input className="input" inputMode="decimal" disabled={!canReceive} value={v.accepted??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,accepted:e.target.value}}))}/></div>}{show('rejected_qty')&&<div className="field"><label>Rejected</label><input className="input" inputMode="decimal" disabled={!canReceive} value={v.rejected??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,rejected:e.target.value}}))}/></div>}{show('rejection_reason')&&<div className="field"><label>Reason</label><input className="input" disabled={!canReceive} value={v.reason??''} onChange={e=>setVals(x=>({...x,[l.id]:{...v,reason:e.target.value}}))}/></div>}</div></div>})}</div></>}
  </div>

  {rejectionEnabled&&can('receiving.view')&&<div className="card pad"><div className="sectionhead"><div><h3>Rejected Goods Follow-up</h3><p>Every rejected GRN quantity remains open until it is returned, replaced, credited or deliberately closed.</p></div><Badge>{cases.length} open</Badge></div>{cases.length===0?<Empty>No unresolved rejected goods.</Empty>:<div className="stack section">{cases.map(c=><div className="mobile-data-card" key={c.id}><div className="stock-card-title"><div><strong>{itemTitle(c)}</strong><div className="muted tiny">{c.grn_no} · {c.po_no} · {c.supplier_name}</div></div><Badge>{c.status}</Badge></div><div className="stock-mobile-grid"><div><span>Rejected</span><b>{qty(c.rejected_qty)}</b></div><div><span>Reason</span><b>{c.rejection_reason||'—'}</b></div><div><span>Due</span><b>{c.due_date||'—'}</b></div><div><span>Reference</span><b>{c.reference_no||'—'}</b></div></div>{canReceive&&<div className="toolbar section"><button className="btn small" onClick={()=>resolveCase(c,'returned_to_supplier')}>Returned</button><button className="btn small" onClick={()=>resolveCase(c,'replacement_requested')}>Request Replacement</button><button className="btn small" onClick={()=>resolveCase(c,'credit_note_requested')}>Request Credit Note</button><button className="btn small good" onClick={()=>resolveCase(c,'replacement_received')}>Replacement Received</button><button className="btn small good" onClick={()=>resolveCase(c,'credit_note_received')}>Credit Note Received</button>{canReceive&&<button className="btn small" onClick={()=>resolveCase(c,'accept_loss')}>Accept Loss</button>}</div>}</div>)}</div>}</div>}
 </div>
}
