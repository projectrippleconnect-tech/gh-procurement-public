'use client'

import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {money,qty,stamp,itemTitle,whatsappUrl,formatSriLankaSupplierPhoneInput,toSriLankaSupplierPhone,normalizeWhatsAppNumber} from '@/lib/helpers'
import {encodeSupplierQuoteNotes,decodeSupplierQuoteNotes,validateSupplierQuoteVariants} from '@/lib/quote-line-notes'
import {Badge,DataTable,configuredColumns,fieldEnabled,fieldLabel,Empty,ProcurementPath} from './ui'
import {InfoButton} from './help-ui'
import {extractPriceListFile} from '@/lib/price-list-extract'
import {exportSupplierPriceRequestPdf} from '@/lib/pdf'
import {buildSupplierQuoteReplyText,buildSupplierPngShareText,createSupplierPriceRequestPng,downloadSupplierPriceRequestPng} from '@/lib/rfq-share'

export function Requirements({profile,fields,features=[],flash,fail,can=()=>false,navigate=()=>{},t=(k,f)=>f||k}){
 const canAdd=can('procurement.requirements.manage')
 const canReview=can('procurement.requirements.manage')
 const specialEnabled=features.find(x=>x.feature_key==='requirements.special_requests')?.enabled!==false
 const[rows,setRows]=useState([]),[suppliers,setSuppliers]=useState([]),[selected,setSelected]=useState(new Set()),[chosen,setChosen]=useState(new Set()),[suggestedSuppliers,setSuggestedSuppliers]=useState([]),[due,setDue]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0),[total,setTotal]=useState(0),[scopeOverrides,setScopeOverrides]=useState({})
 const pageSize=200
 const[oldestFirst,setOldestFirst]=useState(false)
 const[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([]),[manualQty,setManualQty]=useState(''),[manualNote,setManualNote]=useState('')
 const[addMode,setAddMode]=useState('standard'),[specialItem,setSpecialItem]=useState(null)
 const[special,setSpecial]=useState({reason:'customer_request',customer_qty:'',purchase_qty:'',customer_reference:'',notes:'',priority:''})
 const[stage,setStage]=useState(canReview?'pending_review':'all')
 const[summary,setSummary]=useState({review:0,rfq:0,quotes:0,orders:0})
 const[controlCounts,setControlCounts]=useState({outstanding:null,overdue:null,uncovered:null,delivery:null})
 const[controlFilter,setControlFilter]=useState('all')
 const changeStage=next=>{setSelected(new Set());setPage(0);setControlFilter('all');setStage(next)}

 const reasonLabels={
  customer_request:'Customer request',
  customer_paid:'Customer already paid / committed',
  seasonal_stock:'Seasonal demand / expected sale',
  low_price_opportunity:'Low-price buying opportunity',
  bulk_sale:'Bulk sale / sudden depletion',
  project_order:'Project / contractor order',
  promotional_stock:'Promotion / campaign stock',
  manual_extra:'Other planned extra stock'
 }

 const load=useCallback(async()=>{try{
  let q=supabase.from('proc_v_requirements').select('*',{count:'exact'}).in('status',['open','quoting','partially_ordered','ordered','partially_received']).order(oldestFirst?'created_at':'source_activity_at',{ascending:!oldestFirst}).range(page*pageSize,page*pageSize+pageSize-1)
  if(stage==='pending_review')q=q.eq('approval_status','pending_review')
  if(stage==='approved')q=q.eq('approval_status','approved').gt('remaining_to_order',0).eq('has_active_rfq',false)
  if(stage==='held')q=q.eq('approval_status','held')
  if(stage==='attention')q=q.eq('approval_status','approved').gt('remaining_to_order',0)
  if(stage==='overdue')q=q.eq('approval_status','approved').gt('remaining_to_order',0).lt('created_at',new Date(Date.now()-10*86400000).toISOString())
  if(stage==='delivery')q=q.gt('ordered_not_received',0)
  if(stage==='uncovered')q=q.eq('approval_status','approved').gt('remaining_to_order',0).eq('has_active_rfq',false)
  if(controlFilter==='urgent')q=q.eq('priority','urgent')
  if(controlFilter==='partial')q=q.gt('ordered_qty',0).gt('remaining_to_order',0).eq('approval_status','approved')
  const tasks=[q]
  if(canReview){
   tasks.push(supabase.from('proc_suppliers').select('id,supplier_code,name').eq('active',true).order('name'))
   tasks.push(supabase.from('proc_requirements').select('id',{count:'exact',head:true}).eq('approval_status','pending_review').in('status',['open','quoting','partially_ordered','ordered','partially_received']))
   tasks.push(supabase.from('proc_rfqs').select('id',{count:'exact',head:true}).in('status',['prepared','sent','partially_quoted']))
   tasks.push(supabase.from('proc_rfqs').select('id',{count:'exact',head:true}).eq('status','quoted'))
   tasks.push(supabase.from('proc_purchase_orders').select('id',{count:'exact',head:true}).in('status',['pending_approval','approved','sent','partially_received']))
   tasks.push(supabase.from('proc_v_requirements').select('id',{count:'exact',head:true}).eq('approval_status','approved').gt('remaining_to_order',0))
   tasks.push(supabase.from('proc_v_requirements').select('id',{count:'exact',head:true}).eq('approval_status','approved').gt('remaining_to_order',0).lt('created_at',new Date(Date.now()-10*86400000).toISOString()))
   tasks.push(supabase.from('proc_v_requirements').select('id',{count:'exact',head:true}).eq('approval_status','approved').gt('remaining_to_order',0).eq('has_active_rfq',false))
   tasks.push(supabase.from('proc_v_requirements').select('id',{count:'exact',head:true}).gt('ordered_not_received',0))
  }
  const results=await Promise.all(tasks)
  const a=results[0];if(a.error)throw a.error;setRows(a.data||[]);setTotal(a.count||0)
  if(canReview){
   const b=results[1];if(b.error)throw b.error;setSuppliers(b.data||[])
   for(const x of results.slice(2))if(x.error)throw x.error
   setSummary({review:results[2].count||0,rfq:results[3].count||0,quotes:results[4].count||0,orders:results[5].count||0})
   setControlCounts({outstanding:results[6].count||0,overdue:results[7].count||0,uncovered:results[8].count||0,delivery:results[9].count||0})
  }
 }catch(e){fail(e)}},[fail,stage,canReview,page,oldestFirst,controlFilter])
 useEffect(()=>{load()},[load])
 useEffect(()=>{setPage(0);setChosen(new Set());setScopeOverrides({})},[stage])

 useEffect(()=>{
  if(!canAdd||itemSearch.trim().length<2){setItemResults([]);return}
  const t=setTimeout(async()=>{
   const r=await supabase.rpc('proc_search_stock_items_v1',{p_query:itemSearch.trim(),p_category:null,p_main_group:null,p_movement:null,p_limit:20})
   if(r.error)return fail(r.error)
   setItemResults((r.data||[]).map(x=>({...x,id:x.item_id})))
  },160)
  return()=>clearTimeout(t)
 },[itemSearch,canAdd,fail])

 useEffect(()=>{
  if(!canReview||!selected.size){setSuggestedSuppliers([]);return}
  const approved=[...selected].filter(id=>rows.find(r=>r.id===id)?.approval_status==='approved')
  if(!approved.length){setSuggestedSuppliers([]);return}
  const timer=setTimeout(async()=>{const r=await supabase.rpc('proc_suggest_suppliers',{p_requirement_ids:approved});if(r.error)return fail(r.error);setSuggestedSuppliers(r.data||[])},220)
  return()=>clearTimeout(timer)
 },[selected,rows,canReview,fail])

 async function addManual(item){
  const n=Number(manualQty);if(!Number.isFinite(n)||n<=0)return fail(new Error(t('requirements.qty_positive','Enter a required quantity greater than zero.')))
  setBusy(true);const r=await supabase.rpc('proc_add_requirement_v2',{p_item_id:item.id,p_required_qty:n,p_notes:manualNote||null});setBusy(false)
  if(r.error)return fail(r.error)
  flash(itemTitle(item)+' added to Procurement Review.');setItemSearch('');setItemResults([]);setManualQty('');setManualNote('');load()
 }

 function chooseSpecial(item){
  setSpecialItem(item);setItemResults([]);setItemSearch('')
  const current=Number(item.book_stock||0),max=Number(item.max_stock||0)
  const topUp=Math.max(max-current,0)
  setSpecial(x=>({...x,purchase_qty:topUp>0?String(topUp):'',customer_qty:''}))
 }
 function smartQty(kind){
  if(!specialItem)return
  const current=Number(specialItem.book_stock||0),max=Number(specialItem.max_stock||0),requested=Number(special.customer_qty||0)
  let n=0
  if(kind==='minimum_customer')n=Math.max(requested-current,0)
  if(kind==='customer_plus_max')n=Math.max(requested+max-current,0)
  if(kind==='top_up_max')n=Math.max(max-current,0)
  if(kind==='one_max_extra')n=Math.max(max,1)
  if(kind==='two_max_extra')n=Math.max(max*2,1)
  if(n>0)setSpecial(x=>({...x,purchase_qty:String(n)}))
 }
 async function addSpecial(){
  if(!specialItem)return fail(new Error(t('requirements.select_special_item','Select an item for the special purchase request.')))
  const purchase=Number(special.purchase_qty),requested=special.customer_qty===''?null:Number(special.customer_qty)
  if(!Number.isFinite(purchase)||purchase<=0)return fail(new Error(t('requirements.purchase_positive','Enter a purchase quantity greater than zero.')))
  if(['customer_request','customer_paid'].includes(special.reason)&&(requested===null||!Number.isFinite(requested)||requested<=0))return fail(new Error(t('requirements.customer_qty_error','Enter the customer requested quantity.')))
  setBusy(true)
  const r=await supabase.rpc('proc_add_special_purchase_request_v1',{
   p_item_id:specialItem.id,p_purchase_qty:purchase,p_reason:special.reason,
   p_customer_requested_qty:requested,p_customer_reference:special.customer_reference||null,
   p_notes:special.notes||null,p_priority:special.priority||null
  })
  setBusy(false)
  if(r.error)return fail(r.error)
  flash('Special purchase '+r.data.requirement_no+' created for '+itemTitle(specialItem)+'.')
  setSpecialItem(null);setSpecial({reason:'customer_request',customer_qty:'',purchase_qty:'',customer_reference:'',notes:'',priority:''});load()
 }

 async function setQty(id,v){
  if(!canReview)return
  const n=Number(v);if(!Number.isFinite(n)||n<0)return fail(new Error(t('requirements.adjusted_nonnegative','Adjusted quantity must be zero or positive.')))
  const r=await supabase.rpc('proc_update_requirement_qty_v2',{p_requirement_id:id,p_adjusted_qty:n})
  if(r.error)return fail(r.error);flash('Requirement quantity updated.');load()
 }
 async function setMeta(id,key,value){
  if(!canReview)return
  const patch={[key]:value===''?null:value};const r=await supabase.from('proc_requirements').update(patch).eq('id',id)
  if(r.error)fail(r.error);else{flash('Requirement updated.');load()}
 }
 async function review(action,ids=[...selected]){
  if(!canReview||!ids.length)return fail(new Error(t('requirements.select_one','Select at least one requirement.')))
  const reason=action==='approve'?null:(prompt(action==='hold'?'Reason for holding these items (optional):':'Reason for rejecting these items (optional):')||null)
  const r=await supabase.rpc('proc_review_requirements',{p_requirement_ids:ids,p_action:action,p_selected:action==='approve',p_reason:reason})
  if(r.error)return fail(r.error)
  flash((r.data||ids.length)+' requirement(s) '+(action==='approve'?'approved for supplier pricing':action==='hold'?'placed on hold':'rejected')+'.');setChosen(new Set());if(action==='approve'){setSelected(new Set(ids));setStage('approved')}else{setSelected(new Set());load()}
 }
 async function create(){
  if(!canReview)return
  const ids=[...selected].filter(id=>{const r=rows.find(x=>x.id===id);return r?.approval_status==='approved'&&Number(r.remaining_to_order)>0})
  if(!ids.length)return fail(new Error(t('requirements.select_approved','Select at least one approved requirement with quantity still to order.')))
  if(!chosen.size)return fail(new Error(t('requirements.select_supplier','Select at least one supplier.')))
  const unmatched=[...chosen].filter(id=>!suggestedSuppliers.some(s=>s.supplier_id===id))
  const missingReason=unmatched.find(id=>!String(scopeOverrides[id]||'').trim())
  if(missingReason){
   const name=suppliers.find(s=>s.id===missingReason)?.name||'Selected supplier'
   return fail(new Error(name+' does not match the configured coverage for these items. Enter an override reason before requesting prices.'))
  }
  setBusy(true)
  const enable=await supabase.from('proc_requirements').update({selected_for_order:true,updated_at:new Date().toISOString()}).in('id',ids).eq('approval_status','approved')
  if(enable.error){setBusy(false);return fail(enable.error)}
  const r=await supabase.rpc('proc_create_rfq_v4',{
   p_requirement_ids:ids,p_supplier_ids:[...chosen],p_due_date:due||null,p_notes:null,p_scope_overrides:scopeOverrides
  })
  setBusy(false)
  if(r.error)return fail(r.error)
  flash('RFQ '+r.data.rfq_no+' prepared for '+ids.length+' item(s). Next: send it and enter supplier prices.');setSelected(new Set());setChosen(new Set());setScopeOverrides({});setDue('');load();navigate('rfq')
 }

 const defaults=[
  {key:'requirement_no',label:'Requirement',render:r=><span className="mono tiny">{r.requirement_no}</span>},
  {key:'description',label:'Item',render:r=><><strong>{itemTitle(r)}</strong><div className="muted tiny">{r.uom||''}</div></>},
  {key:'size',label:'Size'},{key:'uom',label:'UOM'},
  {key:'current_stock',label:'Stock',render:r=>qty(r.current_stock??r.request_stock_snapshot??0)},
  {key:'reorder_level',label:'Reorder',render:r=>qty(r.reorder_level??r.request_reorder_snapshot??0)},
  {key:'max_stock',label:'Max',render:r=>qty(r.max_stock??r.request_max_stock_snapshot??0)},
  {key:'required_qty',label:'Suggested',render:r=>qty(r.required_qty)},
  {key:'adjusted_qty',label:'Approved Qty',render:r=>canReview?<input className="input stock-entry" defaultValue={r.adjusted_qty} onBlur={e=>setQty(r.id,e.target.value)}/>:qty(r.adjusted_qty)},
  {key:'age',label:'Waiting',render:r=>{const age=Math.max(0,Math.floor((Date.now()-new Date(r.created_at).getTime())/86400000));return Number(r.remaining_to_order)>0?<strong className={age>=10?'warn-text':''}>{Number.isFinite(age)?age+'d':'—'}</strong>:'—'}},
  {key:'remaining_to_order',label:'Still To Order',render:r=><strong className="warn-text">{qty(r.remaining_to_order)}</strong>},
  {key:'request_reason',label:'Reason',render:r=>r.request_reason?<Badge>{String(r.request_reason).replaceAll('_',' ')}</Badge>:(r.urgency_reason?<Badge>{String(r.urgency_reason).replaceAll('_',' ')}</Badge>:'—')},
  {key:'special_requested_qty',label:'Customer / Special Qty',render:r=>r.special_requested_qty==null?'—':qty(r.special_requested_qty)},
  {key:'priority',label:'Priority',render:r=><Badge>{r.priority}</Badge>},
  {key:'urgency_reason',label:'Urgency',render:r=>r.urgency_reason?<><Badge>{r.urgency_reason}</Badge>{r.customer_paid&&<div className="muted tiny">customer paid</div>}</>:'—'},
  {key:'approval_status',label:'Review',render:r=><Badge>{r.approval_status}</Badge>},
  {key:'status',label:'Workflow',render:r=><Badge>{r.status}</Badge>}
 ]
 const attention=rows.filter(r=>r.approval_status==='approved'&&Number(r.remaining_to_order)>0)
 const overdue=attention.filter(r=>Date.now()-new Date(r.created_at).getTime()>=10*86400000)
 const uncovered=attention.filter(r=>!r.has_active_rfq)
 const waitingDelivery=rows.filter(r=>Number(r.ordered_not_received)>0)
 const ageing=(r)=>Math.max(0,Math.floor((Date.now()-new Date(r.created_at).getTime())/86400000))
 const urgent=[...attention].sort((a,b)=>ageing(b)-ageing(a)).slice(0,5)
 const cols=configuredColumns(fields,'requirements',defaults)

 return <>
  {canReview&&<section className="card pad section" aria-label="Procurement control summary">
   <div className="sectionhead"><div><h3>Procurement Control</h3><p>Open requirements and next actions. Counts cover all matching requirements; the oldest-item preview shows the current page.</p></div></div>
   <div className="formgrid">
    <button type="button" className="btn" onClick={()=>changeStage('attention')}><strong>{controlCounts.outstanding??'…'}</strong> Still to order</button>
    <button type="button" className="btn" onClick={()=>{changeStage('overdue');setOldestFirst(true);setPage(0)}}><strong>{controlCounts.overdue??'…'}</strong> Waiting 10+ days</button>
    <button type="button" className="btn" onClick={()=>changeStage('uncovered')}><strong>{controlCounts.uncovered??'…'}</strong> No active RFQ</button>
    <button type="button" className="btn" onClick={()=>changeStage('delivery')}><strong>{controlCounts.delivery??'…'}</strong> Awaiting receipt</button>
   </div>
   {urgent.length>0&&<details><summary><strong>Oldest outstanding items</strong> — view priority list</summary>
    <div className="stack section">{urgent.map(r=><div className="row wrap" key={r.id} style={{justifyContent:'space-between',gap:8}}>
     <div><strong>{itemTitle(r)}</strong><div className="muted tiny">{qty(r.remaining_to_order)} {r.uom||''} still to order · {ageing(r)} days waiting</div></div>
     <button type="button" className="btn small" onClick={()=>{changeStage('all');setOldestFirst(true);setPage(0)}}>View requirements</button>
    </div>)}</div>
   </details>}
  </section>}
  <nav aria-label="Procurement quick actions" className="card pad section">
   <div className="muted tiny">QUICK PROCUREMENT FLOW</div>
   <div className="row wrap" style={{gap:8}}>
    <button type="button" className="btn small" onClick={()=>navigate('stock')}>1 · Check stock</button>
    <button type="button" className="btn small" onClick={()=>{changeStage('uncovered');setControlFilter('all')}}>2 · Request prices</button>
    <button type="button" className="btn small" onClick={()=>navigate('rfq')}>3 · Compare & order</button>
    <button type="button" className="btn small" onClick={()=>navigate('receiving')}>4 · Receive & complete</button>
   </div>
   <div className="muted tiny">Approvals, quotations and purchase-order controls remain in their existing screens.</div>
  </nav>
  {canReview&&<ProcurementPath active={4} counts={summary} t={t}/>}
  <div className="row wrap" style={{gap:8,alignItems:'center'}}>
   <label className="muted tiny" htmlFor="proc-attention-filter">Focus</label>
   <select id="proc-attention-filter" className="input" style={{maxWidth:190}} value={controlFilter} onChange={e=>{setPage(0);setControlFilter(e.target.value)}}>
    <option value="all">All requirements</option><option value="urgent">Urgent priority</option><option value="partial">Partially ordered</option>
   </select>
  </div>
  <div className="row wrap" style={{gap:8,alignItems:'center'}}><button type="button" className="btn small" aria-pressed={oldestFirst} onClick={()=>{setPage(0);setOldestFirst(v=>!v)}}>{oldestFirst?'✓ Oldest requirements first':'Sort: newest activity'}</button><span className="muted tiny">Waiting age is measured from the requirement creation date; outstanding quantities remain visible.</span></div> 
  {canAdd&&<details className="card pad procurement-manual-add">
   <summary className="procurement-manual-summary"><b>+ {t('requirements.manual_special','Manual / Special Purchase')}</b><span>{t('requirements.manual_special_hint','Use only when the item is not from a stock submission.')}</span></summary>
   <div className="section procurement-manual-body"><div className="sectionhead"><div><h3>{t('requirements.manual_special','Manual / Special Purchase')}</h3><p>{t('requirements.normal_shortages_hint','Optional. Normal shortages arrive automatically from submitted stock counts.')}</p></div><div className="toolbar"><button className={'btn '+(addMode==='standard'?'primary':'')} onClick={()=>{setAddMode('standard');setSpecialItem(null)}}>{t('requirements.standard','Standard')}</button>{specialEnabled&&<button className={'btn '+(addMode==='special'?'primary':'')} onClick={()=>setAddMode('special')}>{t('requirements.special','Special Purchase')}</button>}</div></div>
   <div className="field"><label>{t('requirements.find_item','Find item')}</label><input className="input" value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder={t('requirements.find_placeholder','Search item, code, brand or size')}/></div>

   {addMode==='standard'&&<div className="formgrid section"><div className="field"><label>{t('requirements.required_qty','Required quantity')}</label><input className="input" inputMode="decimal" value={manualQty} onChange={e=>setManualQty(e.target.value)}/></div><div className="field"><label>{t('requirements.note_optional','Note (optional)')}</label><input className="input" value={manualNote} onChange={e=>setManualNote(e.target.value)}/></div></div>}

   {itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button className="btn record-button" key={i.id} onClick={()=>addMode==='special'?chooseSpecial(i):addManual(i)}><div><strong>{itemTitle(i)}</strong><div className="muted tiny">{[i.item_code,i.uom,i.category].filter(Boolean).join(' · ')}</div>{addMode==='special'&&<div className="muted tiny">Stock {qty(i.book_stock??0)} · Reorder {qty(i.reorder_level)} · Max {qty(i.max_stock)}</div>}</div><span>{addMode==='special'?t('requirements.select','Select'):'+ '+t('requirements.add','Add')}</span></button>)}</div>}

   {addMode==='special'&&specialItem&&<div className="special-request-builder section">
    <div className="selected-item-box"><div><strong>{itemTitle(specialItem)}</strong><div className="muted tiny">{[specialItem.item_code,specialItem.uom,specialItem.category,specialItem.movement].filter(Boolean).join(' · ')}</div></div><button className="btn small" onClick={()=>setSpecialItem(null)}>{t('requirements.change','Change')}</button></div>
    <div className="special-stock-context section"><div><span>Current Stock</span><b>{qty(specialItem.book_stock??0)}</b></div><div><span>Reorder</span><b>{qty(specialItem.reorder_level)}</b></div><div><span>Max Stock</span><b>{qty(specialItem.max_stock)}</b></div><div><span>Movement</span><b>{specialItem.movement}</b></div></div>
    <div className="formgrid section">
     <div className="field"><label>{t('requirements.why_extra','Why are we buying extra?')}</label><select className="select" value={special.reason} onChange={e=>setSpecial(x=>({...x,reason:e.target.value}))}>{Object.entries(reasonLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
     {['customer_request','customer_paid'].includes(special.reason)&&<div className="field"><label>{t('requirements.customer_qty','Customer requested quantity')}</label><input className="input" inputMode="decimal" value={special.customer_qty} onChange={e=>setSpecial(x=>({...x,customer_qty:e.target.value}))}/></div>}
     <div className="field"><label>{t('requirements.purchase_qty','Purchase quantity')}</label><input className="input" inputMode="decimal" value={special.purchase_qty} onChange={e=>setSpecial(x=>({...x,purchase_qty:e.target.value}))}/></div>
     <div className="field"><label>{t('requirements.priority','Priority')}</label><select className="select" value={special.priority} onChange={e=>setSpecial(x=>({...x,priority:e.target.value}))}><option value="">Smart / automatic</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></div>
     <div className="field"><label>{t('requirements.reference','Customer / project reference')}</label><input className="input" value={special.customer_reference} onChange={e=>setSpecial(x=>({...x,customer_reference:e.target.value}))}/></div>
     <div className="field"><label>{t('requirements.note','Note')}</label><input className="input" value={special.notes} onChange={e=>setSpecial(x=>({...x,notes:e.target.value}))}/></div>
    </div>
    <div className="section"><b>{t('requirements.smart_suggestions','Smart quantity suggestions')}</b><div className="pillrow section">
     {['customer_request','customer_paid'].includes(special.reason)&&<><button className="choice-pill" onClick={()=>smartQty('minimum_customer')}>Minimum to fulfil customer</button><button className="choice-pill" onClick={()=>smartQty('customer_plus_max')}>Fulfil + restore Max Stock</button></>}
     <button className="choice-pill" onClick={()=>smartQty('top_up_max')}>Top up to Max</button>
     <button className="choice-pill" onClick={()=>smartQty('one_max_extra')}>Buy 1× Max extra</button>
     <button className="choice-pill" onClick={()=>smartQty('two_max_extra')}>Buy 2× Max extra</button>
    </div><div className="muted tiny">Special Purchase bypasses the normal reorder test, but still goes to Admin/Procurement Review before supplier pricing.</div></div>
    <button className="btn primary section" disabled={busy} onClick={addSpecial}>{busy?t('common.loading','Loading…'):t('requirements.create_special','Create Special Purchase Request')}</button>
   </div>}
   </div>
  </details>}

  <div className="card pad section">
   <div className="sectionhead"><div><h3>{canReview?t('requirements.review_title','Procurement Review'):t('requirements.my_items','My Procurement Items')}</h3><p>{canReview?t('requirements.review_hint','Latest submitted stock shortages appear here. Select rows, adjust order quantities only when needed, approve, then choose suppliers.'):t('requirements.my_hint','Items you add or count appear here for Admin review.')}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>
   {canReview&&<div className="toolbar section"><button className={'btn '+(stage==='pending_review'?'primary':'')} onClick={()=>changeStage('pending_review')}>{t('requirements.needs_review','Needs Review')}</button><button className={'btn '+(stage==='approved'?'primary':'')} onClick={()=>changeStage('approved')}>{t('requirements.approved','Approved')}</button><button className={'btn '+(stage==='held'?'primary':'')} onClick={()=>changeStage('held')}>{t('requirements.held','Held')}</button><button className={'btn '+(stage==='all'?'primary':'')} onClick={()=>changeStage('all')}>{t('requirements.all_active','All Active')}</button></div>}
   {canReview&&<div className="toolbar section procurement-bulk-actions"><button className="btn" onClick={()=>setSelected(new Set(rows.map(r=>r.id)))}>{t('requirements.select_all_visible','Select All Visible')}</button>{selected.size>0&&<><span className="muted tiny">{selected.size} {t('requirements.selected_count','selected')}</span>{stage==='pending_review'&&<button className="btn good" onClick={()=>review('approve')}>{t('requirements.approve_continue','Approve & Continue')}</button>}<button className="btn" onClick={()=>review('hold')}>{t('requirements.hold','Hold')}</button><button className="btn bad" onClick={()=>review('reject')}>{t('requirements.reject','Reject')}</button></>}</div>}
   {rows.length?<><div className="desktop-table tablewrap section"><table className="table"><thead><tr>{canReview&&<th/>}{cols.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id} className={selected.has(r.id)?'selected':''}>{canReview&&<td><input type="checkbox" checked={selected.has(r.id)} onChange={e=>setSelected(v=>{const n=new Set(v);e.target.checked?n.add(r.id):n.delete(r.id);return n})}/></td>}{cols.map(c=><td key={c.key}>{c.render?c.render(r):String(r[c.key]??'—')}</td>)}</tr>)}</tbody></table></div>
    <div className="proc-review-mobile-list">{rows.map(r=>{const current=r.current_stock??r.request_stock_snapshot??0,reorder=r.reorder_level??r.request_reorder_snapshot??0,max=r.max_stock??r.request_max_stock_snapshot??0;return <div className={'proc-review-row '+(selected.has(r.id)?'selected-card':'')} key={r.id}><label className="proc-review-check"><input type="checkbox" checked={selected.has(r.id)} onChange={e=>setSelected(v=>{const n=new Set(v);e.target.checked?n.add(r.id):n.delete(r.id);return n})}/></label><div className="proc-review-main"><strong>{itemTitle(r)}</strong><small>Stock {qty(current)} · Reorder {qty(reorder)} · Max {qty(max)}{r.uom?' · '+r.uom:''}</small><small>{r.source_count_no?'From '+r.source_count_no+' · ':''}{r.request_reason?String(r.request_reason).replaceAll('_',' '):(r.urgency_reason?String(r.urgency_reason).replaceAll('_',' '):'stock shortage')}</small></div><div className="proc-review-order"><span>ORDER</span>{canReview?<input className="input" inputMode="decimal" defaultValue={r.adjusted_qty} onBlur={e=>setQty(r.id,e.target.value)}/>:<b>{qty(r.adjusted_qty)}</b>}</div><div className="proc-review-status"><Badge>{r.approval_status}</Badge>{r.priority&&<small>{String(r.priority).toUpperCase()}</small>}</div></div>})}</div></>:<Empty>{t('requirements.no_stage','No items in this stage.')}</Empty>}
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{total?page*pageSize+1:0}–{Math.min((page+1)*pageSize,total)} {t('common.of','of')} {total}</span><button className="btn" disabled={(page+1)*pageSize>=total} onClick={()=>setPage(x=>x+1)}>{t('common.next','Next')}</button></div>
  </div>

  {canReview&&stage==='approved'&&selected.size>0&&<div className="card pad section rfq-builder"><div className="sectionhead"><div><h3>{t('requirements.step4_suppliers','Step 4 · Review & Choose Suppliers')}</h3><p>{t('requirements.choose_suppliers_hint','Select suppliers for the approved items. The app groups the RFQ automatically.')} · {selected.size}</p></div><button className="btn primary" disabled={busy} onClick={create}>{busy?t('common.loading','Loading…'):t('requirements.create_rfq_continue','Create RFQ & Continue')}</button></div>
   <div className="field"><label>{t('requirements.quote_due','Quotation due date')}</label><input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></div>
   {suggestedSuppliers.length>0&&<div className="section"><div className="toolbar"><b>{t('requirements.suggested_suppliers','Suggested suppliers')}</b><button className="btn small" onClick={()=>setChosen(new Set(suggestedSuppliers.map(x=>x.supplier_id)))}>{t('requirements.select_suggested','Select Suggested')}</button></div><div className="pillrow">{suggestedSuppliers.map(x=><button type="button" className={'choice-pill '+(chosen.has(x.supplier_id)?'selected-choice':'')} key={x.supplier_id} onClick={()=>setChosen(v=>{const n=new Set(v);n.has(x.supplier_id)?n.delete(x.supplier_id):n.add(x.supplier_id);return n})}><b>{x.supplier_name}</b><span>{x.matched_items}/{x.selected_items}{x.unrestricted?' · general':''}</span></button>)}</div></div>}
   <div className="pillrow section">{suppliers.map(s=><label className={'choice-pill '+(chosen.has(s.id)?'selected-choice':'')} key={s.id}><input type="checkbox" checked={chosen.has(s.id)} onChange={e=>setChosen(v=>{const n=new Set(v);e.target.checked?n.add(s.id):n.delete(s.id);return n})}/>{s.name}</label>)}</div>
   {[...chosen].filter(id=>!suggestedSuppliers.some(s=>s.supplier_id===id)).length>0&&<div className="notice section"><b>{t('requirements.coverage_override','Supplier coverage override')}</b><p className="muted tiny">{t('requirements.coverage_override_hint','These suppliers do not match the configured coverage for the selected items. State why they should still receive the price request.')}</p><div className="stack">{[...chosen].filter(id=>!suggestedSuppliers.some(s=>s.supplier_id===id)).map(id=><div className="field" key={id}><label>{suppliers.find(s=>s.id===id)?.name||id}</label><input className="input" value={scopeOverrides[id]||''} onChange={e=>setScopeOverrides(v=>({...v,[id]:e.target.value}))} placeholder={t('requirements.override_reason','Required override reason')}/></div>)}</div></div>}
  </div>}
 </>
}

export function Suppliers({profile,fields,features=[],flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const canAdd=can('suppliers.add')
 const canEdit=can('suppliers.edit')
 const smartEnabled=features.find(x=>x.feature_key==='suppliers.smart_suggestions')?.enabled!==false
 const[rows,setRows]=useState([]),[q,setQ]=useState(''),[form,setForm]=useState({supplier_code:'',name:'',contact_person:'',phone:'+94',whatsapp:'+94',email:'',address:'',payment_terms:''}),[coverageSupplier,setCoverageSupplier]=useState(null),[scopes,setScopes]=useState([]),[categories,setCategories]=useState([]),[mainGroups,setMainGroups]=useState([]),[subgroups,setSubgroups]=useState([]),[scopeType,setScopeType]=useState('category'),[scopeValue,setScopeValue]=useState(''),[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([])
 const[performance,setPerformance]=useState({})
 const load=useCallback(async()=>{
  const [r,p,d]=await Promise.all([supabase.from('proc_suppliers').select('*').order('name'),supabase.from('proc_v_supplier_performance_v2').select('*'),supabase.from('proc_v_supplier_delivery_evidence_v1').select('*')])
  if(r.error)fail(r.error);else setRows(r.data||[])
  if(p.error)fail(p.error)
  else {
   const delivery=new Map((d.data||[]).map(x=>[x.supplier_id,x]))
   setPerformance(Object.fromEntries((p.data||[]).map(x=>[x.supplier_id,{...x,...(d.error?{}:(delivery.get(x.supplier_id)||{}))}])))
  }
  if(d.error)fail(d.error)
 },[fail])
 useEffect(()=>{load()},[load])
 useEffect(()=>{(async()=>{const r=await supabase.rpc('proc_item_filter_options_v1');if(!r.error){setCategories(r.data?.categories||[]);setMainGroups(r.data?.main_groups||[]);setSubgroups(r.data?.subgroups||[])}})()},[])
 useEffect(()=>{
  if(!coverageSupplier||scopeType!=='item'||itemSearch.trim().length<2){setItemResults([]);return}
  const t=setTimeout(async()=>{
   const term=itemSearch.trim()
   const r=await supabase.from('proc_items').select('id,item_code,description,size,category').eq('active',true).or('description.ilike.%'+term+'%,item_code.ilike.%'+term+'%,size.ilike.%'+term+'%').order('description').limit(20)
   if(r.error)return fail(r.error)
   setItemResults(r.data||[])
  },180)
  return()=>clearTimeout(t)
 },[coverageSupplier,scopeType,itemSearch,fail])
 async function openCoverage(supplier){
  setCoverageSupplier(supplier);setItemSearch('');setItemResults([])
  const r=await supabase.from('proc_supplier_scopes').select('*,item:proc_items(item_code,description,size,category)').eq('supplier_id',supplier.id).order('created_at')
  if(r.error)return fail(r.error)
  setScopes(r.data||[])
 }
 async function addScope(item=null){
  if(!coverageSupplier||!canEdit)return
  const payload=item
   ?{supplier_id:coverageSupplier.id,scope_type:'item',item_id:item.id,scope_value:null}
   :{supplier_id:coverageSupplier.id,scope_type:scopeType,item_id:null,scope_value:scopeValue.trim()}
  if(!item&&!payload.scope_value)return fail(new Error(t('suppliers.coverage_value','Choose or enter a supplier coverage value.')))
  const r=await supabase.from('proc_supplier_scopes').insert(payload)
  if(r.error)return fail(r.error)
  flash(t('suppliers.coverage_updated','Supplier coverage updated.'));setScopeValue('');setItemSearch('');openCoverage(coverageSupplier)
 }
 async function removeScope(id){
  if(!canEdit)return
  const r=await supabase.from('proc_supplier_scopes').delete().eq('id',id)
  if(r.error)return fail(r.error)
  flash('Supplier coverage rule removed.');openCoverage(coverageSupplier)
 }

 async function add(){
  if(!canAdd)return fail(new Error(t('suppliers.add_denied','You do not have permission to add suppliers.')))
  if(!form.name.trim())return fail(new Error(t('suppliers.name_required','Supplier name is required.')))
  const phone=toSriLankaSupplierPhone(form.phone)
  const whatsapp=toSriLankaSupplierPhone(form.whatsapp)
  if(form.phone.trim()&&form.phone.trim()!=='+94'&&!phone)return fail(new Error('Supplier phone must be a valid Sri Lankan number starting with +94 (e.g. +94771234567).'))
  if(form.whatsapp.trim()&&form.whatsapp.trim()!=='+94'&&!whatsapp)return fail(new Error('Supplier WhatsApp must be a valid Sri Lankan number starting with +94 (e.g. +94771234567).'))
  const code=form.supplier_code.trim()||'S'+String(Math.max(rows.length+101,101)).padStart(3,'0')
  const r=await supabase.from('proc_suppliers').insert({...form,name:form.name.trim(),supplier_code:code,phone:phone||null,whatsapp:whatsapp||phone||null})
  if(r.error)return fail(r.error)
  flash(form.name+' added.');setForm({supplier_code:'',name:'',contact_person:'',phone:'+94',whatsapp:'+94',email:'',address:'',payment_terms:''});load()
 }
 async function toggle(s){if(!canEdit)return;const r=await supabase.from('proc_suppliers').update({active:!s.active}).eq('id',s.id);if(r.error)fail(r.error);else{flash(s.name+(s.active?' deactivated.':' activated.'));load()}}
 const duplicateHints=useMemo(()=>{
  if(!smartEnabled)return[]
  const name=form.name.trim().toLowerCase(),phone=toSriLankaSupplierPhone(form.phone),email=form.email.trim().toLowerCase()
  return rows.filter(r=>
   (name&&r.name?.trim().toLowerCase()===name)||
   (phone&&toSriLankaSupplierPhone(r.phone)===phone)||
   (email&&String(r.email||'').trim().toLowerCase()===email)
  ).slice(0,5)
 },[rows,form.name,form.phone,form.email,smartEnabled])
 const paymentSuggestions=useMemo(()=>[...new Set(rows.map(r=>r.payment_terms).filter(Boolean))].sort(),[rows])

 const filtered=useMemo(()=>rows.filter(r=>(r.name+' '+r.supplier_code+' '+(r.phone||'')+' '+(r.contact_person||'')).toLowerCase().includes(q.toLowerCase())),[rows,q])
 const defaults=[
  {key:'supplier_code',label:'Code',render:s=><span className="mono">{s.supplier_code}</span>},
  {key:'name',label:'Supplier',render:s=><><strong>{s.name}</strong>{s.email&&<div className="muted tiny">{s.email}</div>}</>},
  {key:'performance',label:'Performance',render:s=>{const p=performance[s.id];if(!p||p.evidence_status==='insufficient_data')return <span className="muted tiny">Insufficient data{p?.po_count?' · '+p.po_count+' POs':''}</span>;return <span title="Fulfilment is accepted quantity divided by ordered quantity; on-time delivery uses posted receipt dates when at least three dated receipts exist."><strong>{p.fulfilment_pct??'—'}%</strong><div className="muted tiny">Fulfilment · {p.po_count} POs</div><div className="muted tiny">On-time: {p.on_time_pct==null?'Insufficient dated receipts':p.on_time_pct+'%'}</div></span>}},
  {key:'contact_person',label:'Contact Person'},
  {key:'phone',label:'Phone',render:s=>toSriLankaSupplierPhone(s.phone)||s.phone||'—'},
  {key:'whatsapp',label:'WhatsApp',render:s=>{const url=whatsappUrl(s.whatsapp);return url?<a className="good-text" target="_blank" rel="noreferrer" href={url}>Open</a>:'—'}},
  {key:'email',label:'Email'},
  {key:'address',label:'Address'},
  {key:'payment_terms',label:'Payment Terms'},
  {key:'status',label:'Status',render:s=><Badge>{s.active?'active':'inactive'}</Badge>}
 ]
 const cols=configuredColumns(fields,'suppliers',defaults)
 const scopeLabel=sc=>sc.scope_type==='item'?[sc.item?.description,sc.item?.size].filter(Boolean).join(' · '):`${sc.scope_type.replace('_',' ')}: ${sc.scope_value}`
 return <div className="split">
  <div className="card pad"><div className="sectionhead"><div><h3>{t('suppliers.directory','Supplier Directory')}</h3><p>{t('suppliers.directory_hint','Supplier details, contacts and payment terms.')}</p></div></div><input className="input" placeholder={t('suppliers.search','Search suppliers')} value={q} onChange={e=>setQ(e.target.value)}/><div className="section"><DataTable columns={canEdit?[...cols,{key:'actions',label:'',render:s=><div className="toolbar">{fieldEnabled(fields,'suppliers','coverage')&&<button className="btn small" onClick={()=>openCoverage(s)}>{fieldLabel(fields,'suppliers','coverage',t('suppliers.coverage','Coverage'))}</button>}<button className="btn small" onClick={()=>toggle(s)}>{s.active?t('suppliers.deactivate','Deactivate'):t('suppliers.activate','Activate')}</button></div>}]:cols} rows={filtered} mobileCards/></div></div>
  <div className="stack">
   {canAdd&&<div className="card pad"><div className="sectionhead"><div><h3>{t('suppliers.add_title','Add Supplier')}</h3><p>{t('suppliers.add_hint','Supplier code is optional and can be generated automatically.')}</p></div></div><div className="formgrid">
    {[
     ['supplier_code','Supplier code'],['name','Supplier name'],['contact_person','Contact person'],['phone','Phone'],
     ['whatsapp','WhatsApp'],['email','Email'],['address','Address'],['payment_terms','Payment terms']
    ].filter(([k])=>!fields?.some(f=>f.module_key==='suppliers'&&f.field_key===k&&!f.enabled)).map(([k,l])=><div className="field" key={k}><label>{fields?.find(f=>f.module_key==='suppliers'&&f.field_key===k)?.label||l}</label><input className="input" inputMode={k==='phone'||k==='whatsapp'?'tel':undefined} list={k==='payment_terms'?'supplier-payment-terms':undefined} value={form[k]} placeholder={k==='phone'||k==='whatsapp'?'+94 77 123 4567':undefined} onChange={e=>{const value=e.target.value;setForm(x=>{if(k==='phone'||k==='whatsapp'){const next=formatSriLankaSupplierPhoneInput(value);if(k==='phone'&&smartEnabled&&(!x.whatsapp||x.whatsapp==='+94'||x.whatsapp===x.phone))return {...x,phone:next,whatsapp:next};return {...x,[k]:next}}return {...x,[k]:value}})}}/></div>)}
   </div>
   <datalist id="supplier-payment-terms">{paymentSuggestions.map(x=><option value={x} key={x}/>)}</datalist>
   {smartEnabled&&duplicateHints.length>0&&<div className="notice section"><b>Possible existing supplier</b><div className="muted tiny">{duplicateHints.map(x=>x.name+' · '+(x.phone||x.email||x.supplier_code)).join(' | ')}</div></div>}
   {smartEnabled&&paymentSuggestions.length>0&&<div className="section"><div className="muted tiny">Smart payment-term suggestions</div><div className="pillrow section">{paymentSuggestions.slice(0,6).map(x=><button type="button" className="choice-pill" key={x} onClick={()=>setForm(v=>({...v,payment_terms:x}))}>{x}</button>)}</div></div>}
   <button className="btn primary section" onClick={add}>{t('suppliers.save','Save Supplier')}</button></div>}
   {coverageSupplier&&<div className="card pad supplier-coverage"><div className="sectionhead"><div><h3>{coverageSupplier.name} Coverage</h3><p>Rules limit which requirements this supplier is suggested for. No rules means a general supplier.</p></div><button className="btn small" onClick={()=>setCoverageSupplier(null)}>{t('common.close','Close')}</button></div>
    <div className="pillrow">{scopes.length?scopes.map(sc=><span className="choice-pill selected-choice" key={sc.id}>{scopeLabel(sc)}{canEdit&&<button className="chip-x" onClick={()=>removeScope(sc.id)}>×</button>}</span>):<span className="badge info">General supplier · all items</span>}</div>
    {canEdit&&<div className="section">
     <div className="formgrid">
      <div className="field"><label>{t('suppliers.coverage_type','Coverage type')}</label><select className="select" value={scopeType} onChange={e=>{setScopeType(e.target.value);setScopeValue('');setItemSearch('')}}><option value="category">Category</option><option value="main_group">Main Group</option><option value="subgroup">Subgroup</option><option value="item">Specific Item</option></select></div>
      {scopeType==='category'&&<div className="field"><label>Category</label><select className="select" value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="">Select category…</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>}
      {scopeType==='main_group'&&<div className="field"><label>Main Group</label><select className="select" value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="">Select main group…</option>{mainGroups.map(x=><option key={x}>{x}</option>)}</select></div>}
      {scopeType==='subgroup'&&<div className="field"><label>Subgroup</label><select className="select" value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="">Select subgroup…</option>{subgroups.map(x=><option key={x}>{x}</option>)}</select></div>}
      {scopeType==='item'&&<div className="field"><label>Search item</label><input className="input" value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder="Type item, code or size"/></div>}
     </div>
     {scopeType!=='item'&&<button className="btn primary section" onClick={()=>addScope()}>{t('suppliers.add_coverage','Add Coverage Rule')}</button>}
     {scopeType==='item'&&itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button className="btn record-button" key={i.id} onClick={()=>addScope(i)}><div><strong>{itemTitle(i)}</strong><div className="muted tiny">{[i.item_code,i.category].filter(Boolean).join(' · ')}</div></div><span>+ Add</span></button>)}</div>}
    </div>}
   </div>}
  </div>
 </div>
}

export function Rfqs({profile,fields,features=[],company,footer,flash,fail,can=()=>false,navigate=()=>{},language='en',t=(k,f)=>f||k}){
 const canEdit=can('procurement.rfq.manage')
 const quoteCfg=features.find(x=>x.feature_key==='quotes.minimum_quotes')?.config||{}
 const minQuotes=Math.max(1,Number(quoteCfg.minimum_quotes||2))
 const commercialEnabled=features.find(x=>x.feature_key==='quotes.commercial_terms')?.enabled!==false
 const awardReviewEnabled=features.find(x=>x.feature_key==='quotes.award_review')?.enabled!==false

 const[rfqs,setRfqs]=useState([]),[rfqTotal,setRfqTotal]=useState(0),[page,setPage]=useState(0),[summaries,setSummaries]=useState({}),[suppliers,setSuppliers]=useState([])
 const[active,setActive]=useState(null),[items,setItems]=useState([]),[invite,setInvite]=useState([]),[comparison,setComparison]=useState([])
 const[supplier,setSupplier]=useState(''),[quoteRef,setQuoteRef]=useState(''),[validUntil,setValidUntil]=useState(''),[prices,setPrices]=useState({}),[file,setFile]=useState(null),[quoteOcrBusy,setQuoteOcrBusy]=useState(false)
 const[freight,setFreight]=useState('0'),[minOrder,setMinOrder]=useState('0'),[busy,setBusy]=useState(false)
 const[awardOpen,setAwardOpen]=useState(false),[awardPlan,setAwardPlan]=useState([]),[quoteException,setQuoteException]=useState(''),[sendMenuId,setSendMenuId]=useState('')
 const[browserRfqReady,setBrowserRfqReady]=useState(null),[browserRfqPreparing,setBrowserRfqPreparing]=useState('')
 const[gateway,setGateway]=useState({configured:false,connected:false,sendingEnabled:false,dispatches:[]}),[gatewayBusy,setGatewayBusy]=useState('')
 const[pairState,setPairState]=useState({status:'NOT_CONFIGURED',qr:null,code:null}),[pairPhone,setPairPhone]=useState('+94'),[pairBusy,setPairBusy]=useState(false)
 const pageSize=100
 const pricedItemIds=new Set(comparison.map(x=>x.rfq_item_id))
 const pricedCount=items.filter(i=>pricedItemIds.has(i.id)).length
 const unpricedCount=items.length-pricedCount
 const selectedUnpriced=items.filter(i=>i.selected_for_po!==false&&!pricedItemIds.has(i.id))
 const awardSuppliers=[...new Set(awardPlan.map(x=>x.supplier_id))]
 const awardEstimate=awardPlan.reduce((sum,x)=>sum+(Number(x.qty)||0)*(Number(x.landed_unit_cost)||0),0)
 const awardProblems=awardPlan.filter(x=>!Number.isFinite(Number(x.qty))||Number(x.qty)<=0||(!x.recommended&&!String(x.override_reason||'').trim()))
 const awardUnselected=items.filter(i=>i.selected_for_po===false)
 const journeyStage=awardOpen?7:(active&&invite.length&&!invite.some(x=>['pending','prepared'].includes(x.status))?6:5)

 const load=useCallback(async()=>{try{
  const[a,b]=await Promise.all([
   supabase.from('proc_rfqs').select('*',{count:'exact'}).order('created_at',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1),
   supabase.from('proc_suppliers').select('id,supplier_code,name,whatsapp,phone').eq('active',true).order('name')
  ])
  if(a.error)throw a.error;if(b.error)throw b.error
  setRfqs(a.data||[]);setRfqTotal(a.count||0);setSuppliers(b.data||[])
  const ids=(a.data||[]).map(x=>x.id)
  if(!ids.length){setSummaries({});return}
  const rs=await supabase.from('proc_rfq_suppliers').select('rfq_id,status,supplier_id,replied_at,sent_at').in('rfq_id',ids)
  if(rs.error)throw rs.error
  const map={}
  for(const x of rs.data||[]){
   const m=map[x.rfq_id]||(map[x.rfq_id]={total:0,quoted:0,waiting:0,declined:0})
   m.total++
   if(x.status==='quoted')m.quoted++
   else if(x.status==='declined')m.declined++
   else m.waiting++
  }
  setSummaries(map)
 }catch(e){fail(e)}},[fail,page])
 useEffect(()=>{load()},[load])

 async function open(r){
  setActive(r);setPrices({});setFile(null);setQuoteRef('');setValidUntil('');setFreight('0');setMinOrder('0');setAwardOpen(false);setAwardPlan([]);setQuoteException(r.quote_exception_reason||'');setSendMenuId('');setBrowserRfqReady(null);setGateway({configured:false,connected:false,sendingEnabled:false,dispatches:[]});void refreshGatewayStatus(r.id);if(profile?.role==='admin')void loadPairStatus()
  const[a,b,c]=await Promise.all([
   supabase.from('proc_rfq_items').select('*,requirement:proc_requirements(*,item:proc_items(*))').eq('rfq_id',r.id).order('id'),
   supabase.from('proc_rfq_suppliers').select('*').eq('rfq_id',r.id),
   supabase.from('proc_v_quote_comparison').select('*').eq('rfq_id',r.id).order('rfq_item_id').order('landed_unit_cost')
  ])
  if(a.error)return fail(a.error);if(b.error)return fail(b.error);if(c.error)return fail(c.error)
  setItems(a.data||[]);setInvite(b.data||[]);setComparison(c.data||[])
  const first=b.data?.[0]?.supplier_id||'';setSupplier(first)
  if(first)await loadExistingQuote(r.id,first,a.data||[])
 }

 async function loadExistingQuote(rfqId,supplierId){
  setSupplier(supplierId);setPrices({});setQuoteRef('');setValidUntil('');setFreight('0');setMinOrder('0')
  if(!supplierId)return
  const q=await supabase.from('proc_quotes').select('id,quote_ref,valid_until,attachment_path,freight_total,minimum_order_value').eq('rfq_id',rfqId).eq('supplier_id',supplierId).maybeSingle()
  if(q.error)return fail(q.error)
  if(!q.data)return
  setQuoteRef(q.data.quote_ref||'');setValidUntil(q.data.valid_until||'');setFreight(String(q.data.freight_total??0));setMinOrder(String(q.data.minimum_order_value??0))
  const l=await supabase.from('proc_quote_lines').select('*').eq('quote_id',q.data.id)
  if(l.error)return fail(l.error)
  const map={};(l.data||[]).forEach(x=>{
   const details=decodeSupplierQuoteNotes(x.notes)
   map[x.rfq_item_id]={price:String(x.unit_price),remarks:details.remarks,variants:details.variants}
  })
  setPrices(map)
 }

 function quoteTokens(v){
  return [...new Set(String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').split(/\s+/).filter(x=>x.length>1))]
 }
 function quoteMatch(item,row){
  const master=item.requirement?.item||{}
  const code=String(master.item_code||'').trim().toLowerCase()
  const rowCode=String(row.external_code||'').trim().toLowerCase()
  const itemSize=String(master.size||'').trim().toLowerCase().replace(/\s+/g,'')
  const rowSize=String(row.size||'').trim().toLowerCase().replace(/\s+/g,'')
  const target=quoteTokens([master.description,master.brand].filter(Boolean).join(' '))
  const source=new Set(quoteTokens(row.description))
  const common=target.filter(x=>source.has(x)).length
  const ratio=common/Math.max(target.length,1)
  const codeExact=!!(code&&rowCode&&code===rowCode)
  const sizeConflict=!!(itemSize&&rowSize&&itemSize!==rowSize)
  const sizeExact=!!(itemSize&&rowSize&&itemSize===rowSize)
  const descriptionStrong=common>=2&&ratio>=0.6&&!sizeConflict
  const descriptionWithSize=sizeExact&&common>=1&&ratio>=0.5&&!sizeConflict
  return {score:(codeExact?2:0)+ratio+(sizeExact?0.2:0),acceptable:codeExact||descriptionStrong||descriptionWithSize}
 }
 async function readQuoteAutomatically(){
  if(!file)return fail(new Error('Choose the supplier quotation PDF or image first.'))
  setQuoteOcrBusy(true)
  try{
   const extracted=await extractPriceListFile(file,'cost')
   const next={...prices}
   const rows=extracted.rows||[]
   const usedRows=new Set()
   let matched=0
   for(const item of items){
    let best=null,bestScore=-1,bestIndex=-1
    rows.forEach((row,index)=>{
     if(usedRows.has(index))return
     const price=row.cost??row.mrp
     if(price===null||price===undefined||!Number.isFinite(Number(price)))return
     const match=quoteMatch(item,row)
     if(match.acceptable&&match.score>bestScore){bestScore=match.score;best=row;bestIndex=index}
    })
    if(best&&bestIndex>=0){
     usedRows.add(bestIndex)
     const current=next[item.id]||{}
     next[item.id]={...current,price:String(Number(best.cost??best.mrp))}
     matched++
    }
   }
   setPrices(next)
   if(!matched)return fail(new Error('The quotation was read, but no RFQ items could be matched confidently. Enter the prices manually or use a clearer document.'))
   flash(matched+' quotation line(s) matched automatically. Review the filled prices before saving.')
  }catch(e){fail(e)}finally{setQuoteOcrBusy(false)}
 }

 function editPrice(itemId,change){
  setPrices(current=>({...current,[itemId]:{...(current[itemId]||{}),...change}}))
 }
 function addSizeAlternative(itemId){
  setPrices(current=>{
   const row=current[itemId]||{},variants=row.variants||[]
   if(variants.length>=12){flash('Maximum 12 size alternatives per item.');return current}
   return {...current,[itemId]:{...row,variants:[...variants,{id:'alt-'+Date.now()+'-'+Math.random().toString(36).slice(2),size:'',price:'',remarks:''}]}}
  })
 }
 function editSizeAlternative(itemId,id,change){
  setPrices(current=>{
   const row=current[itemId]||{}
   return {...current,[itemId]:{...row,variants:(row.variants||[]).map(v=>v.id===id?{...v,...change}:v)}}
  })
 }
 function removeSizeAlternative(itemId,id){
  setPrices(current=>{
   const row=current[itemId]||{}
   return {...current,[itemId]:{...row,variants:(row.variants||[]).filter(v=>v.id!==id)}}
  })
 }
 function sizeAlternativesEditor(itemId,value){
  return <div className="stack">
   {(value.variants||[]).map(v=><div className="formgrid" key={v.id}>
    <div className="field"><label>Alternative size</label><input className="input" disabled={!canEdit} maxLength={100} placeholder="e.g. 1½ inch" value={v.size||''} onChange={e=>editSizeAlternative(itemId,v.id,{size:e.target.value})}/></div>
    <div className="field"><label>Price (Rs.)</label><input className="input stock-entry" disabled={!canEdit} inputMode="decimal" placeholder="Price" value={v.price??''} onChange={e=>editSizeAlternative(itemId,v.id,{price:e.target.value})}/></div>
    <div className="field"><label>Remarks (optional)</label><input className="input" disabled={!canEdit} maxLength={300} placeholder="Optional" value={v.remarks||''} onChange={e=>editSizeAlternative(itemId,v.id,{remarks:e.target.value})}/></div>
    {canEdit&&<button type="button" className="btn small bad" onClick={()=>removeSizeAlternative(itemId,v.id)}>Remove size</button>}
   </div>)}
   {canEdit&&<button type="button" className="btn small" onClick={()=>addSizeAlternative(itemId)}>+ Add size variation</button>}
  </div>
 }

 async function saveQuote(){
  if(!canEdit)return fail(new Error(t('validation.rfq_read_only','Your role has read-only supplier-price access.')))
  if(!active||!supplier)return fail(new Error(t('validation.select_supplier','Select a supplier.')))
  const quoted=items.filter(i=>prices[i.id]?.price!==undefined&&String(prices[i.id].price).trim()!=='')
  if(!quoted.length)return fail(new Error('Enter at least one quoted unit price for the requested item size.'))
  const variantsWithoutMain=items.some(i=>{
   const v=prices[i.id]||{}
   return (v.price===undefined||String(v.price).trim()==='')&&(v.variants||[]).some(x=>String(x.size||x.price||'').trim())
  })
  if(variantsWithoutMain)return fail(new Error('Enter the requested-size price before adding alternative sizes, or remove that item’s alternatives.'))
  const invalid=quoted.some(i=>{
   const v=prices[i.id]||{},p=Number(v.price)
   return !Number.isFinite(p)||p<0||!validateSupplierQuoteVariants(v.variants||[])||String(v.remarks||'').length>500
  })
  if(invalid)return fail(new Error('Check unit prices and alternatives: each added size must have a valid price.'))
  setBusy(true);let path=null
  try{
   if(file){
    path='quotes/'+active.id+'/'+Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const u=await supabase.storage.from('gh-procurement').upload(path,file);if(u.error)throw u.error
   }
   const lines=quoted.map(i=>({
    rfq_item_id:i.id,unit_price:Number(prices[i.id].price),
    available_qty:null,lead_days:null,
    discount_percent:0,tax_percent:0,moq:0,order_multiple:1,
    notes:encodeSupplierQuoteNotes(prices[i.id])
   }))
   const r=await supabase.rpc('proc_save_quote_v3',{
    p_rfq_id:active.id,p_supplier_id:supplier,p_quote_ref:null,p_lines:lines,
    p_valid_until:null,p_attachment_path:path,p_notes:null,
    p_freight_total:0,p_minimum_order_value:0
   })
   if(r.error)throw r.error
   setFile(null)
   flash(quoted.length+' supplier item price(s) saved. Next: Review quoted items, or select another supplier to enter more prices. No purchase order has been created.')
   await open({...active,status:r.data.status});load()
  }catch(e){if(path)await supabase.storage.from('gh-procurement').remove([path]);fail(e)}finally{setBusy(false)}
 }

 async function togglePoItem(i,on){
  if(!canEdit)return
  const r=await supabase.from('proc_rfq_items').update({selected_for_po:on}).eq('id',i.id)
  if(r.error)return fail(r.error)
  setItems(v=>v.map(x=>x.id===i.id?{...x,selected_for_po:on}:x))
 }

 async function selectOnlyPricedItems(){
  if(!canEdit||!active||!pricedCount)return
  if(!window.confirm('Select the '+pricedCount+' priced item(s) for the current order review and untick the '+unpricedCount+' unpriced item(s)? This changes the current RFQ order selection; it does not delete their stock requirements or quotations.'))return
  setBusy(true)
  try{
   const ids=items.filter(i=>!pricedItemIds.has(i.id)&&i.selected_for_po!==false).map(i=>i.id)
   const enable=items.filter(i=>pricedItemIds.has(i.id)&&i.selected_for_po===false).map(i=>i.id)
   if(ids.length){const x=await supabase.from('proc_rfq_items').update({selected_for_po:false}).in('id',ids).eq('rfq_id',active.id);if(x.error)throw x.error}
   if(enable.length){const x=await supabase.from('proc_rfq_items').update({selected_for_po:true}).in('id',enable).eq('rfq_id',active.id);if(x.error)throw x.error}
   setItems(v=>v.map(i=>({...i,selected_for_po:pricedItemIds.has(i.id)})))
   flash('Only items with received supplier prices are selected. Review the selections before creating orders.')
  }catch(e){fail(e);await open(active)}finally{setBusy(false)}
 }

 function roundForMultiple(n,multiple){
  const m=Math.max(Number(multiple||1),0.001)
  return Math.ceil((Number(n||0)-1e-9)/m)*m
 }
 function buildAwardReview(){
  if(!canEdit||!active)return
  const selected=items.filter(i=>i.selected_for_po!==false)
  if(!selected.length)return fail(new Error(t('validation.order_item','Select at least one item for the supplier order.')))
  if(!comparison.length)return fail(new Error(t('validation.enter_prices','Enter supplier prices before reviewing awards.')))
  const missing=selected.filter(i=>!comparison.some(c=>c.rfq_item_id===i.id))
  if(missing.length)return fail(new Error(missing.length+' selected item(s) have no supplier price. Untick Order for those items before reviewing the quoted items. Unquoted items are not assigned a supplier or a price.'))
  const plan=[]
  for(const item of selected){
   const target=Math.min(Number(item.requested_qty||0),Math.max(Number(item.requirement?.adjusted_qty||0)-Number(item.requirement?.ordered_qty||0),0))
   let remaining=target
   const candidates=candidatesFor(item.id)
   for(const cand of candidates){
    if(remaining<=0)break
    const available=cand.available_qty===null||cand.available_qty===undefined?Infinity:Number(cand.available_qty)
    let allocation=Math.max(remaining,Number(cand.moq||0))
    allocation=roundForMultiple(allocation,Number(cand.order_multiple||1))
    if(Number.isFinite(available)&&allocation>available){
     const possible=Math.floor((available+1e-9)/Math.max(Number(cand.order_multiple||1),0.001))*Math.max(Number(cand.order_multiple||1),0.001)
     if(possible<Math.max(Number(cand.moq||0),0.001))continue
     allocation=Math.min(possible,remaining)
     allocation=roundForMultiple(allocation,Number(cand.order_multiple||1))
     if(allocation>available)continue
    }
    if(allocation<=0)continue
    plan.push({
     id:(globalThis.crypto?.randomUUID?.()||Math.random().toString(36)),
     rfq_item_id:item.id,quote_line_id:cand.quote_line_id,qty:String(allocation),
     supplier_id:cand.supplier_id,supplier_name:cand.supplier_name,
     landed_unit_cost:cand.landed_unit_cost,unit_price:cand.unit_price,lead_days:cand.lead_days,available_qty:cand.available_qty,
     recommended:true,
     override_reason:automaticAwardReason(item.id,cand,allocation,remaining)
    })
    remaining-=allocation
   }
   if(remaining>0)return fail(new Error(t('validation.quote_coverage_prefix','Quoted supplier availability/commercial terms do not fully cover')+' '+itemTitle(item.requirement?.item||{})+'. '+t('validation.quote_coverage_suffix','Add another quote or adjust supplier availability.')))
  }
  setAwardPlan(plan);setAwardOpen(true)
 }

 function itemNeedsSpeed(itemId){
  const req=items.find(i=>i.id===itemId)?.requirement||{}
  const priority=String(req.priority||'').toLowerCase()
  return priority==='urgent'||priority==='high'||!!req.urgency_reason||!!req.customer_paid
 }
 function candidatesFor(itemId){
  const urgent=itemNeedsSpeed(itemId)
  return comparison.filter(x=>x.rfq_item_id===itemId).sort((a,b)=>{
   if(urgent){
    const al=a.lead_days===null||a.lead_days===undefined?Number.POSITIVE_INFINITY:Number(a.lead_days)
    const bl=b.lead_days===null||b.lead_days===undefined?Number.POSITIVE_INFINITY:Number(b.lead_days)
    if(al!==bl)return al-bl
   }
   const cost=Number(a.landed_unit_cost)-Number(b.landed_unit_cost)
   if(cost!==0)return cost
   return Number(a.lead_days??999999)-Number(b.lead_days??999999)
  })
 }
 function recommendedQuoteLine(itemId){return candidatesFor(itemId)[0]?.quote_line_id||null}
 function automaticAwardReason(itemId,cand,allocation=null,remaining=null){
  const reasons=[]
  if(Number(cand?.landed_rank)!==1){
   if(itemNeedsSpeed(itemId)&&cand?.quote_line_id===recommendedQuoteLine(itemId))reasons.push('System recommendation: faster delivery for urgent/high-priority requirement.')
   else reasons.push('System allocation: lower-cost suppliers could not fully cover the remaining quantity or commercial constraints.')
  }
  if(allocation!==null&&remaining!==null&&Number(allocation)>Number(remaining))reasons.push('Supplier MOQ/order multiple requires ordering above the requirement.')
  return reasons.join(' ')
 }
 function updateAward(id,patch){setAwardPlan(v=>v.map(x=>x.id===id?{...x,...patch}:x))}
 function changeAwardSupplier(row,quoteLineId){
  const cand=candidatesFor(row.rfq_item_id).find(x=>x.quote_line_id===quoteLineId)
  if(!cand)return
  const recommended=cand.quote_line_id===recommendedQuoteLine(row.rfq_item_id)
  updateAward(row.id,{
   quote_line_id:cand.quote_line_id,supplier_id:cand.supplier_id,supplier_name:cand.supplier_name,
   landed_unit_cost:cand.landed_unit_cost,unit_price:cand.unit_price,lead_days:cand.lead_days,available_qty:cand.available_qty,recommended,
   override_reason:recommended?automaticAwardReason(row.rfq_item_id,cand):row.override_reason
  })
 }
 function addAwardSplit(itemId){
  const cand=candidatesFor(itemId)[0]
  if(!cand)return
  setAwardPlan(v=>[...v,{id:(globalThis.crypto?.randomUUID?.()||Math.random().toString(36)),rfq_item_id:itemId,quote_line_id:cand.quote_line_id,qty:'',supplier_id:cand.supplier_id,supplier_name:cand.supplier_name,landed_unit_cost:cand.landed_unit_cost,unit_price:cand.unit_price,lead_days:cand.lead_days,available_qty:cand.available_qty,recommended:true,override_reason:automaticAwardReason(itemId,cand)}])
 }

 async function createFollowUpRfq(){
  if(!active||!canEdit)return
  const pending=items.filter(i=>Number(i.requirement?.adjusted_qty||0)>Number(i.requirement?.ordered_qty||0))
  const supplierIds=[...new Set(invite.map(x=>x.supplier_id).filter(Boolean))]
  if(!pending.length)return fail(new Error('No outstanding requirements remain in this RFQ.'))
  if(!supplierIds.length)return fail(new Error('Add a supplier before preparing a follow-up RFQ.'))
  if(!window.confirm('Prepare a NEW follow-up RFQ for '+pending.length+' outstanding item(s), using '+supplierIds.length+' existing supplier(s)? This does not resend WhatsApp messages or create purchase orders.'))return
  setBusy(true)
  try{
   const ids=[...new Set(pending.map(i=>i.requirement_id))]
   const result=await supabase.rpc('proc_create_rfq_v4',{p_requirement_ids:ids,p_supplier_ids:supplierIds,p_due_date:null,p_notes:'Follow-up to '+active.rfq_no+' for remaining requirements',p_scope_overrides:{}})
   if(result.error)throw result.error
   flash('Follow-up RFQ '+result.data.rfq_no+' prepared. Check supplier coverage and quantities before sending.')
   await load()
   setActive(null);setAwardOpen(false)
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 async function finalizeAward(){
  if(!active||!awardPlan.length)return
  const invalid=awardPlan.some(x=>!Number.isFinite(Number(x.qty))||Number(x.qty)<=0||(!x.recommended&&!String(x.override_reason||'').trim()))
  if(invalid)return fail(new Error(t('validation.award_allocation','Every award allocation needs a positive quantity; non-recommended suppliers require an override reason.')))
  if(!awardPlan.length||awardProblems.length)return fail(new Error('Resolve invalid quantities and missing supplier-change reasons before creating orders.'))
  const supplierLines=awardSuppliers.map(id=>{const rows=awardPlan.filter(x=>x.supplier_id===id);return (rows[0]?.supplier_name||'Supplier')+': '+rows.length+' allocation(s)'}).join('\\n')
  const remaining=awardUnselected.length
  if(!window.confirm('FINAL PURCHASE ORDER CONFIRMATION\\n\\n'+awardPlan.length+' allocation(s) for '+awardSuppliers.length+' supplier(s).\\n'+supplierLines+'\\nEstimated landed goods value: '+money(awardEstimate)+'\\n\\n'+(remaining?remaining+' unselected item(s) will NOT be ordered. The current RFQ will be marked awarded; create a new RFQ later for outstanding requirements.\\n\\n':'')+'Proceed to create purchase orders?'))return
  setBusy(true)
  try{
   if(quoteException.trim()){
    const q=await supabase.from('proc_rfqs').update({quote_exception_reason:quoteException.trim(),updated_at:new Date().toISOString()}).eq('id',active.id)
    if(q.error)throw q.error
   }
   const p=await supabase.rpc('proc_finalize_award_plan_v2',{p_rfq_id:active.id,p_allocations:awardPlan.map(x=>({
    rfq_item_id:x.rfq_item_id,quote_line_id:x.quote_line_id,qty:Number(x.qty),override_reason:x.override_reason||null
   }))})
   if(p.error)throw p.error
   const made=Array.isArray(p.data)?p.data:[]
   flash(made.length+' reviewed purchase order'+(made.length===1?'':'s')+' created. Opening Orders.')
   setActive(null);setItems([]);setComparison([]);setAwardPlan([]);setAwardOpen(false);load();navigate('po')
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 function downloadRequest(inv){
  if(!active)return
  const supplierRow=suppliers.find(x=>x.id===inv.supplier_id)
  if(!supplierRow)return
  exportSupplierPriceRequestPdf({rfq:active,items,supplier:supplierRow,company,footer})
 }
 function supplierRequestArgs(inv){
  const supplierRow=suppliers.find(x=>x.id===inv.supplier_id)
  return {rfq:active,items,supplier:supplierRow,company}
 }
 function sendRequest(inv){
  if(!active)return
  const s=suppliers.find(x=>x.id===inv.supplier_id)
  if(!s)return
  const msg=buildSupplierQuoteReplyText(supplierRequestArgs(inv))
  const url=whatsappUrl(s.whatsapp||s.phone,msg)
  if(url)window.open(url,'_blank','noopener,noreferrer')
  else navigator.clipboard.writeText(msg).then(()=>flash('Reply-ready RFQ text copied. Send it to '+s.name+', then confirm Sent.')).catch(fail)
 }
 async function downloadPng(inv){
  try{await downloadSupplierPriceRequestPng(supplierRequestArgs(inv));flash('RFQ PNG downloaded.')}
  catch(e){fail(e)}
 }
 async function loadPairStatus(){
  if(profile?.role!=='admin')return
  try{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session?.access_token)return
   const response=await fetch('/api/integrations/whatsapp/pair',{
    headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
   })
   const payload=await response.json()
   setPairState(prev=>({...prev,status:payload.status||'OFFLINE',qr:payload.qr||null,code:null}))
   if(active?.id)void refreshGatewayStatus(active.id)
  }catch{setPairState(prev=>({...prev,status:'OFFLINE',qr:null,code:null}))}
 }
 async function pairAction(action){
  if(profile?.role!=='admin'||pairBusy)return
  if(action==='code'&&!window.confirm('Request a WhatsApp linking code for '+pairPhone+'? Only pair a dedicated number you control. Unofficial WhatsApp clients can risk account restriction.'))return
  setPairBusy(true)
  try{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session?.access_token)throw new Error('Please sign in again.')
   const response=await fetch('/api/integrations/whatsapp/pair',{
    method:'POST',
    headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({action,phoneNumber:pairPhone})
   })
   const payload=await response.json()
   if(!response.ok)throw new Error(payload.error||'Unable to request WhatsApp pairing.')
   if(action==='code')setPairState(prev=>({...prev,code:payload.code||null}))
   else flash('Gateway session started. Refresh status for QR or request a pairing code.')
  }catch(e){fail(e)}finally{setPairBusy(false)}
 }
 async function refreshGatewayStatus(rfqId){
  if(!rfqId||!canEdit)return
  try{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session?.access_token)return
   const response=await fetch('/api/integrations/whatsapp/rfq?rfqId='+encodeURIComponent(rfqId),{
    headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
   })
   const data=await response.json()
   setGateway(response.ok?data:{configured:false,connected:false,sendingEnabled:false,dispatches:[]})
  }catch{setGateway({configured:false,connected:false,sendingEnabled:false,dispatches:[]})}
 }
 async function sendAttachedPngViaGateway(inv){
  if(!active||!canEdit||gatewayBusy)return
  const s=suppliers.find(x=>x.id===inv.supplier_id)
  if(!s)return fail(new Error('Supplier is missing.'))
  const number=normalizeWhatsAppNumber(s.whatsapp||s.phone)
  if(!number)return fail(new Error('Add a valid supplier WhatsApp number before sending.'))
  if(!gateway.connected)return fail(new Error('Private WhatsApp gateway is not connected. Use the manual PNG fallback.'))
  const defaultCaption=['General Hardware — Supplier Price Request','RFQ: '+String(active.rfq_no||''),active.due_date?'Due: '+active.due_date:null,'Please check the attached RFQ image and reply with your unit rates. Add alternative sizes or remarks only when needed.'].filter(Boolean).join('\\n')
  const storedTemplate=typeof window!=='undefined'?window.localStorage.getItem('gh_rfq_whatsapp_caption_template'):null
  const template=storedTemplate||'General Hardware — Supplier Price Request\\nRFQ: {rfq_number}\\nDue: {due_date}\\nPlease check the attached RFQ image and reply with your unit rates. Add alternative sizes or remarks only when needed.'
  const filled=template.replaceAll('{rfq_number}',String(active.rfq_no||'')).replaceAll('{due_date}',String(active.due_date||'Not specified')).replaceAll('{supplier_name}',s.name)
  const edited=window.prompt('Edit the WhatsApp caption for '+s.name+' before sending. Cancel to stop.',filled)
  if(edited===null)return
  const caption=edited.trim()
  if(!caption||caption.length>2000)return fail(new Error('Caption must be 1–2000 characters.'))
  if(!window.confirm('Send the PNG with this caption to '+s.name+' (+'+number+')?\\n\\n'+caption))return
  setGatewayBusy(inv.id)
  try{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session?.access_token)throw new Error('Session expired. Please sign in again.')
   const png=await createSupplierPriceRequestPng(supplierRequestArgs(inv))
   if(png.blob.size>4_500_000)throw new Error('RFQ image is too large for the gateway. Use the manual PNG method.')
   const base64=await new Promise((resolve,reject)=>{
    const reader=new FileReader()
    reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'')
    reader.onerror=()=>reject(new Error('Could not read RFQ PNG.'))
    reader.readAsDataURL(png.blob)
   })
   const response=await fetch('/api/integrations/whatsapp/rfq',{
    method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},
    body:JSON.stringify({rfqId:active.id,supplierId:inv.supplier_id,pngBase64:base64,caption})
   })
   const data=await response.json()
   if(!response.ok)throw new Error(data?.error||'WhatsApp gateway could not send the image.')
   flash('Gateway accepted the PNG + caption for '+s.name+'. Check WhatsApp before confirming Sent.')
   await refreshGatewayStatus(active.id)
  }catch(e){fail(e);await refreshGatewayStatus(active.id)}finally{setGatewayBusy('')}
 }
 // Browser-only fallback: WhatsApp deep links can target a supplier and include text,
 // but cannot attach a local image. Download first, then use a user-clicked chat link.
 async function prepareBrowserRfq(inv){
  const s=suppliers.find(x=>x.id===inv.supplier_id)
  if(!s)return fail(new Error('The selected supplier could not be found.'))
  const number=normalizeWhatsAppNumber(s.whatsapp||s.phone)
  if(!number)return fail(new Error('Add a valid WhatsApp number for '+s.name+' in the Supplier Directory.'))
  setBrowserRfqReady(null)
  setBrowserRfqPreparing(inv.id)
  try{
   const out=await downloadSupplierPriceRequestPng(supplierRequestArgs(inv))
   setBrowserRfqReady({invitationId:inv.id,number,filename:out.filename})
   flash('RFQ PNG download started for '+s.name+'. Open their WhatsApp chat and attach '+out.filename+' from Downloads.')
  }catch(e){fail(e)}finally{setBrowserRfqPreparing('')}
 }
 function browserSupplierWhatsappUrl(inv,withText=true){
  const s=suppliers.find(x=>x.id===inv.supplier_id)
  if(!s)return ''
  // One WhatsApp link per selected supplier; nothing gets sent without their final Send tap.
  return whatsappUrl(s.whatsapp||s.phone,withText?buildSupplierPngShareText(supplierRequestArgs(inv)):'')
 }
 async function copyBrowserRfqCaption(inv){
  try{
   if(!navigator.clipboard?.writeText)throw new Error('Copy is not supported in this browser. Use Open WhatsApp + Text instead.')
   await navigator.clipboard.writeText(buildSupplierPngShareText(supplierRequestArgs(inv)))
   flash('Caption copied. Open the supplier chat without text, attach the PNG from Downloads, paste the caption onto the image, then send.')
  }catch(e){fail(e)}
 }
 function copyReplyText(inv){
  const msg=buildSupplierQuoteReplyText(supplierRequestArgs(inv))
  navigator.clipboard.writeText(msg).then(()=>flash('Supplier reply template copied.')).catch(fail)
 }
 async function confirmSent(inv){
  if(!canEdit||!active)return
  if(!confirm('Confirm that this RFQ was actually sent to '+supplierName(inv.supplier_id)+'?'))return
  const r=await supabase.rpc('proc_mark_rfq_supplier_sent_v1',{p_rfq_id:active.id,p_supplier_id:inv.supplier_id})
  if(r.error)return fail(r.error)
  flash('Supplier request marked Sent.');await open({...active,status:'sent'});load()
 }

 function reminder(inv){
  const s=suppliers.find(x=>x.id===inv.supplier_id)
  if(!s)return
  const msg='General Hardware — reminder for supplier price request '+active.rfq_no+(active.due_date?' due '+active.due_date:'')+'. Please send your quotation when possible.'
  const url=whatsappUrl(s.whatsapp||s.phone,msg)
  if(url)window.open(url,'_blank','noopener,noreferrer')
  else navigator.clipboard.writeText(msg).then(()=>flash('Reminder copied.')).catch(fail)
 }
 async function markDeclined(inv){
  if(!canEdit)return
  const r=await supabase.from('proc_rfq_suppliers').update({status:'declined',replied_at:new Date().toISOString()}).eq('id',inv.id)
  if(r.error)return fail(r.error)
  flash(supplierName(inv.supplier_id)+' marked declined.');open(active);load()
 }
 async function extendDue(){
  if(!canEdit||!active)return
  const next=prompt(t('prompt.new_quote_due','New quotation due date (YYYY-MM-DD):'),active.due_date||'')
  if(!next)return
  if(!/^\d{4}-\d{2}-\d{2}$/.test(next))return fail(new Error(t('validation.date_format','Enter the due date as YYYY-MM-DD.')))
  const r=await supabase.from('proc_rfqs').update({due_date:next,updated_at:new Date().toISOString()}).eq('id',active.id).select('*').single()
  if(r.error)return fail(r.error)
  setActive(r.data);flash('Quotation due date extended.');load()
 }

 const supplierName=id=>suppliers.find(s=>s.id===id)?.name||id
 const bestByItem=useMemo(()=>{const m={};comparison.forEach(x=>{if(Number(x.landed_rank)===1)m[x.rfq_item_id]=(m[x.rfq_item_id]||[]).concat(x)});return m},[comparison])
 const show=k=>fieldEnabled(fields,'rfq',k),label=(k,v)=>fieldLabel(fields,'rfq',k,v)
 const overdue=r=>r.due_date&&r.due_date<new Date().toISOString().slice(0,10)&&['sent','partially_quoted'].includes(r.status)

 return <>
  <ProcurementPath active={journeyStage} t={t}/>
  <div className="split rfq-split">
  <div className="card pad"><div className="sectionhead"><div><h3>{t('buying.rfq_title','RFQs & Quotes')} <InfoButton topic="quotation_comparison" language={language}/></h3><p>{t('buying.rfq_hint',"Send the RFQ, enter each supplier price, availability and delivery time, then review the award before ordering.")}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>
   <div className="stack">{rfqs.map(r=>{const s=summaries[r.id]||{total:0,quoted:0,waiting:0};return <button className={'btn record-button '+(active?.id===r.id?'active-record':'')} key={r.id} onClick={()=>open(r)}><div><strong>{r.rfq_no}</strong><div className="muted tiny">{s.quoted}/{s.total} prices received · {s.waiting} waiting · due {r.due_date||'—'}</div></div><div className="right">{overdue(r)&&<Badge>overdue</Badge>}<Badge>{r.status}</Badge></div></button>})}</div>
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Previous</button><span className="muted tiny">{rfqTotal?page*pageSize+1:0}–{Math.min((page+1)*pageSize,rfqTotal)} of {rfqTotal}</span><button className="btn" disabled={(page+1)*pageSize>=rfqTotal} onClick={()=>setPage(x=>x+1)}>Next</button></div>
  </div>

  <div className="card pad">{!active?<Empty>Select a supplier price request.</Empty>:<>
   {profile?.role==='admin'&&<details className="section"><summary><strong>WhatsApp Gateway Setup (Administrator)</strong></summary><div className="notice section"><p className="muted tiny">Unregulated third-party WhatsApp Web automation may restrict your account. Use a separate procurement number. Pairing is optional; no messages are sent merely by connecting.</p><div className="toolbar"><span>Session: <strong>{pairState.status}</strong></span><button className="btn small" disabled={pairBusy} onClick={()=>loadPairStatus()}>Refresh Pairing Status</button><button className="btn small" disabled={pairBusy||pairState.status==='WORKING'} onClick={()=>pairAction('start')}>Start Session</button></div>{pairState.status!=='WORKING'&&<div className="formgrid section"><div className="field"><label>Dedicated WhatsApp number</label><input className="input" inputMode="tel" autoComplete="off" value={pairPhone} onChange={e=>setPairPhone(e.target.value)} placeholder="+94771234567"/></div><div className="field"><label>Link with phone number</label><button className="btn" disabled={pairBusy||pairState.status==='NOT_CONFIGURED'||pairState.status==='OFFLINE'} onClick={()=>pairAction('code')}>Request Pairing Code</button></div></div>}{pairState.code&&<p><strong>WhatsApp pairing code: {pairState.code}</strong><span className="muted tiny"> · Enter it using WhatsApp → Linked Devices. Do not share this code.</span></p>}{pairState.qr&&<div className="section"><p className="muted tiny">Alternative: scan this QR using WhatsApp → Linked Devices on a separate device. Refresh if it expires.</p><img src={pairState.qr} alt="WhatsApp linked-device pairing QR" width="240" height="240" style={{maxWidth:'100%',height:'auto'}}/></div>}{pairState.status==='WORKING'&&<p className="muted tiny">WhatsApp session linked. Sending can be enabled by the owner after a private test and migration check.</p>}</div></details>}

   <div className="sectionhead"><div><h3>{active.rfq_no}</h3><p>{invite.filter(x=>x.status==='quoted').length}/{invite.length} supplier responses · {pricedCount}/{items.length} items priced · {unpricedCount} awaiting prices. Preferred supplier comparison minimum: {minQuotes}.</p></div><div className="toolbar">{canEdit&&<button className="btn" onClick={extendDue}>Extend Due</button>}{canEdit&&awardReviewEnabled&&<button className="btn good" disabled={busy||!comparison.length} onClick={buildAwardReview}>Review Quoted Items ({pricedCount}) →</button>}</div></div>

   {invite.some(x=>x.status!=='quoted'&&x.status!=='declined')&&<div className="notice section"><b>{invite.some(x=>['pending','prepared'].includes(x.status))?'Send prepared supplier requests':'Waiting for supplier prices'}</b><div className="stack section">{invite.filter(x=>x.status!=='quoted'&&x.status!=='declined').map(x=><div className="mobile-data-card" key={x.id}><div className="toolbar"><span>{supplierName(x.supplier_id)} · {x.status}</span>{['pending','prepared'].includes(x.status)?<><button className="btn small primary" onClick={()=>setSendMenuId(v=>v===x.id?'':x.id)}>Send Request</button>{canEdit&&<button className="btn small good" onClick={()=>confirmSent(x)}>Confirm Sent</button>}</>:<button className="btn small" onClick={()=>reminder(x)}>WhatsApp Reminder</button>}{canEdit&&<button className="btn small" onClick={()=>markDeclined(x)}>Mark Declined</button>}</div>{['pending','prepared'].includes(x.status)&&sendMenuId===x.id&&<div className="section"><div className="muted tiny">Send a real attached PNG and caption through the private gateway (once configured and linked). Gateway acceptance is not proof of delivery. Check WhatsApp before confirming Sent; never retry unknown attempts blindly. The browser-only manual fallback remains available.</div><div className="toolbar section"><span className="muted tiny">WhatsApp gateway: {gateway.connected?'Connected':gateway.configured?'Not linked / offline':'Not configured'}</span><button className="btn small" onClick={()=>refreshGatewayStatus(active.id)}>Refresh Status</button></div><div className="toolbar section"><button className="btn small primary" disabled={Boolean(gatewayBusy)} onClick={()=>{const previous=gateway.dispatches?.find(d=>d.supplier_id===x.supplier_id);if(!canEdit)return fail(new Error('Your account cannot edit this RFQ. Sign in with an authorized procurement account.'));if(!gateway.connected)return fail(new Error('WhatsApp gateway is disconnected. Tap Refresh Status.'));if(!gateway.sendingEnabled)return fail(new Error('WhatsApp sending is disabled in Railway configuration. Tap Refresh Status after deployment.'));if(previous)return fail(new Error('An attempt already exists ('+previous.status+'). Check WhatsApp and dispatch history before retrying.'));sendAttachedPngViaGateway(x)}}>{gatewayBusy===x.id?'Sending PNG…':'Send Attached PNG + Caption'}</button><button className="btn small" onClick={()=>{const current=window.localStorage.getItem('gh_rfq_whatsapp_caption_template')||'General Hardware — Supplier Price Request\\nRFQ: {rfq_number}\\nDue: {due_date}\\nPlease check the attached RFQ image and reply with your unit rates.';const next=window.prompt('Edit the default caption template. Use {supplier_name}, {rfq_number}, {due_date}. Saved on this device.',current);if(next!==null){if(!next.trim()||next.length>2000)return fail(new Error('Template must be 1–2000 characters.'));window.localStorage.setItem('gh_rfq_whatsapp_caption_template',next);flash('WhatsApp template saved on this device.')}}}>Edit Message Template</button>{gateway.dispatches?.filter(d=>d.supplier_id===x.supplier_id).map(d=><span key={d.id} className="muted tiny">Gateway: {d.status} · {new Date(d.created_at).toLocaleString()} {d.status==='unknown'?'— check WhatsApp before any resend':''}</span>)}</div><div className="muted tiny section">Manual fallback (no gateway): Download the image, open this supplier's chat, and attach it from Downloads.</div><div className="toolbar section"><button className="btn small primary" disabled={browserRfqPreparing===x.id} onClick={()=>prepareBrowserRfq(x)}>{browserRfqPreparing===x.id?'Preparing PNG…':'1 · Download PNG for WhatsApp'}</button><button className="btn small" onClick={()=>sendRequest(x)}>WhatsApp Text Only</button><button className="btn small" onClick={()=>downloadPng(x)}>Download PNG Only</button><button className="btn small" onClick={()=>downloadRequest(x)}>{t('buying.rfq_pdf','RFQ PDF')}</button><button className="btn small" onClick={()=>copyReplyText(x)}>Copy Reply Text</button></div>{browserRfqReady?.invitationId===x.id&&<div className="section"><div className="muted tiny">PNG download started: <strong>{browserRfqReady.filename}</strong>. Option A: open WhatsApp with the RFQ text ready, send the text and then attach the PNG from Downloads. Both messages go to this supplier.</div><div className="toolbar section"><a className="btn small primary" href={browserSupplierWhatsappUrl(x,true)} target="_blank" rel="noopener noreferrer">2 · Open WhatsApp + Text · {supplierName(x.supplier_id)}</a></div><div className="muted tiny section">Option B (one image with a caption): copy the RFQ message, open the same supplier chat without prefilled text, attach the saved PNG, paste the copied message as its caption and send.</div><div className="toolbar section"><button className="btn small" onClick={()=>copyBrowserRfqCaption(x)}>Copy PNG Caption</button><a className="btn small" href={browserSupplierWhatsappUrl(x,false)} target="_blank" rel="noopener noreferrer">Open Supplier Chat for Caption</a></div></div>}</div>}</div>)}</div></div>}

   <div className="formgrid">
    <div className="field"><label>{label('supplier','Supplier')}</label><select className="select" value={supplier} onChange={e=>loadExistingQuote(active.id,e.target.value)}>{invite.map(x=><option key={x.supplier_id} value={x.supplier_id}>{supplierName(x.supplier_id)} · {x.status}</option>)}</select></div>
    {show('attachment')&&canEdit&&<div className="field"><label>Supplier quotation attachment (optional)</label><input className="input" type="file" accept="application/pdf,image/*" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<button type="button" className="btn small section" disabled={quoteOcrBusy} onClick={readQuoteAutomatically}>{quoteOcrBusy?'Reading quotation…':'Read Prices Automatically'}</button>}</div>}
   </div>
   <p className="muted tiny section">Only enter the supplier's unit price. Alternative sizes and remarks are optional reference details; alternative sizes will not automatically replace the requested item in a purchase order.</p>
   <div className="desktop-table tablewrap section"><table className="table"><thead><tr><th>Order?</th><th>Item / size</th><th>Qty</th><th>Supplier price (Rs.)</th><th>Remarks</th><th>Optional size variations</th></tr></thead>
   <tbody>{items.map(i=>{const v=prices[i.id]||{};return <tr key={i.id}>
    <td><input type="checkbox" checked={i.selected_for_po!==false} disabled={!canEdit} onChange={e=>togglePoItem(i,e.target.checked)}/></td>
    <td><strong>{itemTitle(i.requirement?.item||{})}</strong><div className="muted tiny">{i.requirement?.item?.uom||''}</div></td>
    <td>{qty(i.requested_qty)}</td>
    <td><input className="input stock-entry" inputMode="decimal" disabled={!canEdit} placeholder="Price" value={v.price??''} onChange={e=>editPrice(i.id,{price:e.target.value})}/></td>
    <td><input className="input" maxLength={500} disabled={!canEdit} placeholder="Optional remarks" value={v.remarks||''} onChange={e=>editPrice(i.id,{remarks:e.target.value})}/></td>
    <td>{sizeAlternativesEditor(i.id,v)}</td>
   </tr>})}</tbody></table></div>

   <div className="mobile-card-list section" style={{display:'block'}}>
    <div className="muted tiny" style={{marginBottom:8}}>Quick price entry · tap Details only for remarks or alternative sizes</div>
    {items.map(i=>{const v=prices[i.id]||{};return <div key={i.id} style={{borderBottom:'1px solid var(--border, #334155)',padding:'8px 0'}}>
     <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 105px 42px',alignItems:'center',gap:8}}>
      <div style={{minWidth:0}}><strong style={{fontSize:14,lineHeight:1.3,display:'block',overflowWrap:'anywhere'}}>{itemTitle(i.requirement?.item||{})}</strong><span className="muted tiny">{qty(i.requested_qty)} {i.requirement?.item?.uom||''}</span></div>
      <input aria-label={'Unit price for '+itemTitle(i.requirement?.item||{})} className="input stock-entry" style={{width:'100%',minWidth:0,padding:'9px 7px'}} inputMode="decimal" disabled={!canEdit} placeholder="Rs." value={v.price??''} onChange={e=>editPrice(i.id,{price:e.target.value})}/>
      <label title="Include in order" style={{display:'flex',alignItems:'center',justifyContent:'center'}}><input aria-label={'Order '+itemTitle(i.requirement?.item||{})} type="checkbox" checked={i.selected_for_po!==false} disabled={!canEdit} onChange={e=>togglePoItem(i,e.target.checked)}/></label>
     </div>
     <details style={{marginTop:3}}><summary className="muted tiny" style={{cursor:'pointer',padding:'5px 0'}}>Details / remarks / sizes {(v.remarks||(v.variants||[]).length)?'●':''}</summary>
      <div className="field" style={{marginTop:8}}><label>Remarks (optional)</label><input className="input" maxLength={500} disabled={!canEdit} placeholder="Optional remarks" value={v.remarks||''} onChange={e=>editPrice(i.id,{remarks:e.target.value})}/></div>
      <div className="section"><span className="muted tiny">Alternative sizes (optional)</span>{sizeAlternativesEditor(i.id,v)}</div>
     </details>
    </div>})}
   </div>

   <div className="toolbar section">{canEdit&&<button className="btn primary" disabled={busy} onClick={saveQuote}>{busy?'Saving…':'Save Supplier Price'}</button>}<span className="muted tiny">{pricedCount} priced · {unpricedCount} awaiting price · Saving does not create an order.</span></div>
   {comparison.length>0&&<div className="section" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
    <button className="btn good" type="button" disabled={busy} onClick={buildAwardReview}>Next: Review Quoted Items →</button>
    {selectedUnpriced.length>0&&<><button className="btn small" disabled={busy} onClick={selectOnlyPricedItems}>Select Priced Items Only ({pricedCount})</button><span className="muted tiny">{selectedUnpriced.length} unpriced item(s) are still selected. You can untick them individually or use this button before reviewing.</span></>}
   </div>

   {active?.status==='awarded'&&items.some(i=>Number(i.requirement?.adjusted_qty||0)>Number(i.requirement?.ordered_qty||0))&&<div className="section" style={{padding:12,border:'1px solid var(--border, #334155)',borderRadius:12}}>
   <strong>Outstanding items need a follow-up RFQ</strong>
   <p className="muted tiny">The original RFQ and purchase orders stay unchanged. Prepare a new RFQ for outstanding requirements, then review its suppliers and quantities before sending.</p>
   <button className="btn primary" disabled={busy||!canEdit} onClick={createFollowUpRfq}>Prepare Follow-up RFQ</button>
  </div>}
  {awardOpen&&<div className="award-review section"><div className="sectionhead"><div><h3>{t('buying.award_order','Step 7 · Review Selected Prices & Create Orders')}</h3><p>Check supplier, quantity and unit price for each selected item. Open More only when you need to change an allocation. Creating orders is a separate final action.</p></div><button className="btn small" onClick={()=>setAwardOpen(false)}>{t('common.close','Close')}</button></div>
    <div className="section" style={{padding:'10px 12px',border:'1px solid var(--border, #334155)',borderRadius:12}}>
     <strong>Order summary</strong>
     <div className="muted tiny" style={{marginTop:4}}>{awardPlan.length} allocations · {awardSuppliers.length} supplier(s) · {awardUnselected.length} items not selected</div>
     <div style={{marginTop:6}}><strong>Estimated landed goods: {money(awardEstimate)}</strong></div>
     {awardSuppliers.map(id=>{const rows=awardPlan.filter(x=>x.supplier_id===id);return <div key={id} className="muted tiny" style={{marginTop:4}}>{rows[0]?.supplier_name||'Supplier'} · {rows.length} allocation(s) · {money(rows.reduce((v,x)=>v+(Number(x.qty)||0)*(Number(x.landed_unit_cost)||0),0))}</div>})}
     {awardProblems.length>0&&<div role="alert" style={{marginTop:8}}>Check {awardProblems.length} invalid allocation(s) before ordering.</div>}
     {awardUnselected.length>0&&<div className="muted tiny" style={{marginTop:8}}>Unselected items remain outstanding in stock requirements. This RFQ will close when orders are created; request new quotations for remaining items through a new RFQ.</div>}
     <div className="muted tiny" style={{marginTop:5}}>Estimated landed goods excludes possible supplier-level freight adjustments. Confirm final PO totals in Orders.</div>
    </div>
    <details className="section"><summary className="muted tiny" style={{cursor:'pointer'}}>Advanced: quotation minimum exception</summary><div className="field" style={{marginTop:8}}><label>Reason for proceeding without enough supplier quotations</label><input className="input" value={quoteException} onChange={e=>setQuoteException(e.target.value)} placeholder="Enter a reason only when making an exception."/></div></details>
    <div className="section" style={{display:'grid',gap:6}}>{items.filter(i=>i.selected_for_po!==false).map(item=>{const plans=awardPlan.filter(p=>p.rfq_item_id===item.id),speed=itemNeedsSpeed(item.id);return <div key={item.id} style={{borderBottom:'1px solid var(--border, #334155)',padding:'8px 0',minWidth:0}}>
     <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,flexWrap:'wrap'}}><strong style={{fontSize:14,overflowWrap:'anywhere'}}>{itemTitle(item.requirement?.item||{})}</strong><span className="muted tiny">Outstanding {qty(Math.min(Number(item.requested_qty||0),Math.max(Number(item.requirement?.adjusted_qty||0)-Number(item.requirement?.ordered_qty||0),0)))}{speed?' · Urgent':''}</span></div>
     {plans.map(row=><div key={row.id} style={{marginTop:5}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 76px',gap:6,alignItems:'center'}}>
       <select aria-label={'Supplier for '+itemTitle(item.requirement?.item||{})} className="select" style={{minWidth:0,width:'100%',fontSize:13,padding:'9px 6px'}} value={row.quote_line_id} onChange={e=>changeAwardSupplier(row,e.target.value)}>{candidatesFor(item.id).map(x=><option value={x.quote_line_id} key={x.quote_line_id}>{x.supplier_name}</option>)}</select>
       <input aria-label={'Award quantity for '+itemTitle(item.requirement?.item||{})} className="input stock-entry" style={{minWidth:0,width:'100%',padding:'9px 6px'}} inputMode="decimal" value={row.qty} onChange={e=>updateAward(row.id,{qty:e.target.value})}/>
      </div>
      <div className="muted tiny" style={{marginTop:4,display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}><strong>{money(row.landed_unit_cost)} / unit</strong><span>{row.recommended?'Recommended':'Changed supplier'}</span><span>{row.lead_days==null?'Delivery not specified':row.lead_days+' day(s) delivery'}</span></div>
      <details style={{marginTop:2}}><summary className="muted tiny" style={{cursor:'pointer',padding:'5px 0'}}>More: availability, MOQ, reason, remove {row.override_reason?'●':''}</summary><div className="muted tiny" style={{padding:'6px 0'}}>Available: {row.available_qty==null?'Not specified':qty(row.available_qty)} · MOQ: {qty(candidatesFor(item.id).find(x=>x.quote_line_id===row.quote_line_id)?.moq||0)}</div>
       <div className="field" style={{marginTop:6}}><label>{row.recommended?'Reason (optional)':'Override reason (required)'}</label><input className="input" value={row.override_reason||''} onChange={e=>updateAward(row.id,{override_reason:e.target.value})} placeholder={row.recommended?'Reason only if needed':'Override reason required'}/></div>
       <button className="btn small bad" type="button" onClick={()=>setAwardPlan(v=>v.filter(x=>x.id!==row.id))}>Remove allocation</button>
      </details>
     </div>)}
     <details style={{marginTop:3}}><summary className="muted tiny" style={{cursor:'pointer',padding:'5px 0'}}>More options / split order</summary><button className="btn small" type="button" onClick={()=>addAwardSplit(item.id)}>+ Split supplier allocation</button><div className="muted tiny">{speed?'Faster delivery preferred':'Lowest landed cost preferred'}{item.requirement?.priority?' · '+String(item.requirement.priority).toUpperCase():''}</div></details>
    </div>})}</div>
    <button className="btn primary section" disabled={busy} onClick={finalizeAward}>{busy?'Creating POs…':t('buying.create_orders','Confirm & Create Supplier Orders')}</button>
   </div>}
  </>}</div>
 </div>
 </>
}

