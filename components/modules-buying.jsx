'use client'

import {DeleteRecordButton} from './delete-record'

import {ModernSelect} from './modern-select'
import {SupplierChecklist} from './supplier-checklist'
import {companyApi} from './company-controls'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useDangerConfirmation,useActionConfirmation,useTextPrompt} from './danger-confirmation'
import {businessDate,money,qty,stamp,itemTitle,whatsappUrl,formatSriLankaSupplierPhoneInput,toSriLankaSupplierPhone,normalizeWhatsAppNumber} from '@/lib/helpers'
import {uppercaseItemText} from '@/lib/item-text.mjs'
import {additionalSizeLines,encodeSupplierQuoteNotes,decodeSupplierQuoteNotes,normalizePriceInput,validateSupplierQuoteVariants} from '@/lib/quote-line-notes'
import {matchesRfqItem,supplierRequestItems,pricedReviewSelection,supplierQuoteProgress,nextQuoteSupplier} from '@/lib/rfq-sheet'
import {OrderProgress,StockSubmissionDetails} from './order-progress'
import {sriLankaTimestamp} from '@/lib/procurement-journey.mjs'
import {RfqBulkSend} from './rfq-bulk-send'
import {SupplierDocumentEditor} from './supplier-document-editor'
import {defaultSupplierTemplate,documentCompany,documentLines,documentCaption} from '@/lib/supplier-template.mjs'
import {SupplierRequestSelection,RfqComparisonSheet} from './rfq-sheet'
import {allRows,containsAny} from '@/lib/query-pages'
import {ItemLabel,Badge,DataTable,configuredColumns,fieldEnabled,fieldLabel,Empty} from './ui'
import {InfoButton} from './help-ui'
import {ItemActivity} from './item-activity'
import {nextRequirementAction} from '@/lib/procurement-flow'
import {extractPriceListFile} from '@/lib/price-list-extract'
import {contactNameKey,matchContactPhone,duplicateContactNumbers} from '@/lib/contact-duplicates.mjs'
import {exportSupplierPriceRequestPdf} from '@/lib/pdf'
import {buildSupplierQuoteReplyText,buildSupplierPngShareText,createSupplierPriceRequestPng,downloadSupplierPriceRequestPng} from '@/lib/rfq-share'

export function Requirements({activeView='requirements',initialFilter='',profile,fields,features=[],flash,fail,can=()=>false,navigate=()=>{},guidedStep=2,guideRevision=0,guideTo=()=>{},isActiveView=()=>true,t=(k,f)=>f||k}){
 const targetRequirement=/^requirement:[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(initialFilter)?initialFilter.slice(12):''
 const reviewRef=useRef(null),supplierBuilderRef=useRef(null)
 useEffect(()=>{if(activeView!=='requirements')return;requestAnimationFrame(()=>{const target=(guidedStep===3?supplierBuilderRef.current:null)||reviewRef.current;target?.scrollIntoView({block:'start'});target?.focus({preventScroll:true})})},[activeView,guidedStep,guideRevision])
 const canAdd=can('procurement.requirements.manage')
 const canReview=can('procurement.requirements.manage')
 const specialEnabled=features.find(x=>x.feature_key==='requirements.special_requests')?.enabled!==false
 const[rows,setRows]=useState([]),[suppliers,setSuppliers]=useState([]),[selected,setSelected]=useState(new Set()),[chosen,setChosen]=useState(new Set()),[suggestedSuppliers,setSuggestedSuppliers]=useState([]),[due,setDue]=useState(''),[busy,setBusy]=useState(false),[page,setPage]=useState(0),[total,setTotal]=useState(0),[scopeOverrides,setScopeOverrides]=useState({})
 const[activity,setActivity]=useState(null),[requirementSearch,setRequirementSearch]=useState(''),[categoryFilter,setCategoryFilter]=useState('')
 const[supplierKind,setSupplierKind]=useState('general')
 const pageSize=20
 const[oldestFirst,setOldestFirst]=useState(false)
 const[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([]),[manualQty,setManualQty]=useState(''),[manualNote,setManualNote]=useState('')
 const[addMode,setAddMode]=useState('standard'),[specialItem,setSpecialItem]=useState(null)
 const[special,setSpecial]=useState({reason:'customer_request',customer_qty:'',purchase_qty:'',customer_reference:'',notes:'',priority:''})
 const[stage,setStage]=useState(targetRequirement?(guidedStep===3?'approved':'all'):['all','to_order','delivery'].includes(initialFilter)?initialFilter:(canReview?'pending_review':'all'))
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
  if(targetRequirement)q=q.eq('id',targetRequirement)
  if(stage==='to_order')q=q.gt('remaining_to_order',0)
  if(stage==='pending_review')q=q.eq('approval_status','pending_review')
  if(stage==='approved')q=q.eq('approval_status','approved').gt('remaining_to_order',0).eq('has_active_rfq',false)
  if(stage==='held')q=q.eq('approval_status','held')
  if(stage==='attention')q=q.eq('approval_status','approved').gt('remaining_to_order',0)
  if(stage==='overdue')q=q.eq('approval_status','approved').gt('remaining_to_order',0).lt('created_at',new Date(Date.now()-10*86400000).toISOString())
  if(stage==='delivery')q=q.gt('ordered_not_received',0)
  if(stage==='uncovered')q=q.eq('approval_status','approved').gt('remaining_to_order',0).eq('has_active_rfq',false)
  if(controlFilter==='urgent')q=q.eq('priority','urgent')
  if(controlFilter==='partial')q=q.gt('ordered_qty',0).gt('remaining_to_order',0).eq('approval_status','approved')
  if(categoryFilter)q=q.eq('category',categoryFilter)
  if(requirementSearch.trim())q=q.or(containsAny(['description','size','item_code','requirement_no'],requirementSearch.trim()))
  const tasks=[q]
  if(canReview){
   tasks.push(allRows(()=>supabase.from('proc_suppliers').select('id,supplier_code,name,supplier_kind').eq('active',true).order('name').order('id')))
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
  const a=results[0];if(a.error)throw a.error;setRows(a.data||[]);setTotal(a.count||0);if(targetRequirement)setSelected(new Set((a.data||[]).map(r=>r.id)))
  if(canReview){
   const b=results[1];if(b.error)throw b.error;setSuppliers(b.data||[])
   for(const x of results.slice(2))if(x.error)throw x.error
   setSummary({review:results[2].count||0,rfq:results[3].count||0,quotes:results[4].count||0,orders:results[5].count||0})
   setControlCounts({outstanding:results[6].count||0,overdue:results[7].count||0,uncovered:results[8].count||0,delivery:results[9].count||0})
  }
 }catch(e){fail(e)}},[fail,stage,canReview,page,oldestFirst,controlFilter,categoryFilter,requirementSearch,targetRequirement])
 useEffect(()=>{if(activeView==='requirements')load()},[load,activeView])
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
  if(busy)return
  if(!canReview||!ids.length)return fail(new Error(t('requirements.select_one','Select at least one requirement.')))
  const reason=action==='approve'?null:(prompt(action==='hold'?'Reason for holding these items (optional):':'Reason for rejecting these items (optional):')||null)
  setBusy(true)
  try{
   if(action==='approve'){
    const source=await supabase.from('proc_requirements').select('id,company_id').in('id',ids)
    if(source.error)throw source.error
    const companies=[...new Set((source.data||[]).map(r=>r.company_id).filter(Boolean))]
    const direct=[]
    for(const companyId of companies){
     const companyIds=(source.data||[]).filter(r=>r.company_id===companyId).map(r=>r.id)
     const candidates=await supabase.rpc('proc_company_direct_candidate_ids',{p_company_id:companyId,p_ids:companyIds})
     if(candidates.error)throw candidates.error
     const directIds=candidates.data||[]
     if(!directIds.length)continue
     const result=await supabase.rpc('proc_company_approve_direct',{p_company_id:companyId,p_ids:directIds})
     if(result.error)throw result.error
     direct.push(...directIds)
     if((result.data||[]).some(po=>po.auto_send)){
      try{const sent=await companyApi('orders',{companyId});flash(sent.message)}
      catch(e){fail(new Error('PO created but WhatsApp dispatch needs attention: '+e.message))}
     }
    }
    ids=ids.filter(id=>!direct.includes(id))
    if(!ids.length){setSelected(new Set());await load();flash('Direct company requirements converted to purchase orders.');if(isActiveView('requirements'))navigate('po');return}
   }
   const r=await supabase.rpc('proc_review_requirements',{p_requirement_ids:ids,p_action:action,p_selected:action==='approve',p_reason:reason})
  if(r.error)return fail(r.error)
  flash((r.data||ids.length)+' requirement(s) '+(action==='approve'?'approved for supplier pricing':action==='hold'?'placed on hold':'rejected')+'.');setChosen(new Set());if(action==='approve'){setSelected(new Set(ids));setStage('approved');if(isActiveView('requirements'))guideTo(3)}else{setSelected(new Set());load()}
  }catch(e){fail(e)}finally{setBusy(false)}
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
  flash('RFQ '+r.data.rfq_no+' prepared for '+ids.length+' item(s). Next: send it and enter supplier prices.');setSelected(new Set());setChosen(new Set());setScopeOverrides({});setDue('');load();if(isActiveView('requirements'))navigate('rfq',r.data.id,3)
 }

 const defaults=[
  {key:'actions',label:'Next action',render:r=><button className="btn small" onClick={()=>setActivity(r)}>{nextRequirementAction(r)}</button>},
  {key:'requirement_no',label:'Requirement',render:r=><span className="mono tiny">{r.requirement_no}</span>},
  {key:'description',label:'Item',render:r=><><button className="item-link" onClick={()=>setActivity(r)}>{itemTitle(r)}</button><div className="muted tiny">{r.uom||''} · {r.category}</div></>},
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
  {targetRequirement&&<div className="notice toolbar"><span>Showing only the selected urgent item.</span><button type="button" className="btn small" onClick={()=>navigate('requirements','all',2)}>Show all requirements</button></div>}
  {activity&&<ItemActivity row={activity} onClose={()=>setActivity(null)} can={can} navigate={navigate}/>}
  <div hidden={guidedStep===3&&stage==='approved'&&selected.size>0}>
  <div className="filters two sticky-work-search"><input aria-label="Search outstanding items" className="input" placeholder="Search item, size or requirement" value={requirementSearch} onChange={e=>{setRequirementSearch(e.target.value);setPage(0)}}/><input aria-label="Filter requirement category" className="input" placeholder="Category (e.g. BATHROOM)" value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value.toUpperCase());setPage(0)}}/></div>
  {canReview&&<details className="card pad section procurement-work-queues"><summary>Work queues & exceptions</summary><section aria-label="Procurement control summary">
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
  </section></details>}
  <nav hidden aria-label="Procurement quick actions" className="card pad section">
   <div className="muted tiny">SECTION SHORTCUTS</div>
   <div className="row wrap" style={{gap:8}}>
    <button type="button" className="btn small" onClick={()=>navigate('stock')}>Check stock</button>
    <button type="button" className="btn small" onClick={()=>{changeStage('uncovered');setControlFilter('all')}}>Request prices</button>
    <button type="button" className="btn small" onClick={()=>navigate('rfq')}>Compare & order</button>
    <button type="button" className="btn small" onClick={()=>navigate('receiving')}>Receive & complete</button>
   </div>
   <div className="muted tiny">Approvals, quotations and purchase-order controls remain in their existing screens.</div>
  </nav>
    <div className="procurement-focus-row">
   <label className="muted tiny" htmlFor="proc-attention-filter">Focus</label>
   <ModernSelect id="proc-attention-filter" className="input" value={controlFilter} onChange={e=>{setPage(0);setControlFilter(e.target.value)}}>
    <option value="all">All requirements</option><option value="urgent">Urgent priority</option><option value="partial">Partially ordered</option>
   </ModernSelect>
  </div>
  <div className="procurement-sort-row"><button type="button" className="btn small" aria-pressed={oldestFirst} onClick={()=>{setPage(0);setOldestFirst(v=>!v)}}>{oldestFirst?'✓ Oldest requirements first':'Sort: newest activity'}</button><details className="procurement-waiting-help"><summary>About waiting age</summary><p className="muted tiny">Waiting age is measured from the requirement creation date; outstanding quantities remain visible.</p></details></div>
  {canAdd&&<details className="card pad procurement-manual-add">
   <summary className="procurement-manual-summary"><b>+ {t('requirements.manual_special','Manual / Special Purchase')}</b><span>{t('requirements.manual_special_hint','Use only when the item is not from a stock submission.')}</span></summary>
   <div className="section procurement-manual-body"><div className="sectionhead"><div><h3>{t('requirements.manual_special','Manual / Special Purchase')}</h3><p>{t('requirements.normal_shortages_hint','Optional. Normal shortages arrive automatically from submitted stock counts.')}</p></div><div className="toolbar"><button className={'btn '+(addMode==='standard'?'primary':'')} onClick={()=>{setAddMode('standard');setSpecialItem(null)}}>{t('requirements.standard','Standard')}</button>{specialEnabled&&<button className={'btn '+(addMode==='special'?'primary':'')} onClick={()=>setAddMode('special')}>{t('requirements.special','Special Purchase')}</button>}</div></div>
   <div className="field"><label>{t('requirements.find_item','Find item')}</label><input className="input" value={itemSearch} onChange={e=>setItemSearch(uppercaseItemText(e.target.value))} placeholder={t('requirements.find_placeholder','Search item, code, brand or size')}/></div>

   {addMode==='standard'&&<div className="formgrid section"><div className="field"><label>{t('requirements.required_qty','Required quantity')}</label><input className="input" inputMode="decimal" value={manualQty} onChange={e=>setManualQty(e.target.value)}/></div><div className="field"><label>{t('requirements.note_optional','Note (optional)')}</label><input className="input" value={manualNote} onChange={e=>setManualNote(e.target.value)}/></div></div>}

   {itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button className="btn record-button" key={i.id} onClick={()=>addMode==='special'?chooseSpecial(i):addManual(i)}><div><strong>{itemTitle(i)}</strong><div className="muted tiny">{[i.item_code,i.uom,i.category].filter(Boolean).join(' · ')}</div>{addMode==='special'&&<div className="muted tiny">Stock {qty(i.book_stock??0)} · Reorder {qty(i.reorder_level)} · Max {qty(i.max_stock)}</div>}</div><span>{addMode==='special'?t('requirements.select','Select'):'+ '+t('requirements.add','Add')}</span></button>)}</div>}

   {addMode==='special'&&specialItem&&<div className="special-request-builder section">
    <div className="selected-item-box"><div><strong>{itemTitle(specialItem)}</strong><div className="muted tiny">{[specialItem.item_code,specialItem.uom,specialItem.category,specialItem.movement].filter(Boolean).join(' · ')}</div></div><button className="btn small" onClick={()=>setSpecialItem(null)}>{t('requirements.change','Change')}</button></div>
    <div className="special-stock-context section"><div><span>Current Stock</span><b>{qty(specialItem.book_stock??0)}</b></div><div><span>Reorder</span><b>{qty(specialItem.reorder_level)}</b></div><div><span>Max Stock</span><b>{qty(specialItem.max_stock)}</b></div><div><span>Movement</span><b>{specialItem.movement}</b></div></div>
    <div className="formgrid section">
     <div className="field"><label>{t('requirements.why_extra','Why are we buying extra?')}</label><ModernSelect className="select" value={special.reason} onChange={e=>setSpecial(x=>({...x,reason:e.target.value}))}>{Object.entries(reasonLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</ModernSelect></div>
     {['customer_request','customer_paid'].includes(special.reason)&&<div className="field"><label>{t('requirements.customer_qty','Customer requested quantity')}</label><input className="input" inputMode="decimal" value={special.customer_qty} onChange={e=>setSpecial(x=>({...x,customer_qty:e.target.value}))}/></div>}
     <div className="field"><label>{t('requirements.purchase_qty','Purchase quantity')}</label><input className="input" inputMode="decimal" value={special.purchase_qty} onChange={e=>setSpecial(x=>({...x,purchase_qty:e.target.value}))}/></div>
     <div className="field"><label>{t('requirements.priority','Priority')}</label><ModernSelect className="select" value={special.priority} onChange={e=>setSpecial(x=>({...x,priority:e.target.value}))}><option value="">Smart / automatic</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></ModernSelect></div>
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
   <div ref={reviewRef} tabIndex={-1} style={{scrollMarginTop:100}} className="sectionhead procurement-review-heading"><div><h3>{canReview?t('requirements.review_title','Procurement Review'):t('requirements.my_items','My Procurement Items')}</h3><p>{canReview?t('requirements.review_hint','Latest submitted stock shortages appear here. Select rows, adjust order quantities only when needed, approve, then choose suppliers.'):t('requirements.my_hint','Items you add or count appear here for Admin review.')}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>
   {['to_order','delivery'].includes(stage)&&<div className="notice section">{stage==='to_order'?'Still to order':'Awaiting receipt'} <button className="btn small" onClick={()=>changeStage('all')}>Clear filter</button></div>}
   {canReview&&<div className="toolbar section"><button className={'btn '+(stage==='pending_review'?'primary':'')} onClick={()=>changeStage('pending_review')}>{t('requirements.needs_review','Needs Review')}</button><button className={'btn '+(stage==='approved'?'primary':'')} onClick={()=>changeStage('approved')}>{t('requirements.approved','Approved')}</button><button className={'btn '+(stage==='held'?'primary':'')} onClick={()=>changeStage('held')}>{t('requirements.held','Held')}</button><button className={'btn '+(stage==='all'?'primary':'')} onClick={()=>changeStage('all')}>{t('requirements.all_active','All Active')}</button></div>}
   {canReview&&<div className="toolbar section procurement-bulk-actions"><button className="btn" onClick={()=>setSelected(new Set(rows.map(r=>r.id)))}>{t('requirements.select_all_visible','Select All Visible')}</button>{selected.size>0&&<><span className="muted tiny">{selected.size} {t('requirements.selected_count','selected')}</span>{stage==='pending_review'&&<button className="btn good" disabled={busy} onClick={()=>review('approve')}>{t('requirements.approve_continue','Approve & Continue')}</button>}<button className="btn" onClick={()=>review('hold')}>{t('requirements.hold','Hold')}</button><button className="btn bad" onClick={()=>review('reject')}>{t('requirements.reject','Reject')}</button></>}</div>}
   {rows.length?<><div className="desktop-table tablewrap section"><table className="table"><thead><tr>{canReview&&<th/>}{cols.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.id} className={selected.has(r.id)?'selected':''}>{canReview&&<td><input type="checkbox" checked={selected.has(r.id)} onChange={e=>setSelected(v=>{const n=new Set(v);e.target.checked?n.add(r.id):n.delete(r.id);return n})}/></td>}{cols.map(c=><td key={c.key}>{c.render?c.render(r):String(r[c.key]??'—')}</td>)}</tr>)}</tbody></table></div>
    <div className="proc-review-mobile-list">{rows.map(r=>{const current=r.current_stock??r.request_stock_snapshot??0,reorder=r.reorder_level??r.request_reorder_snapshot??0,max=r.max_stock??r.request_max_stock_snapshot??0;return <div className={'proc-review-row '+(selected.has(r.id)?'selected-card':'')} key={r.id}><label className="proc-review-check"><input type="checkbox" checked={selected.has(r.id)} onChange={e=>setSelected(v=>{const n=new Set(v);e.target.checked?n.add(r.id):n.delete(r.id);return n})}/></label><div className="proc-review-main"><strong><button className="item-link" onClick={()=>setActivity(r)}>{itemTitle(r)}</button></strong><small>Stock {qty(current)} · Reorder {qty(reorder)} · Max {qty(max)}{r.uom?' · '+r.uom:''}</small><small>{r.source_count_no?'From '+r.source_count_no+' · '+sriLankaTimestamp(r.source_submitted_at)+' · ':''}{r.request_reason?String(r.request_reason).replaceAll('_',' '):(r.urgency_reason?String(r.urgency_reason).replaceAll('_',' '):'stock shortage')}</small></div><div className="proc-review-order"><span>ORDER</span>{canReview?<input className="input" inputMode="decimal" defaultValue={r.adjusted_qty} onBlur={e=>setQty(r.id,e.target.value)}/>:<b>{qty(r.adjusted_qty)}</b>}</div><div className="proc-review-status"><Badge>{r.approval_status}</Badge>{r.priority&&<small>{String(r.priority).toUpperCase()}</small>}</div></div>})}</div></>:<Empty>{t('requirements.no_stage','No items in this stage.')}</Empty>}
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{total?page*pageSize+1:0}–{Math.min((page+1)*pageSize,total)} {t('common.of','of')} {total}</span><button className="btn" disabled={(page+1)*pageSize>=total} onClick={()=>setPage(x=>x+1)}>{t('common.next','Next')}</button></div>
  </div>

  </div>
  {guidedStep===3&&!(stage==='approved'&&selected.size>0)&&<div className="notice section" role="status">Select approved items below to choose suppliers and create the RFQ. Use Back to review shortages first.</div>}
  {canReview&&stage==='approved'&&selected.size>0&&<div ref={supplierBuilderRef} tabIndex={-1} style={{scrollMarginTop:100}} className="card pad section rfq-builder"><div className="sectionhead"><div><h3>{t('guide.step3_suppliers','Prepare request · Choose suppliers')}</h3><p>{t('requirements.choose_suppliers_hint','Select suppliers for the approved items. The app groups the RFQ automatically.')} · {selected.size}</p></div><button className="btn primary" disabled={busy} onClick={create}>{busy?t('common.loading','Loading…'):t('requirements.create_rfq_continue','Create RFQ & Continue')}</button></div>
   <button className="btn small" onClick={()=>guideTo(2)}>Edit selected items ({selected.size})</button>
   <StockSubmissionDetails requirements={rows.filter(r=>selected.has(r.id))}/>
   <div className="field"><label>{t('requirements.quote_due','Quotation due date')}</label><input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></div>
    <SupplierChecklist suppliers={suppliers} suggested={suggestedSuppliers} selected={chosen} onChange={setChosen} kind={supplierKind} onKindChange={setSupplierKind} t={t}/>
   {[...chosen].filter(id=>!suggestedSuppliers.some(s=>s.supplier_id===id)).length>0&&<div className="notice section"><b>{t('requirements.coverage_override','Supplier coverage override')}</b><p className="muted tiny">{t('requirements.coverage_override_hint','These suppliers do not match the configured coverage for the selected items. State why they should still receive the price request.')}</p><div className="stack">{[...chosen].filter(id=>!suggestedSuppliers.some(s=>s.supplier_id===id)).map(id=><div className="field" key={id}><label>{suppliers.find(s=>s.id===id)?.name||id}</label><input className="input" value={scopeOverrides[id]||''} onChange={e=>setScopeOverrides(v=>({...v,[id]:e.target.value}))} placeholder={t('requirements.override_reason','Required override reason')}/></div>)}</div></div>}
  </div>}
 </>
}

export function Suppliers({profile,fields,features=[],flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const confirmDanger=useDangerConfirmation()
 const canAdd=can('suppliers.add')
 const canEdit=can('suppliers.edit')
 const smartEnabled=features.find(x=>x.feature_key==='suppliers.smart_suggestions')?.enabled!==false
 const[rows,setRows]=useState([]),[q,setQ]=useState(''),[form,setForm]=useState({supplier_code:'',name:'',contact_person:'',phone:'+94',whatsapp:'+94',email:'',address:'',payment_terms:''}),[coverageSupplier,setCoverageSupplier]=useState(null),[scopes,setScopes]=useState([]),[categories,setCategories]=useState([]),[mainGroups,setMainGroups]=useState([]),[subgroups,setSubgroups]=useState([]),[scopeType,setScopeType]=useState('category'),[scopeValue,setScopeValue]=useState(''),[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([])
 const[directoryKind,setDirectoryKind]=useState('general')
 const[reviewedSupplierConflict,setReviewedSupplierConflict]=useState(false)
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
   const r=await supabase.from('proc_items').select('id,item_code,description,size,category').eq('active',true).or(containsAny(['description','item_code','size'],term)).order('description').limit(20)
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
  await confirmDanger({title:'Remove supplier coverage',message:'Delete this coverage rule for '+coverageSupplier.name+'?',warning:'This changes which items are covered by this supplier. Check the selected rule before confirming.',confirmLabel:'Confirm remove rule',onConfirm:async()=>{
   const r=await supabase.from('proc_supplier_scopes').delete().eq('id',id)
   if(r.error)throw r.error
   flash('Supplier coverage rule removed.');await openCoverage(coverageSupplier)
  }})
 }

 async function add(){
  if(newSupplierNameConflict&&!reviewedSupplierConflict)return fail(new Error('Review the duplicate number warning before saving.'))
  if(!canAdd)return fail(new Error(t('suppliers.add_denied','You do not have permission to add suppliers.')))
  if(!form.name.trim())return fail(new Error(t('suppliers.name_required','Supplier name is required.')))
  const phone=toSriLankaSupplierPhone(form.phone)
  const whatsapp=toSriLankaSupplierPhone(form.whatsapp)
  if(form.phone.trim()&&form.phone.trim()!=='+94'&&!phone)return fail(new Error('Supplier phone must be a valid Sri Lankan number starting with +94 (e.g. +94771234567).'))
  if(form.whatsapp.trim()&&form.whatsapp.trim()!=='+94'&&!whatsapp)return fail(new Error('Supplier WhatsApp must be a valid Sri Lankan number starting with +94 (e.g. +94771234567).'))
  const code=form.supplier_code.trim()||'S'+String(Math.max(rows.length+101,101)).padStart(3,'0')
  const r=await supabase.from('proc_suppliers').insert({...form,name:form.name.trim(),supplier_code:code,phone:phone||null,whatsapp:whatsapp||phone||null})
  if(r.error)return fail(r.error)
  flash(form.name+' added.');setForm({supplier_code:'',name:'',contact_person:'',phone:'+94',whatsapp:'+94',email:'',address:'',payment_terms:''});setReviewedSupplierConflict(false);load()
 }
 const canDelete=(profile.role_key||profile.role)==='admin'&&can('admin.configure_app')
 async function deleteSupplier(s){
  if(!canDelete)return
  await confirmDanger({title:'Delete supplier',message:'Permanently delete '+s.name+'? Suppliers with linked records cannot be deleted; deactivate them instead.',confirmation:s.supplier_code,confirmLabel:'Confirm delete supplier',onConfirm:async({confirmation})=>{
   const r=await supabase.rpc('proc_admin_delete_supplier_v1',{p_supplier_id:s.id,p_confirmation:confirmation});if(r.error)throw r.error
   setCoverageSupplier(null);flash('Supplier deleted.');await load()
  }})
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
 const duplicateNumbers=useMemo(()=>duplicateContactNumbers(rows.map(r=>({...r,name:[r.name,r.contact_person].filter(Boolean).join(' · ')}))),[rows])
 const newSupplierMatches=useMemo(()=>{
  const matches=new Map()
  for(const phone of [form.phone,form.whatsapp])for(const r of matchContactPhone(rows,phone))matches.set(r.id,r)
  return [...matches.values()]
 },[rows,form.phone,form.whatsapp])
 const newSupplierLabel=[form.name,form.contact_person].filter(Boolean).join(' · ')
 const newSupplierNameConflict=Boolean(form.name.trim()&&newSupplierMatches.some(r=>contactNameKey([r.name,r.contact_person].filter(Boolean).join(' · '))!==contactNameKey(newSupplierLabel)))
 const paymentSuggestions=useMemo(()=>[...new Set(rows.map(r=>r.payment_terms).filter(Boolean))].sort(),[rows])

 const filtered=useMemo(()=>rows.filter(r=>directoryKind==='all'||(r.supplier_kind||'general')===directoryKind).filter(r=>(r.name+' '+r.supplier_code+' '+(r.phone||'')+' '+(r.contact_person||'')).toLowerCase().includes(q.toLowerCase())),[rows,q,directoryKind])
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
  <div className="card pad"><div className="sectionhead"><div><h3>{t('suppliers.directory','Supplier Directory')}</h3><p>{t('suppliers.directory_hint','Supplier details, contacts and payment terms.')}</p></div></div><ModernSelect aria-label="Supplier directory type" className="select section" value={directoryKind} onChange={e=>setDirectoryKind(e.target.value)}><option value="general">General suppliers</option><option value="company">Company suppliers</option><option value="all">All suppliers</option></ModernSelect>
  {duplicateNumbers.length>0&&<details className="notice section"><summary role="alert"><strong>⚠️ {duplicateNumbers.length} repeated phone number{duplicateNumbers.length===1?'':'s'} in supplier directory</strong> · Review contacts</summary>
   <div className="stack section">{duplicateNumbers.map(g=><div key={g.phone} className="company-directory-record"><strong>{g.differentNames?'⚠️ Different names':'Shared number / possible duplicate'} · {g.phone}</strong>{g.contacts.map(r=><span key={r.id}>{r.name}</span>)}</div>)}</div>
  </details>}
  <input className="input section" placeholder={t('suppliers.search','Search suppliers')} value={q} onChange={e=>setQ(e.target.value)}/><div className="section supplier-directory-list" aria-label="Supplier directory">
   {filtered.length===0?<Empty/>:filtered.map(s=><details className="supplier-directory-row" key={s.id}>
    <summary className="supplier-directory-summary">
     <span className="supplier-directory-identity">
      <strong className="supplier-directory-name" title={s.name}>{s.name}</strong>
      <span className="supplier-directory-subtitle">{[fieldEnabled(fields,'suppliers','supplier_code')?s.supplier_code:null,fieldEnabled(fields,'suppliers','phone')?(toSriLankaSupplierPhone(s.phone)||s.phone):null].filter(Boolean).join(' · ')||'Supplier'}{duplicateNumbers.some(g=>g.contacts.some(r=>r.id===s.id))?' · ⚠️ Number repeated':''}</span>
     </span>
     {fieldEnabled(fields,'suppliers','status')&&<span className="supplier-directory-status"><Badge>{s.active?'active':'inactive'}</Badge></span>}
     <span className="supplier-directory-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div className="supplier-directory-content">
     <dl className="supplier-directory-meta">
      {cols.filter(c=>!['name','supplier_code','status'].includes(c.key)).map(c=><div className="supplier-directory-meta-pair" key={c.key}>
       <dt>{c.label}</dt><dd>{c.render?c.render(s):String(s[c.key]??'—')}</dd>
      </div>)}
     </dl>
     {canEdit&&<div className="supplier-directory-actions">
      {fieldEnabled(fields,'suppliers','coverage')&&<button type="button" className="btn small" onClick={()=>openCoverage(s)}>{fieldLabel(fields,'suppliers','coverage',t('suppliers.coverage','Coverage'))}</button>}
      <button type="button" className="btn small" onClick={()=>toggle(s)}>{s.active?t('suppliers.deactivate','Deactivate'):t('suppliers.activate','Activate')}</button>
      {canDelete&&<DeleteRecordButton profile={profile} table="proc_suppliers" record={s} label="supplier" fail={fail} onDeleted={async()=>{setCoverageSupplier(null);flash('Supplier and reviewed linked records deleted.');await load()}}/>}
     </div>}
    </div>
   </details>)}
  </div></div>
  <div className="stack">
   {canAdd&&<div className="card pad"><div className="sectionhead"><div><h3>{t('suppliers.add_title','Add Supplier')}</h3><p>{t('suppliers.add_hint','Supplier code is optional and can be generated automatically.')}</p></div></div><div className="formgrid">
    {[
     ['supplier_code','Supplier code'],['name','Supplier name'],['contact_person','Contact person'],['phone','Phone'],
     ['whatsapp','WhatsApp'],['email','Email'],['address','Address'],['payment_terms','Payment terms']
    ].filter(([k])=>!fields?.some(f=>f.module_key==='suppliers'&&f.field_key===k&&!f.enabled)).map(([k,l])=><div className="field" key={k}><label>{fields?.find(f=>f.module_key==='suppliers'&&f.field_key===k)?.label||l}</label><input className="input" inputMode={k==='phone'||k==='whatsapp'?'tel':undefined} list={k==='payment_terms'?'supplier-payment-terms':undefined} value={form[k]} placeholder={k==='phone'||k==='whatsapp'?'+94 77 123 4567':undefined} onChange={e=>{const value=e.target.value;if(['name','contact_person','phone','whatsapp'].includes(k))setReviewedSupplierConflict(false);setForm(x=>{if(k==='phone'||k==='whatsapp'){const next=formatSriLankaSupplierPhoneInput(value);if(k==='phone'&&smartEnabled&&(!x.whatsapp||x.whatsapp==='+94'||x.whatsapp===x.phone))return {...x,phone:next,whatsapp:next};return {...x,[k]:next}}return {...x,[k]:value}})}}/></div>)}
   </div>
   <datalist id="supplier-payment-terms">{paymentSuggestions.map(x=><option value={x} key={x}/>)}</datalist>
   {smartEnabled&&duplicateHints.length>0&&<div className="notice section"><b>Possible existing supplier</b><div className="muted tiny">{duplicateHints.map(x=>x.name+' · '+(x.phone||x.email||x.supplier_code)).join(' | ')}</div></div>}
   {newSupplierMatches.length>0&&<div className="notice section" role="alert">
    <strong>{newSupplierNameConflict?'⚠️ Warning: phone/WhatsApp number already belongs to a different contact name.':'This phone/WhatsApp number already exists.'}</strong>
    {newSupplierMatches.map(r=><div key={r.id} className="muted tiny">{r.name}{r.contact_person?' · '+r.contact_person:''} · {r.whatsapp||r.phone}</div>)}
    {newSupplierNameConflict&&<label className="field"><input type="checkbox" checked={reviewedSupplierConflict} onChange={e=>setReviewedSupplierConflict(e.target.checked)}/> I have checked the existing number and still want to add this supplier.</label>}
   </div>}
   {smartEnabled&&paymentSuggestions.length>0&&<div className="section"><div className="muted tiny">Smart payment-term suggestions</div><div className="pillrow section">{paymentSuggestions.slice(0,6).map(x=><button type="button" className="choice-pill" key={x} onClick={()=>setForm(v=>({...v,payment_terms:x}))}>{x}</button>)}</div></div>}
   <button className="btn primary section" onClick={add} disabled={newSupplierNameConflict&&!reviewedSupplierConflict}>{t('suppliers.save','Save Supplier')}</button></div>}
   {coverageSupplier&&<div className="card pad supplier-coverage"><div className="sectionhead"><div><h3>{coverageSupplier.name} Coverage</h3><p>Rules limit which requirements this supplier is suggested for. No rules means a general supplier.</p></div><button className="btn small" onClick={()=>setCoverageSupplier(null)}>{t('common.close','Close')}</button></div>
    <div className="pillrow">{scopes.length?scopes.map(sc=><span className="choice-pill selected-choice" key={sc.id}>{scopeLabel(sc)}{canEdit&&<button className="chip-x" onClick={()=>removeScope(sc.id)}>×</button>}</span>):<span className="badge info">General supplier · all items</span>}</div>
    {canEdit&&<div className="section">
     <div className="formgrid">
      <div className="field"><label>{t('suppliers.coverage_type','Coverage type')}</label><ModernSelect className="select" value={scopeType} onChange={e=>{setScopeType(e.target.value);setScopeValue('');setItemSearch('')}}><option value="category">Category</option><option value="main_group">Main Group</option><option value="subgroup">Subgroup</option><option value="item">Specific Item</option></ModernSelect></div>
      {scopeType==='category'&&<div className="field"><label>Category</label><ModernSelect className="select" value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="">Select category…</option>{categories.map(c=><option key={c}>{c}</option>)}</ModernSelect></div>}
      {scopeType==='main_group'&&<div className="field"><label>Main Group</label><ModernSelect className="select" value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="">Select main group…</option>{mainGroups.map(x=><option key={x}>{x}</option>)}</ModernSelect></div>}
      {scopeType==='subgroup'&&<div className="field"><label>Subgroup</label><ModernSelect className="select" value={scopeValue} onChange={e=>setScopeValue(e.target.value)}><option value="">Select subgroup…</option>{subgroups.map(x=><option key={x}>{x}</option>)}</ModernSelect></div>}
      {scopeType==='item'&&<div className="field"><label>Search item</label><input className="input" value={itemSearch} onChange={e=>setItemSearch(uppercaseItemText(e.target.value))} placeholder="Type item, code or size"/></div>}
     </div>
     {scopeType!=='item'&&<button className="btn primary section" onClick={()=>addScope()}>{t('suppliers.add_coverage','Add Coverage Rule')}</button>}
     {scopeType==='item'&&itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button className="btn record-button" key={i.id} onClick={()=>addScope(i)}><div><strong>{itemTitle(i)}</strong><div className="muted tiny">{[i.item_code,i.category].filter(Boolean).join(' · ')}</div></div><span>+ Add</span></button>)}</div>}
    </div>}
   </div>}
  </div>
 </div>
}

export function Rfqs({activeView='rfq',initialFilter='',profile,fields,features=[],company,footer,flash,fail,can=()=>false,navigate=()=>{},guidedStep=4,guideRevision=0,guideTo=()=>{},isActiveView=()=>true,onRfqSelected=()=>{},language='en',t=(k,f)=>f||k}){
 const textPrompt=useTextPrompt()
 const[documentTemplate,setDocumentTemplate]=useState(()=>defaultSupplierTemplate('rfq'))
 useEffect(()=>{try{const v=JSON.parse(localStorage.getItem('gh-rfq-document:'+profile.id)||'null');if(v)setDocumentTemplate({...defaultSupplierTemplate('rfq'),...v})}catch{}},[profile.id])
 function changeDocumentTemplate(v){setDocumentTemplate(v);try{localStorage.setItem('gh-rfq-document:'+profile.id,JSON.stringify(v))}catch{}}
 const guidedTargetHandled=useRef(''),rfqListRef=useRef(null),rfqSendRef=useRef(null),rfqHeaderRef=useRef(null)
 const confirmAction=useActionConfirmation()
 const commercialEnabled=features.find(x=>x.feature_key==='quotes.commercial_terms')?.enabled!==false
 const awardReviewEnabled=features.find(x=>x.feature_key==='quotes.award_review')?.enabled!==false

 const[rfqFilter,setRfqFilter]=useState(initialFilter==='overdue'?'overdue':'all')
 const[rfqs,setRfqs]=useState([]),[rfqTotal,setRfqTotal]=useState(0),[page,setPage]=useState(0),[summaries,setSummaries]=useState({}),[suppliers,setSuppliers]=useState([])
 const[active,setActive]=useState(null),[items,setItems]=useState([]),[invite,setInvite]=useState([]),[comparison,setComparison]=useState([])
 const canEdit=can('procurement.rfq.manage')&&(!active||['draft','prepared','sent','partially_quoted','quoted'].includes(active.status))
 const opening=useRef(0),quoteLoading=useRef(0),priceEntryRef=useRef(null),comparisonRef=useRef(null),awardReviewRef=useRef(null),quoteDrafts=useRef(new Map()),loadedQuote=useRef('{}'),loadedRevision=useRef(null),[quoteNotes,setQuoteNotes]=useState('')
 const[savedQuoteLines,setSavedQuoteLines]=useState([]),[quickSupplierOpen,setQuickSupplierOpen]=useState(false),[quickSupplier,setQuickSupplier]=useState({name:'',phone:'+94'}),[creatingSupplier,setCreatingSupplier]=useState(false)
 const[loadingQuote,setLoadingQuote]=useState(false),[quoteLoadError,setQuoteLoadError]=useState(false)
 const[addSupplierIds,setAddSupplierIds]=useState([]),[supplierPickerOpen,setSupplierPickerOpen]=useState(false),[supplierSearch,setSupplierSearch]=useState(''),[addSupplierId,setAddSupplierId]=useState(''),[scopeOverride,setScopeOverride]=useState(''),[addingSupplier,setAddingSupplier]=useState(false)
 const[supplier,setSupplier]=useState(''),[quoteRef,setQuoteRef]=useState(''),[validUntil,setValidUntil]=useState(''),[prices,setPrices]=useState({}),[file,setFile]=useState(null),[quoteOcrBusy,setQuoteOcrBusy]=useState(false)
 const[freight,setFreight]=useState('0'),[minOrder,setMinOrder]=useState('0'),[busy,setBusy]=useState(false)
 const[awardOpen,setAwardOpen]=useState(false),[awardPlan,setAwardPlan]=useState([]),[sendMenuId,setSendMenuId]=useState('')
 const[browserRfqReady,setBrowserRfqReady]=useState(null),[browserRfqPreparing,setBrowserRfqPreparing]=useState('')
 const[gateway,setGateway]=useState({configured:false,connected:false,sendingEnabled:false,dispatches:[]}),[gatewayBusy,setGatewayBusy]=useState('')
 const[pairState,setPairState]=useState({status:'NOT_CONFIGURED',qr:null,code:null}),[pairPhone,setPairPhone]=useState('+94'),[pairBusy,setPairBusy]=useState(false)
 const[entryFocus,setEntryFocus]=useState(false)
 useEffect(()=>setEntryFocus(false),[guidedStep,active?.id])
 const[quoteConflict,setQuoteConflict]=useState(null)
 const[quoteDraftState,setQuoteDraftState]=useState('Saved prices loaded')
 const draftStorageKey=(rfqId,supplierId)=>'gh-quote-draft:'+profile.id+':'+rfqId+':'+supplierId
 useEffect(()=>{if(!active?.id||!supplier||loadingQuote||quoteLoadError||quoteConflict)return;setQuoteDraftState('Saving draft…');const timer=setTimeout(()=>{try{localStorage.setItem(draftStorageKey(active.id,supplier),JSON.stringify({prices,validUntil,quoteRef,freight,minOrder,quoteNotes,revision:loadedRevision.current,base:loadedQuote.current}));setQuoteDraftState('Draft saved on this device')}catch{setQuoteDraftState('Draft not saved · keep this screen open')}},250);return()=>clearTimeout(timer)},[active?.id,supplier,prices,validUntil,quoteRef,freight,minOrder,quoteNotes,loadingQuote,quoteLoadError,quoteConflict])
 useEffect(()=>{const flush=()=>{if(!loadingQuote&&!quoteLoadError&&!quoteConflict)rememberQuoteDraft()};window.addEventListener('pagehide',flush);return()=>window.removeEventListener('pagehide',flush)},[active?.id,supplier,prices,validUntil,quoteRef,freight,minOrder,quoteNotes,loadingQuote,quoteLoadError,quoteConflict])
 const[priceSearch,setPriceSearch]=useState(''),[priceFilter,setPriceFilter]=useState('requested'),[supplierScopes,setSupplierScopes]=useState([])
 const reminderHours=features.find(x=>x.feature_key==='quotes.minimum_quotes')?.config?.reminder_hours??24
 const quoteProgress=supplierQuoteProgress(items,invite,savedQuoteLines,supplierScopes,{dueDate:active?.due_date,reminderHours})
 const nextSupplier=nextQuoteSupplier(quoteProgress,supplier)
 const pageSize=100
 const visiblePriceItems=items.filter(i=>matchesRfqItem(i,priceSearch)).filter(i=>priceFilter==='requested'?supplierRequestItems(items,invite.find(x=>x.supplier_id===supplier),supplierScopes).some(x=>x.id===i.id):priceFilter==='missing'?String(prices[i.id]?.price??'').trim()==='':priceFilter==='priced'?String(prices[i.id]?.price??'').trim()!=='':true)
 const pricedItemIds=new Set(comparison.map(x=>x.rfq_item_id))
 const pricedCount=items.filter(i=>pricedItemIds.has(i.id)).length
 const unpricedCount=items.length-pricedCount
 const selectedUnpriced=items.filter(i=>i.selected_for_po!==false&&!pricedItemIds.has(i.id))
 const awardSuppliers=[...new Set(awardPlan.map(x=>x.supplier_id))]
 const awardVariations=[...new Set(awardPlan.map(x=>x.quote_line_id))].flatMap(id=>{const line=savedQuoteLines.find(x=>x.id===id);return decodeSupplierQuoteNotes(line?.notes).variants.map((v,index)=>({...v,quote_line_id:id,variant_index:index,supplier_id:line?.supplier_id,rfq_item_id:line?.rfq_item_id})).filter(v=>Number(v.quantity)>0)})
 const variationEstimate=awardVariations.reduce((sum,v)=>sum+Number(v.quantity)*Number(v.price),0)
 const awardEstimate=variationEstimate+awardPlan.reduce((sum,x)=>sum+(Number(x.qty)||0)*(Number(x.landed_unit_cost)||0),0)
 const awardProblems=awardPlan.filter(x=>!Number.isFinite(Number(x.qty))||Number(x.qty)<=0||(!x.recommended&&!String(x.override_reason||'').trim()))
 const awardUnselected=items.filter(i=>i.selected_for_po===false)


 const load=useCallback(async()=>{try{
  const[a,b]=await Promise.all([
   (rfqFilter==='overdue'?supabase.from('proc_rfqs').select('*',{count:'exact'}).lt('due_date',businessDate()).in('status',['sent','partially_quoted']):supabase.from('proc_rfqs').select('*',{count:'exact'})).order('created_at',{ascending:false}).range(page*pageSize,page*pageSize+pageSize-1),
   allRows(()=>supabase.from('proc_suppliers').select('id,supplier_code,name,whatsapp,phone').eq('active',true).order('name').order('id'))
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
 }catch(e){fail(e)}},[fail,page,rfqFilter])
 useEffect(()=>{if(activeView==='rfq')load()},[load,activeView])
 useEffect(()=>{
  if(activeView!=='rfq'||!initialFilter||initialFilter==='overdue')return
  let cancelled=false
  supabase.from('proc_rfqs').select('*').eq('id',initialFilter).single().then(r=>{if(cancelled)return;if(r.error)fail(r.error);else open(r.data)})
  return()=>{cancelled=true}
 },[activeView,initialFilter])
 useEffect(()=>{
  if(activeView!=='rfq')return
  const token=guideRevision+':'+guidedStep+':'+(active?.id||'list')
  if(guidedTargetHandled.current===token)return
  if(active&&(loadingQuote||!items.length))return
  guidedTargetHandled.current=token
  let target=!active?rfqListRef.current:guidedStep===3?(rfqSendRef.current||rfqHeaderRef.current):guidedStep===4?priceEntryRef.current:comparisonRef.current

  if(active&&guidedStep===6&&awardOpen)target=awardReviewRef.current
  else if(active&&guidedStep===6&&canEdit&&comparison.length&&items.every(i=>i.selected_for_po===false||comparison.some(c=>c.rfq_item_id===i.id))){buildAwardReview();return}
  requestAnimationFrame(()=>{window.scrollTo(0,0);if(target?.getClientRects().length)target.focus({preventScroll:true})})
 },[activeView,guidedStep,guideRevision,active?.id,items.length,loadingQuote,comparison.length])


 function rememberQuoteDraft(){
  if(!active?.id||!supplier||loadingQuote||quoteLoadError||quoteConflict)return
  const key=active.id+':'+supplier
  const draft={prices,file,validUntil,quoteRef,freight,minOrder,quoteNotes,revision:loadedRevision.current,base:loadedQuote.current}
  quoteDrafts.current.set(key,draft)
  if(!quoteLoadError&&!quoteConflict){try{const {file:localFile,...persisted}=draft;localStorage.setItem(draftStorageKey(active.id,supplier),JSON.stringify(persisted))}catch{setQuoteDraftState('Draft not saved · keep this screen open')}}
 }

 async function open(r,preferredSupplier='',preserveDraft=true){
  if(preserveDraft)rememberQuoteDraft()
  preferredSupplier=preferredSupplier||(active?.id===r.id?supplier:'')
  const request=++opening.current
  quoteLoading.current++
  setItems([]);setInvite([]);setComparison([]);setSavedQuoteLines([]);setSupplier('');setPriceSearch('');setPriceFilter('requested');setSupplierScopes([])
  setAddSupplierId('');setAddSupplierIds([]);setSupplierPickerOpen(false);setSupplierSearch('');setScopeOverride('')
  onRfqSelected(r.id)
  if((!active||active.id!==r.id)&&initialFilter!==r.id){guideTo(['prepared','draft'].includes(r.status)?3:['awarded','closed'].includes(r.status)?5:4)}
  setActive(r);setPrices({});setFile(null);setQuoteRef('');setValidUntil('');setFreight('0');setMinOrder('0');setQuoteNotes('');setAwardOpen(false);setAwardPlan([]);setSendMenuId('');setBrowserRfqReady(null);setGateway({configured:false,connected:false,sendingEnabled:false,dispatches:[]});void refreshGatewayStatus(r.id);if(profile?.role==='admin')void loadPairStatus()
  const[a,b,c,d,e,f]=await Promise.all([
   allRows(()=>supabase.from('proc_rfq_items').select('*,requirement:proc_requirements(*,item:proc_items(*))').eq('rfq_id',r.id).order('id')),
   allRows(()=>supabase.from('proc_rfq_suppliers').select('*').eq('rfq_id',r.id).order('id')),
   allRows(()=>supabase.from('proc_v_quote_comparison').select('*').eq('rfq_id',r.id).order('rfq_item_id').order('landed_unit_cost').order('supplier_id')),
   allRows(()=>supabase.from('proc_suppliers').select('id,supplier_code,name,whatsapp,phone').eq('active',true).order('name').order('id')),
   allRows(()=>supabase.from('proc_supplier_scopes').select('*').order('id')),
   allRows(()=>supabase.from('proc_quotes').select('supplier_id,lines:proc_quote_lines(id,rfq_item_id,unit_price,notes)').eq('rfq_id',r.id).order('id'))
  ])
  if(request!==opening.current)return
  if(a.error)return fail(a.error);if(b.error)return fail(b.error);if(c.error)return fail(c.error);if(d.error)return fail(d.error);if(e.error)return fail(e.error);if(f.error)return fail(f.error)
  setSavedQuoteLines((f.data||[]).flatMap(q=>(q.lines||[]).map(line=>({...line,supplier_id:q.supplier_id}))))
  setSupplierScopes(e.data||[])
  setSuppliers(d.data||[])
  setItems(a.data||[]);setInvite(b.data||[]);setComparison(c.data||[])
  const first=b.data?.some(x=>x.supplier_id===preferredSupplier)?preferredSupplier:(b.data?.[0]?.supplier_id||'');setSupplier(first)
  if(first)await loadExistingQuote(r.id,first,false)
 }

 async function createQuickSupplier(){
  if(!canEdit||!can('suppliers.add')||creatingSupplier)return
  const name=quickSupplier.name.trim(),phone=toSriLankaSupplierPhone(quickSupplier.phone)
  if(!name)return fail(new Error('Supplier name is required.'))
  if(quickSupplier.phone.trim()&&quickSupplier.phone.trim()!=='+94'&&!phone)return fail(new Error('Enter a valid supplier number starting with +94.'))
  const existing=suppliers.find(s=>s.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase()||(phone&&(s.phone===phone||s.whatsapp===phone)))
  if(existing){setAddSupplierId(existing.id);setAddSupplierIds(ids=>ids.includes(existing.id)?ids:[...ids,existing.id]);setQuickSupplierOpen(false);return flash('Existing supplier selected: '+existing.name+'. Tap Add Selected.')}
  setCreatingSupplier(true)
  try{
   const result=await supabase.from('proc_suppliers').insert({name,supplier_code:'S'+crypto.randomUUID().slice(0,8).toUpperCase(),phone:phone||null,whatsapp:phone||null,active:true}).select('id,supplier_code,name,phone,whatsapp').single()
   if(result.error)throw result.error
   setSuppliers(rows=>[...rows,result.data].sort((a,b)=>a.name.localeCompare(b.name)))
   setAddSupplierId(result.data.id);setAddSupplierIds(ids=>ids.includes(result.data.id)?ids:[...ids,result.data.id]);setQuickSupplierOpen(false);setQuickSupplier({name:'',phone:'+94'})
   flash('Supplier created and selected. Tap Add Selected to include them in this RFQ.')
  }catch(e){fail(e)}finally{setCreatingSupplier(false)}
 }
 async function moveQuoteSupplier(id){
  if(busy||loadingQuote||quoteOcrBusy)return
  setPriceSearch('');setPriceFilter('requested')
  await loadExistingQuote(active.id,id)
  requestAnimationFrame(()=>{priceEntryRef.current?.scrollIntoView({block:'start'});priceEntryRef.current?.focus({preventScroll:true})})
 }
 async function addSupplierToRfq(){
   if(!canEdit||!active||addingSupplier||busy||Boolean(gatewayBusy))return
   const selected=[...new Set(addSupplierIds)].filter(id=>suppliers.some(s=>s.id===id)&&!invite.some(x=>x.supplier_id===id))
   if(!selected.length)return fail(new Error('Select one or more suppliers to add to this RFQ.'))
   const rfqId=active.id
   setAddingSupplier(true)
   const succeeded=[],failed=[]
   try{
    // The server protects existing quotations and prevents duplicate invitations.
    for(const supplierId of selected){
     try{
      const r=await supabase.rpc('proc_add_rfq_supplier_v1',{p_rfq_id:rfqId,p_supplier_id:supplierId,p_scope_override_reason:scopeOverride.trim()||null})
      if(r.error)throw r.error
      if(!r.data?.invitation?.supplier_id)throw new Error('Missing RFQ supplier confirmation.')
      succeeded.push(r.data)
     }catch(e){failed.push({supplierId,message:e.message||String(e)})}
    }
    if(succeeded.length){
     setInvite(current=>{const known=new Set(current.map(x=>x.supplier_id));return [...current,...succeeded.map(r=>r.invitation).filter(x=>!known.has(x.supplier_id))]})
     setActive(current=>current?.id===rfqId?{...current,status:succeeded.at(-1).rfq_status}:current)
     setAddSupplierIds(ids=>ids.filter(id=>!succeeded.some(r=>r.invitation.supplier_id===id)))
     setAddSupplierId('');setAwardOpen(false);setAwardPlan([])
     await load()
    }
    if(failed.length){
     const first=failed[0]
     fail(new Error(succeeded.length+' supplier(s) added, '+failed.length+' not added. '+(suppliers.find(s=>s.id===first.supplierId)?.name||'Supplier')+': '+first.message))
    }else{
     setScopeOverride('');setQuickSupplierOpen(false);setSupplierPickerOpen(false);setSupplierSearch('')
     flash(succeeded.length+' supplier(s) added to '+active.rfq_no+'. Pending invitations are ready to send. Existing quotations remain unchanged.')
    }
   }catch(e){fail(e)}finally{setAddingSupplier(false)}
  }

  async function loadExistingQuote(rfqId,supplierId,preserveDraft=true){
  if(preserveDraft)rememberQuoteDraft()
  const request=++quoteLoading.current
  setLoadingQuote(true);setQuoteLoadError(false);setQuoteConflict(null);loadedQuote.current='{}';loadedRevision.current=null
  setSupplier(supplierId);setPrices({});setFile(null);setQuoteRef('');setValidUntil('');setFreight('0');setMinOrder('0');setQuoteNotes('')
  try{
   if(!supplierId)return
   let draft=quoteDrafts.current.get(rfqId+':'+supplierId)
   if(!draft){try{draft=JSON.parse(localStorage.getItem(draftStorageKey(rfqId,supplierId))||'null')}catch{}}
   if(draft?.file)setFile(draft.file)
   const snapshot=await supabase.rpc('proc_quote_snapshot_v1',{p_rfq_id:rfqId,p_supplier_id:supplierId})
   if(request!==quoteLoading.current)return
   if(snapshot.error)throw snapshot.error
   loadedRevision.current=snapshot.data.revision
   const q={data:snapshot.data.quote},l={data:snapshot.data.lines}
   const restoreTerms=d=>{setValidUntil(d.validUntil||'');setQuoteRef(d.quoteRef||'');setFreight(d.freight??'0');setMinOrder(d.minOrder??'0');setQuoteNotes(d.quoteNotes||'')}
   if(q.data){restoreTerms({validUntil:q.data.valid_until,quoteRef:q.data.quote_ref,freight:String(q.data.freight_total??0),minOrder:String(q.data.minimum_order_value??0),quoteNotes:q.data.notes})}
   const map={};(l.data||[]).forEach(x=>{
    const details=decodeSupplierQuoteNotes(x.notes)
    map[x.rfq_item_id]={price:String(x.unit_price),remarks:details.remarks,variants:details.variants,available_qty:x.available_qty??'',lead_days:x.lead_days??'',moq:x.moq??0,order_multiple:x.order_multiple??1,discount_percent:x.discount_percent??0,tax_percent:x.tax_percent??0}
   })
   loadedQuote.current=JSON.stringify(map)
   const sameBase=draft&&(draft.revision?draft.revision===loadedRevision.current:draft.base===loadedQuote.current)
   if(draft&&!sameBase)setQuoteConflict(draft)
   setPrices(sameBase?draft.prices:map)
   if(sameBase)restoreTerms(draft)
  }catch(e){if(request===quoteLoading.current){setQuoteLoadError(true);fail(e)}}
  finally{if(request===quoteLoading.current)setLoadingQuote(false)}
 }

 async function editComparisonPrice(row,supplierId){
  if(!canEdit||busy||loadingQuote||quoteOcrBusy)return
  const item=row.requirement?.item||{}
  setPriceSearch(item.item_code||[item.description,item.size].filter(Boolean).join(' '));setPriceFilter('all')
  if(supplierId!==supplier)await loadExistingQuote(active.id,supplierId)
  guideTo(4)
  priceEntryRef.current?.scrollIntoView({block:'start'})
  requestAnimationFrame(()=>{
   const input=[...document.querySelectorAll('[data-rfq-price-item]')].find(x=>x.dataset.rfqPriceItem===row.id&&x.getClientRects().length)
   input?.focus({preventScroll:true})
  })
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
   return {...current,[itemId]:{...row,variants:[...variants,{id:'alt-'+Date.now()+'-'+Math.random().toString(36).slice(2),size:'',price:'',order_qty:'',remarks:''}]}}
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
    <div className="field"><label>Alternative size</label><input className="input" disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} maxLength={100} placeholder="e.g. 1½ inch" value={v.size||''} onChange={e=>editSizeAlternative(itemId,v.id,{size:e.target.value})}/></div>
    <div className="field"><label>Price (Rs.)</label><input className="input stock-entry" disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} inputMode="decimal" placeholder="Price" value={v.price??''} onChange={e=>editSizeAlternative(itemId,v.id,{price:normalizePriceInput(e.target.value)})}/></div>
    <div className="field"><label>Required quantity ({items.find(i=>i.id===itemId)?.requirement?.item?.uom||'units'})</label><input aria-label="Additional size required quantity" className="input stock-entry" disabled={!canEdit||!can('procurement.requirements.manage')||loadingQuote||quoteLoadError||busy||quoteOcrBusy} inputMode="decimal" placeholder="Blank = reference only" value={v.order_qty??''} onChange={e=>editSizeAlternative(itemId,v.id,{order_qty:e.target.value})}/></div>
    {Number(v.order_qty)>0&&Number.isFinite(Number(v.price))&&String(v.price).trim()&&<div className="muted tiny">Separate order line · {v.order_qty} × {money(Number(v.price))} = {money(Number(v.order_qty)*Number(v.price))}</div>}
    <div className="field"><label>Remarks (optional)</label><input className="input" disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} maxLength={300} placeholder="Optional" value={v.remarks||''} onChange={e=>editSizeAlternative(itemId,v.id,{remarks:e.target.value})}/></div>
    {canEdit&&<button type="button" className="btn small bad" onClick={()=>removeSizeAlternative(itemId,v.id)}>Remove size</button>}
   </div>)}
   {canEdit&&<button type="button" className="btn small" onClick={()=>addSizeAlternative(itemId)}>+ Add size variation</button>}
  </div>
 }

 async function openAssociatedOrders(){
  if(busy||!active)return
  setBusy(true)
  try{
   const quotes=await allRows(()=>supabase.from('proc_quotes').select('id').eq('rfq_id',active.id).order('id'));if(quotes.error)throw quotes.error
   const ids=(quotes.data||[]).map(q=>q.id)
   const lines=ids.length?await allRows(()=>supabase.from('proc_quote_lines').select('id').in('quote_id',ids).order('id')):{data:[]};if(lines.error)throw lines.error
   const lineIds=(lines.data||[]).map(l=>l.id)
   const orders=lineIds.length?await allRows(()=>supabase.from('proc_po_lines').select('po_id').in('source_quote_line_id',lineIds).order('id')):{data:[]};if(orders.error)throw orders.error
   const poIds=[...new Set((orders.data||[]).map(l=>l.po_id).filter(Boolean))]
   if(!poIds.length)throw new Error('No purchase orders are linked to this RFQ yet.')
   navigate('po','batch:'+poIds.join(','))
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 async function saveQuote(){
  if(loadingQuote||quoteOcrBusy||busy||quoteConflict)return
  if(quoteLoadError)return fail(new Error('Reload the supplier prices before saving to protect the existing quotation.'))
  if(!canEdit)return fail(new Error(t('validation.rfq_read_only','Your role has read-only supplier-price access.')))
  if(!active||!supplier)return fail(new Error(t('validation.select_supplier','Select a supplier.')))
  const quoted=items.filter(i=>prices[i.id]?.price!==undefined&&String(prices[i.id].price).trim()!=='')
  const additional=additionalSizeLines(items,prices)
  if(!quoted.length&&!additional.length)return fail(new Error('Enter a supplier price or an additional size with its price and required quantity.'))
  if(items.some(i=>!String(prices[i.id]?.price??'').trim()&&(prices[i.id]?.variants||[]).some(v=>!String(v.order_qty??'').trim()&&String(v.size||v.price||'').trim())))return fail(new Error('Enter the main price to save reference sizes, or enter a required quantity to order the additional size.'))
  const invalid=items.some(i=>{
   const v=prices[i.id]||{},p=Number(v.price)
   return (String(v.price??'').trim()&&(!Number.isFinite(p)||p<0))||!validateSupplierQuoteVariants(v.variants||[])||String(v.remarks||'').length>500||['available_qty','lead_days'].some(k=>v[k]!==''&&v[k]!=null&&(!Number.isFinite(Number(v[k]))||Number(v[k])<0))
  })
  if(invalid)return fail(new Error('Each added size needs a size and valid price. Required quantities must be greater than zero, or left blank for reference only.'))
  if(additional.length&&!can('procurement.requirements.manage'))return fail(new Error('Your role cannot approve additional required quantities.'))
  if(additional.length&&!await confirmAction('Add '+additional.length+' size line(s) to this RFQ and order review? '+additional.map(v=>v.size+' · '+v.qty+' × '+money(v.unit_price)+' = '+money(v.qty*v.unit_price)).join('; ')+'. These additional quantities will be approved as new requirements. Purchase orders still need final confirmation.'))return
  setBusy(true);let path=null,quoteSaved=false
  try{
   if(file){
    path='quotes/'+active.id+'/'+Date.now()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const u=await supabase.storage.from('gh-procurement').upload(path,file);if(u.error)throw u.error
   }
   const lines=quoted.map(i=>({
    rfq_item_id:i.id,unit_price:Number(prices[i.id].price),
    available_qty:prices[i.id].available_qty===''||prices[i.id].available_qty==null?null:Number(prices[i.id].available_qty),lead_days:prices[i.id].lead_days===''||prices[i.id].lead_days==null?null:Number(prices[i.id].lead_days),
    discount_percent:Number(prices[i.id].discount_percent||0),tax_percent:Number(prices[i.id].tax_percent||0),moq:Number(prices[i.id].moq||0),order_multiple:Number(prices[i.id].order_multiple||1),
    notes:encodeSupplierQuoteNotes({...prices[i.id],variants:(prices[i.id].variants||[]).filter(v=>!String(v.order_qty??'').trim())})
   }))
   const r=await supabase.rpc('proc_save_quote_guarded_v1',{
    p_rfq_id:active.id,p_supplier_id:supplier,p_expected_revision:loadedRevision.current,p_quote_ref:quoteRef||null,p_lines:lines,
    p_additional_sizes:additional,
    p_valid_until:validUntil||null,p_attachment_path:path,p_notes:quoteNotes||null,
    p_freight_total:Number(freight||0),p_minimum_order_value:Number(minOrder||0)
   })
   if(r.error)throw r.error
   quoteSaved=true
   setFile(null)
   flash(quoted.length+' supplier item price(s) saved.'+(additional.length?' '+additional.length+' additional size line(s) added to order review.':'')+(nextSupplier?' Next: '+supplierName(nextSupplier.supplier_id)+'.':' Next: compare prices.'))
   quoteDrafts.current.delete(active.id+':'+supplier)
   try{localStorage.removeItem(draftStorageKey(active.id,supplier))}catch{}
   await open({...active,status:r.data.status},nextSupplier?.supplier_id||supplier,false);void load()
   if(isActiveView('rfq')){setPriceFilter(additional.length?'all':'requested');guideTo(nextSupplier?4:5)}
  }catch(e){if(path&&!quoteSaved)await supabase.storage.from('gh-procurement').remove([path]);if(['PT409','40001'].includes(e.code)){rememberQuoteDraft();await loadExistingQuote(active.id,supplier,false)}fail(e)}finally{setBusy(false)}
 }

 async function togglePoItem(i,on){
  if(!canEdit||busy)return
  setBusy(true)
  try{
   const r=await supabase.from('proc_rfq_items').update({selected_for_po:on}).eq('id',i.id)
   if(r.error)throw r.error
   setItems(v=>v.map(x=>x.id===i.id?{...x,selected_for_po:on}:x));setAwardOpen(false);setAwardPlan([])
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 async function selectOnlyPricedItems(includeExcluded=true){
  if(!canEdit||!active||!pricedCount)return
  const next=pricedReviewSelection(items,comparison,includeExcluded!==false)
  const count=next.filter(i=>i.selected_for_po).length
  if(!count)return fail(new Error('Select at least one priced item to review. Your excluded items remain unticked.'))
  if(!await confirmAction('Review '+count+' priced item(s) and leave unpriced items outstanding? '+(includeExcluded===false?'Your unticked items remain excluded. ':'')+'This changes only the current RFQ order selection.'))return
  setBusy(true)
  try{
   const ids=items.filter((i,index)=>!next[index].selected_for_po&&i.selected_for_po!==false).map(i=>i.id)
   const enable=items.filter((i,index)=>next[index].selected_for_po&&i.selected_for_po===false).map(i=>i.id)
   if(ids.length){const x=await supabase.from('proc_rfq_items').update({selected_for_po:false}).in('id',ids).eq('rfq_id',active.id);if(x.error)throw x.error}
   if(enable.length){const x=await supabase.from('proc_rfq_items').update({selected_for_po:true}).in('id',enable).eq('rfq_id',active.id);if(x.error)throw x.error}
   setItems(next)
   flash('Only items with received supplier prices are selected. Review the selections before creating orders.')
   return next
  }catch(e){fail(e);await open(active)}finally{setBusy(false)}
 }

 function roundForMultiple(n,multiple){
  const m=Math.max(Number(multiple||1),0.001)
  return Math.ceil((Number(n||0)-1e-9)/m)*m
 }
 function buildAwardReview(selectedItems=null){
  if(!canEdit||!active)return
  const selected=(Array.isArray(selectedItems)?selectedItems:items).filter(i=>i.selected_for_po!==false)
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
  if(guidedStep!==6)guideTo(6)
  requestAnimationFrame(()=>awardReviewRef.current?.scrollIntoView({block:'start',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}))
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
  if(!await confirmAction('Prepare a NEW follow-up RFQ for '+pending.length+' outstanding item(s), using '+supplierIds.length+' existing supplier(s)? This does not resend WhatsApp messages or create purchase orders.'))return
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
  if(!await confirmAction('FINAL PURCHASE ORDER CONFIRMATION\\n\\n'+awardPlan.length+' allocation(s) for '+awardSuppliers.length+' supplier(s).\\n'+supplierLines+'\\nAdditional size lines: '+awardVariations.length+'\\nEstimated landed goods value: '+money(awardEstimate)+'\\n\\n'+(remaining?remaining+' unselected item(s) will NOT be ordered. The current RFQ will be marked awarded; create a new RFQ later for outstanding requirements.\\n\\n':'')+'Proceed to create purchase orders?'))return
  setBusy(true)
  try{
   const p=await supabase.rpc('proc_finalize_award_with_variations_v1',{p_rfq_id:active.id,p_variations:awardVariations.map(v=>({quote_line_id:v.quote_line_id,variant_index:v.variant_index})),p_allocations:awardPlan.map(x=>({
    rfq_item_id:x.rfq_item_id,quote_line_id:x.quote_line_id,qty:Number(x.qty),override_reason:x.override_reason||null
   }))})
   if(p.error)throw p.error
   const made=Array.isArray(p.data)?p.data:[]
   flash(made.length+' reviewed purchase order'+(made.length===1?'':'s')+' created. Opening Orders.')
   setActive(null);setItems([]);setComparison([]);setAwardPlan([]);setAwardOpen(false);load();navigate('po',made.length?'batch:'+made.map(x=>x.po_id).join(','):'')
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 function downloadRequest(inv){
  if(!active)return
  try{exportSupplierPriceRequestPdf({...supplierRequestArgs(inv),footer})}catch(e){fail(e)}
 }
 function supplierRequestArgs(inv){
  const supplierRow=suppliers.find(x=>x.id===inv.supplier_id)
  const requested=supplierRequestItems(items,inv,supplierScopes)
  if(!requested.length)throw new Error('No items match this supplier. Choose and save request items before sending.')
  return {rfq:active,items:documentLines(requested,documentTemplate),supplier:supplierRow,company:documentCompany(company,documentTemplate)}
 }
 function sendRequest(inv){
  if(!active)return
  const s=suppliers.find(x=>x.id===inv.supplier_id)
  if(!s)return
  let msg
  try{msg=buildSupplierQuoteReplyText(supplierRequestArgs(inv))}catch(e){return fail(e)}
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
  if(action==='code'&&!await confirmAction('Request a WhatsApp linking code for '+pairPhone+'? Only pair a dedicated number you control. Unofficial WhatsApp clients can risk account restriction.'))return
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
 async function sendBulkRecipient(inv,caption){
  if(!active||!canEdit)throw Object.assign(new Error('Your account cannot send this RFQ.'),{haltBatch:true})
  const {data:{session}}=await supabase.auth.getSession()
  if(!session?.access_token)throw Object.assign(new Error('Session expired. Sign in before continuing.'),{haltBatch:true})
  const png=await createSupplierPriceRequestPng(supplierRequestArgs(inv))
  if(png.blob.size>4_500_000)throw new Error('This supplier image is too large. Use the individual download option.')
  const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(new Error('Could not prepare this supplier image.'));reader.readAsDataURL(png.blob)})
  let response,data
  try{
   response=await fetch('/api/integrations/whatsapp/rfq',{method:'POST',headers:{Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},body:JSON.stringify({rfqId:active.id,supplierId:inv.supplier_id,pngBase64:base64,caption}),signal:AbortSignal.timeout(45000)})
   data=await response.json()
  }catch{throw Object.assign(new Error('Sending response was interrupted. Check WhatsApp before resending.'),{sendStatus:'unknown',haltBatch:true})}
  if(!response.ok)throw Object.assign(new Error(data?.error||'This supplier request could not be sent.'),{sendStatus:response.status===409?'blocked':response.status>=500?'unknown':'failed',haltBatch:[401,403,429,503].includes(response.status)})
  return data
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
  const edited=await textPrompt('WhatsApp caption for '+s.name,documentCaption(documentTemplate.caption,{rfq:active,supplier:s,company:documentCompany(company,documentTemplate)}))
  if(edited===null)return
  const caption=edited.trim()
  if(!caption||caption.length>2000)return fail(new Error('Caption must be 1–2000 characters.'))
  if(!await confirmAction('Send the PNG with this caption to '+s.name+' (+'+number+')?\\n\\n'+caption))return
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
  let msg
  try{msg=buildSupplierQuoteReplyText(supplierRequestArgs(inv))}catch(e){return fail(e)}
  navigator.clipboard.writeText(msg).then(()=>flash('Supplier reply template copied.')).catch(fail)
 }
 async function confirmSent(inv){
  if(!canEdit||!active)return
  if(!await confirmAction('Confirm that this RFQ was actually sent to '+supplierName(inv.supplier_id)+'?'))return
  const r=await supabase.rpc('proc_mark_rfq_supplier_sent_v1',{p_rfq_id:active.id,p_supplier_id:inv.supplier_id})
  if(r.error)return fail(r.error)
  flash('Supplier request marked Sent.');await open({...active,status:'sent'});load();if(invite.filter(x=>x.id!==inv.id).every(x=>!['pending','prepared'].includes(x.status)))guideTo(4)
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
 const overdue=r=>r.due_date&&r.due_date<businessDate()&&['sent','partially_quoted'].includes(r.status)

 return <>

  <div ref={rfqListRef} tabIndex={-1} style={{scrollMarginTop:100}} className={'split rfq-split focused-rfq '+(active?'has-active':'')}>
  <div className="card pad"><div className="sectionhead"><div><h3>{t('buying.rfq_title','RFQs & Quotes')} <InfoButton topic="quotation_comparison" language={language}/></h3><p>{t('buying.rfq_hint',"Send the RFQ, enter each supplier price, availability and delivery time, then review the award before ordering.")}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>
   {rfqFilter==='overdue'&&<div className="notice section">Overdue supplier requests <button className="btn small" onClick={()=>{setRfqFilter('all');setPage(0)}}>Clear filter</button></div>}
   <div className="stack">{rfqs.map(r=>{const s=summaries[r.id]||{total:0,quoted:0,waiting:0};return <button className={'btn record-button '+(active?.id===r.id?'active-record':'')} key={r.id} disabled={Boolean(gatewayBusy)||addingSupplier||busy||loadingQuote||quoteOcrBusy} onClick={()=>open(r)}><div><strong>{r.rfq_no}</strong><div className="muted tiny">{s.quoted}/{s.total} prices received · {s.waiting} waiting · due {r.due_date||'—'}</div></div><div className="right">{overdue(r)&&<Badge>overdue</Badge>}<Badge>{r.status}</Badge></div></button>})}</div>
   <div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>Previous</button><span className="muted tiny">{rfqTotal?page*pageSize+1:0}–{Math.min((page+1)*pageSize,rfqTotal)} of {rfqTotal}</span><button className="btn" disabled={(page+1)*pageSize>=rfqTotal} onClick={()=>setPage(x=>x+1)}>Next</button></div>
  </div>

  <div className={'card pad rfq-task-screen '+(entryFocus&&guidedStep===4?'entry-focus':'')}>{!active?<Empty>Select a supplier price request.</Empty>:<>
   <div className="toolbar"><button className="btn small" disabled={busy||loadingQuote||Boolean(gatewayBusy)} onClick={()=>{rememberQuoteDraft();setActive(null);onRfqSelected('')}}>← RFQ list</button><h3>{active.rfq_no}</h3><DeleteRecordButton profile={profile} table="proc_rfqs" record={active} label="RFQ" fail={fail} disabled={busy||loadingQuote||addingSupplier||Boolean(gatewayBusy)} onDeleted={async()=>{opening.current++;quoteLoading.current++;quoteDrafts.current.clear();setActive(null);setItems([]);setComparison([]);onRfqSelected('');flash('RFQ and reviewed linked records deleted.');await load()}}/>{canEdit&&<button type="button" className="btn small" aria-expanded={supplierPickerOpen} aria-controls="rfq-add-suppliers-panel" disabled={busy||addingSupplier||Boolean(gatewayBusy)} onClick={()=>setSupplierPickerOpen(v=>!v)}>＋ Add Suppliers</button>}{guidedStep===4&&<button className="btn small" aria-pressed={entryFocus} onClick={()=>setEntryFocus(v=>!v)}>{entryFocus?'Exit focus':'Focus entry'}</button>}<span className="muted tiny">{guidedStep===3?'Prepare request · Send RFQ':awardOpen?'Choose prices · Approve selections':guidedStep===4?'Choose prices · Enter quotes':'Choose prices · Compare'}</span></div>

   {canEdit&&supplierPickerOpen&&<section id="rfq-add-suppliers-panel" className="notice section" aria-label="Add suppliers to existing RFQ">
    <div className="sectionhead"><div><h3>Add suppliers to {active.rfq_no}</h3><p className="muted tiny">Select suppliers missed earlier. They start pending under the same RFQ; saved prices and sent records are untouched.</p></div><button type="button" className="btn small" disabled={addingSupplier} onClick={()=>setSupplierPickerOpen(false)}>Close ✕</button></div>
    <label className="field">Find supplier<input type="search" className="input" aria-label="Search available suppliers" placeholder="Name or phone…" value={supplierSearch} disabled={addingSupplier} onChange={e=>setSupplierSearch(e.target.value)}/></label>
    <div className="rfq-recipient-list section" style={{maxHeight:216,overflowY:'auto'}} role="group" aria-label="Available additional suppliers">
     {suppliers.filter(s=>!invite.some(i=>i.supplier_id===s.id)).filter(s=>[s.name,s.phone,s.whatsapp].some(v=>String(v||'').toLocaleLowerCase().includes(supplierSearch.trim().toLocaleLowerCase()))).map(s=><div key={s.id} className="rfq-recipient-row"><label><input type="checkbox" checked={addSupplierIds.includes(s.id)} disabled={addingSupplier} onChange={e=>setAddSupplierIds(ids=>e.target.checked?[...new Set([...ids,s.id])]:ids.filter(id=>id!==s.id))}/><span><strong>{s.name}</strong><small>{s.whatsapp||s.phone||'Add WhatsApp number before sending'}</small></span></label></div>)}
     {!suppliers.some(s=>!invite.some(i=>i.supplier_id===s.id)&&[s.name,s.phone,s.whatsapp].some(v=>String(v||'').toLocaleLowerCase().includes(supplierSearch.trim().toLocaleLowerCase())))&&<p className="muted tiny">No matching suppliers. Quick-create one below if needed.</p>}
    </div>
    <details className="section"><summary>Coverage override (if needed)</summary><label className="field">Reason (applies to selection)<input className="input" maxLength={500} value={scopeOverride} disabled={addingSupplier} onChange={e=>setScopeOverride(e.target.value)} placeholder="Only if supplier categories don't match"/></label></details>
    <div className="toolbar section"><button type="button" className="btn primary" disabled={addingSupplier||busy||Boolean(gatewayBusy)||addSupplierIds.length===0} onClick={addSupplierToRfq}>{addingSupplier?'Adding suppliers…':'Add Selected ('+addSupplierIds.length+')'}</button>{can('suppliers.add')&&<button type="button" className="btn small" disabled={addingSupplier||creatingSupplier} onClick={()=>setQuickSupplierOpen(v=>!v)}>＋ Quick Create Supplier</button>}<button type="button" className="btn small" disabled={addingSupplier} onClick={load}>Refresh List</button></div>
    {quickSupplierOpen&&can('suppliers.add')&&<div className="section"><div className="formgrid"><label className="field">Supplier name<input className="input" maxLength={150} value={quickSupplier.name} disabled={creatingSupplier} onChange={e=>setQuickSupplier(v=>({...v,name:e.target.value}))}/></label><label className="field">Phone / WhatsApp<input className="input" inputMode="tel" placeholder="+94771234567" value={quickSupplier.phone} disabled={creatingSupplier} onChange={e=>setQuickSupplier(v=>({...v,phone:formatSriLankaSupplierPhoneInput(e.target.value)}))}/></label></div><div className="toolbar section"><button type="button" className="btn primary" disabled={creatingSupplier} onClick={createQuickSupplier}>{creatingSupplier?'Creating…':'Create & Select Supplier'}</button><button type="button" className="btn small" disabled={creatingSupplier} onClick={()=>setQuickSupplierOpen(false)}>Cancel</button></div></div>}
   </section>}
   <OrderProgress rfq={active} items={items} invitations={invite} pricedCount={pricedCount}/>
   <StockSubmissionDetails requirements={items.map(i=>i.requirement)}/>
   <div hidden={guidedStep!==3}>
   {profile?.role==='admin'&&<details className="section"><summary><strong>WhatsApp Gateway Setup (Administrator)</strong></summary><div className="notice section"><p className="muted tiny">Unregulated third-party WhatsApp Web automation may restrict your account. Use a separate procurement number. Pairing is optional; no messages are sent merely by connecting.</p><div className="toolbar"><span>Session: <strong>{pairState.status}</strong></span><button className="btn small" disabled={pairBusy} onClick={()=>loadPairStatus()}>Refresh Pairing Status</button><button className="btn small" disabled={pairBusy||pairState.status==='WORKING'} onClick={()=>pairAction('start')}>Start Session</button></div>{pairState.status!=='WORKING'&&<div className="formgrid section"><div className="field"><label>Dedicated WhatsApp number</label><input className="input" inputMode="tel" autoComplete="off" value={pairPhone} onChange={e=>setPairPhone(e.target.value)} placeholder="+94771234567"/></div><div className="field"><label>Link with phone number</label><button className="btn" disabled={pairBusy||pairState.status==='NOT_CONFIGURED'||pairState.status==='OFFLINE'} onClick={()=>pairAction('code')}>Request Pairing Code</button></div></div>}{pairState.code&&<p><strong>WhatsApp pairing code: {pairState.code}</strong><span className="muted tiny"> · Enter it using WhatsApp → Linked Devices. Do not share this code.</span></p>}{pairState.qr&&<div className="section"><p className="muted tiny">Alternative: scan this QR using WhatsApp → Linked Devices on a separate device. Refresh if it expires.</p><img src={pairState.qr} alt="WhatsApp linked-device pairing QR" width="240" height="240" style={{maxWidth:'100%',height:'auto'}}/></div>}{pairState.status==='WORKING'&&<p className="muted tiny">WhatsApp session linked. Sending can be enabled by the owner after a private test and migration check.</p>}</div></details>}

   </div>
   <div hidden className="workflow-task-actions section" aria-label="RFQ next steps"><button className="btn small" onClick={()=>guideTo(4)}>Enter supplier quotes →</button><button className="btn small" onClick={()=>guideTo(5)}>Compare prices →</button>{canEdit&&<button className="btn small primary" disabled={busy||loadingQuote||!comparison.length} onClick={buildAwardReview}>Review & create orders →</button>}</div>
   <div hidden ref={rfqHeaderRef} tabIndex={-1} style={{scrollMarginTop:96}} className="sectionhead"><div><h3>{active.rfq_no}</h3><p>{invite.filter(x=>x.status==='quoted').length}/{invite.length} supplier responses · {pricedCount}/{items.length} items priced · {unpricedCount} awaiting prices. One valid supplier price per item is enough to create an order.</p></div><div className="toolbar"><button className="btn" type="button" onClick={()=>guideTo(5)}>View Price Comparison</button>{canEdit&&<button className="btn" onClick={extendDue}>Extend Due</button>}{canEdit&&awardReviewEnabled&&<button className="btn good" disabled={busy||!comparison.length} onClick={buildAwardReview}>Review Quoted Items ({pricedCount}) →</button>}</div></div>

   <div hidden={guidedStep!==3}>
   <section className="notice section" aria-label="Supplier quote portal"><strong>Private supplier quotation links · 6-hour window</strong><p className="muted tiny">Give each supplier their own link to enter prices, save a draft and confirm their quotation. View received responses here. Link sharing works independently of the WhatsApp gateway once portal setup is activated.</p><a className="btn small primary" href={'/supplier-links?rfq='+encodeURIComponent(active.id)}>Supplier links &amp; received prices →</a></section>
   <SupplierDocumentEditor kind="rfq" value={documentTemplate} onChange={changeDocumentTemplate} company={company} lines={items} rfq={active} disabled={busy||Boolean(gatewayBusy)}/>
   {invite.some(x=>x.status!=='quoted'&&x.status!=='declined')&&<div ref={rfqSendRef} tabIndex={-1} style={{scrollMarginTop:100}} className="notice section"><b>{invite.some(x=>['pending','prepared'].includes(x.status))?'Send prepared supplier requests':'Waiting for supplier prices'}</b>{canEdit&&<RfqBulkSend key={active.id} rfq={active} captionTemplate={documentTemplate.caption} company={documentCompany(company,documentTemplate)} invitations={invite} suppliers={suppliers} gateway={gateway} otherBusy={busy||loadingQuote||quoteOcrBusy||(Boolean(gatewayBusy)&&gatewayBusy!=='bulk')} onBusy={running=>{setGatewayBusy(running?'bulk':'');setBusy(running)}} onSend={sendBulkRecipient} onPrepare={inv=>createSupplierPriceRequestPng(supplierRequestArgs(inv))} onRefresh={()=>refreshGatewayStatus(active.id)}/>}
    <details inert={gatewayBusy==='bulk'?true:undefined} className="rfq-individual-options section"><summary>Individual sending options &amp; manual fallback</summary><div className="stack section">{invite.filter(x=>x.status!=='quoted'&&x.status!=='declined').map(x=><div className="procurement-data-row" key={x.id}><div className="toolbar"><span>{supplierName(x.supplier_id)} · {x.status}</span>{['pending','prepared'].includes(x.status)?<><button className="btn small primary" onClick={()=>setSendMenuId(v=>v===x.id?'':x.id)}>Send Request</button>{canEdit&&<button className="btn small good" onClick={()=>confirmSent(x)}>Confirm Sent</button>}</>:<button className="btn small" onClick={()=>reminder(x)}>WhatsApp Reminder</button>}{canEdit&&<button className="btn small" onClick={()=>markDeclined(x)}>Mark Declined</button>}</div>{['pending','prepared'].includes(x.status)&&sendMenuId===x.id&&<div className="section"><div className="muted tiny">Send a real attached PNG and caption through the private gateway (once configured and linked). Gateway acceptance is not proof of delivery. Check WhatsApp before confirming Sent; never retry unknown attempts blindly. The browser-only manual fallback remains available.</div><div className="toolbar section"><span className="muted tiny">WhatsApp gateway: {gateway.connected?'Connected':gateway.configured?'Not linked / offline':'Not configured'}</span><button className="btn small" onClick={()=>refreshGatewayStatus(active.id)}>Refresh Status</button></div><div className="toolbar section"><button className="btn small primary" disabled={Boolean(gatewayBusy)} onClick={()=>{const previous=gateway.dispatches?.find(d=>d.supplier_id===x.supplier_id);if(!canEdit)return fail(new Error('Your account cannot edit this RFQ. Sign in with an authorized procurement account.'));if(!gateway.connected)return fail(new Error('WhatsApp gateway is disconnected. Tap Refresh Status.'));if(!gateway.sendingEnabled)return fail(new Error('WhatsApp gateway sending is disabled. Use manual sharing or refresh after gateway setup.'));if(previous)return fail(new Error('An attempt already exists ('+previous.status+'). Check WhatsApp and dispatch history before retrying.'));sendAttachedPngViaGateway(x)}}>{gatewayBusy===x.id?'Sending PNG…':'Send Attached PNG + Caption'}</button><button className="btn small" onClick={async()=>{const current=window.localStorage.getItem('gh_rfq_whatsapp_caption_template')||'General Hardware — Supplier Price Request\\nRFQ: {rfq_number}\\nDue: {due_date}\\nPlease check the attached RFQ image and reply with your unit rates.';const next=await textPrompt('Edit WhatsApp caption template',documentTemplate.caption);if(next!==null){if(!next.trim()||next.length>2000)return fail(new Error('Template must be 1–2000 characters.'));window.localStorage.setItem('gh_rfq_whatsapp_caption_template',next);changeDocumentTemplate({...documentTemplate,caption:next});flash('WhatsApp template saved on this device.')}}}>Edit Message Template</button>{gateway.dispatches?.filter(d=>d.supplier_id===x.supplier_id).map(d=><span key={d.id} className="muted tiny">Gateway: {d.status} · {new Date(d.created_at).toLocaleString()} {d.status==='unknown'?'— check WhatsApp before any resend':''}</span>)}</div><div className="muted tiny section">Manual fallback (no gateway): Download the image, open this supplier's chat, and attach it from Downloads.</div><div className="toolbar section"><button className="btn small primary" disabled={browserRfqPreparing===x.id} onClick={()=>prepareBrowserRfq(x)}>{browserRfqPreparing===x.id?'Preparing PNG…':'1 · Download PNG for WhatsApp'}</button><button className="btn small" onClick={()=>sendRequest(x)}>WhatsApp Text Only</button><button className="btn small" onClick={()=>downloadPng(x)}>Download PNG Only</button><button className="btn small" onClick={()=>downloadRequest(x)}>{t('buying.rfq_pdf','RFQ PDF')}</button><button className="btn small" onClick={()=>copyReplyText(x)}>Copy Reply Text</button></div>{browserRfqReady?.invitationId===x.id&&<div className="section"><div className="muted tiny">PNG download started: <strong>{browserRfqReady.filename}</strong>. Option A: open WhatsApp with the RFQ text ready, send the text and then attach the PNG from Downloads. Both messages go to this supplier.</div><div className="toolbar section"><a className="btn small primary" href={browserSupplierWhatsappUrl(x,true)} target="_blank" rel="noopener noreferrer">2 · Open WhatsApp + Text · {supplierName(x.supplier_id)}</a></div><div className="muted tiny section">Option B (one image with a caption): copy the RFQ message, open the same supplier chat without prefilled text, attach the saved PNG, paste the copied message as its caption and send.</div><div className="toolbar section"><button className="btn small" onClick={()=>copyBrowserRfqCaption(x)}>Copy PNG Caption</button><a className="btn small" href={browserSupplierWhatsappUrl(x,false)} target="_blank" rel="noopener noreferrer">Open Supplier Chat for Caption</a></div></div>}</div>}</div>)}</div></details></div>}

   <div className="task-dock"><button className="btn primary" disabled={busy||loadingQuote||Boolean(gatewayBusy)} onClick={()=>guideTo(4)}>{invite.some(x=>['pending','prepared'].includes(x.status))?'Save & enter received quotes →':'Continue to supplier quotes →'}</button><span className="muted tiny">{invite.filter(x=>x.sent_at||x.status==='sent').length}/{invite.filter(x=>x.status!=='declined').length} confirmed sent · Unsent suppliers remain visible in reminders.</span></div>
   </div>
   <div hidden={guidedStep!==4||awardOpen}>
   <div className="formgrid">
    <div className="field"><label htmlFor="rfq-quote-supplier">{label('supplier','Supplier')}</label><ModernSelect id="rfq-quote-supplier" disabled={busy||quoteOcrBusy} className="select" value={supplier} onChange={e=>moveQuoteSupplier(e.target.value)}>{quoteProgress.map(x=><option key={x.supplier_id} value={x.supplier_id}>{supplierName(x.supplier_id)} · {x.label} ({x.received}/{x.total})</option>)}</ModernSelect></div>

   </div>

   {loadingQuote&&<p className="muted tiny" role="status">Loading supplier prices…</p>}
   {quoteConflict&&<div className="notice section" role="alert">Saved supplier prices changed since your device draft. Current saved prices are shown; your draft is preserved.<div className="toolbar section"><button className="btn small" onClick={()=>{setPrices(quoteConflict.prices||{});setValidUntil(quoteConflict.validUntil||'');setQuoteRef(quoteConflict.quoteRef||'');setFreight(quoteConflict.freight??'0');setMinOrder(quoteConflict.minOrder??'0');setQuoteNotes(quoteConflict.quoteNotes||'');setQuoteConflict(null)}}>Restore my draft for review</button><button className="btn small" onClick={()=>{try{localStorage.removeItem(draftStorageKey(active.id,supplier))}catch{}setQuoteConflict(null)}}>Keep current saved prices</button></div></div>}
   {quoteLoadError&&<div className="notice" role="alert">Supplier prices could not be loaded. Editing is paused to protect the existing quote. <button type="button" className="btn small" disabled={busy||loadingQuote} onClick={()=>loadExistingQuote(active.id,supplier,false)}>Reload Supplier Prices</button></div>}

   <div ref={priceEntryRef} tabIndex={-1} className="quote-searchbar section"><input id="rfq-price-search" aria-label="Search supplier price entry" className="input" placeholder="Search item or size…" value={priceSearch} onChange={e=>setPriceSearch(e.target.value)}/><details className="quote-filter"><summary aria-label="Price entry filters" title="Price entry filters">Filter</summary><label className="field">Show prices<ModernSelect aria-label="Price entry filter" className="select" value={priceFilter} onChange={e=>setPriceFilter(e.target.value)}><option value="all">All RFQ items</option><option value="requested">Requested from this supplier</option><option value="missing">Needs attention · missing price</option><option value="priced">Prices entered</option></ModernSelect></label></details></div>
   <p className="muted tiny" role="status">Supplier {Math.max(1,quoteProgress.findIndex(x=>x.supplier_id===supplier)+1)} of {quoteProgress.length} · {supplierName(supplier)} · {items.filter(i=>String(prices[i.id]?.price??'').trim()!=='').length}/{items.length} prices entered · {quoteDraftState}</p>
   <div className="work-items-window">
   <div className="desktop-table tablewrap section"><table className="table"><thead><tr><th>Order?</th><th>Item / size</th><th>Qty</th><th>Supplier price (Rs.)</th>{show('remarks')&&<th>Remarks</th>}{show('size_variations')&&<th>Optional size variations</th>}</tr></thead>
   <tbody>{visiblePriceItems.map(i=>{const v=prices[i.id]||{};return <tr key={i.id}>
    <td><input type="checkbox" checked={i.selected_for_po!==false} disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} onChange={e=>togglePoItem(i,e.target.checked)}/></td>
    <td><strong><ItemLabel item={i.requirement?.item||{}}/></strong><div className="muted tiny">{i.requirement?.item?.uom||''}</div></td>
    <td>{qty(i.requested_qty)}</td>
    <td><input className="input stock-entry" inputMode="decimal" disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} data-rfq-price-item={i.id} enterKeyHint="next" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const inputs=[...document.querySelectorAll('[data-rfq-price-item]')].filter(x=>x.getClientRects().length&&!x.disabled);inputs[inputs.indexOf(e.currentTarget)+1]?.focus()}}} placeholder="Price" value={v.price??''} onChange={e=>editPrice(i.id,{price:normalizePriceInput(e.target.value)})}/></td>
    {show('remarks')&&<td><input className="input" maxLength={500} disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} placeholder="Optional remarks" value={v.remarks||''} onChange={e=>editPrice(i.id,{remarks:e.target.value})}/></td>}
    {show('size_variations')&&<td>{sizeAlternativesEditor(i.id,v)}</td>}
   </tr>})}</tbody></table></div>

   <div className="mobile-card-list quote-bill section">
    <div className="muted tiny" style={{marginBottom:8}}>Quick price entry · tap Details only for remarks or alternative sizes</div>
    <div className="muted tiny" style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 90px 32px',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid var(--border, #334155)',fontWeight:700}}>
     <span>Item</span><span>Unit price (Rs.)</span><span style={{textAlign:'center'}} title="Include in purchase order">Order ✓</span>
    </div>
    <p className="muted tiny" style={{margin:'6px 0 8px'}}>Blue tick = include in purchase order. It does not mean a price has been received.</p>
    {visiblePriceItems.map(i=>{const v=prices[i.id]||{};return <div key={i.id} className="quote-bill-row" style={{borderBottom:'1px solid var(--border, #334155)',padding:'4px 0'}}>
     <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 90px 32px',alignItems:'center',gap:8}}>
      <div className="quote-bill-item" style={{minWidth:0}}><strong style={{fontSize:13,lineHeight:1.2,display:'block',overflowWrap:'anywhere'}}><ItemLabel item={i.requirement?.item||{}}/></strong><span className="muted tiny">{qty(i.requested_qty)} {i.requirement?.item?.uom||''}</span></div>
      <input aria-label={'Unit price for '+itemTitle(i.requirement?.item||{})} className="input stock-entry" style={{width:'100%',minWidth:0,padding:'9px 7px'}} inputMode="decimal" disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} data-rfq-price-item={i.id} enterKeyHint="next" onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();const inputs=[...document.querySelectorAll('[data-rfq-price-item]')].filter(x=>x.getClientRects().length&&!x.disabled);inputs[inputs.indexOf(e.currentTarget)+1]?.focus()}}} placeholder="Rs." value={v.price??''} onChange={e=>editPrice(i.id,{price:normalizePriceInput(e.target.value)})}/>
      <label title="Include in order" style={{display:'flex',alignItems:'center',justifyContent:'center'}}><input aria-label={'Order '+itemTitle(i.requirement?.item||{})} type="checkbox" checked={i.selected_for_po!==false} disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} onChange={e=>togglePoItem(i,e.target.checked)}/></label>
     </div>
     <details className="quote-bill-details"><summary className="muted tiny">Details {(v.remarks||(v.variants||[]).length)?'●':''}</summary>
      <div className="formgrid section">{show('available_qty')&&<label className="field">Available quantity<input className="input" inputMode="decimal" aria-label={'Available quantity for '+itemTitle(i.requirement?.item||{})} value={v.available_qty??''} placeholder="Unconfirmed" disabled={!canEdit||busy||loadingQuote} onChange={e=>editPrice(i.id,{available_qty:e.target.value})}/></label>}{show('lead_days')&&<label className="field">Delivery days<input className="input" inputMode="numeric" value={v.lead_days??''} placeholder="Unconfirmed" disabled={!canEdit||busy||loadingQuote} onChange={e=>editPrice(i.id,{lead_days:e.target.value})}/></label>}</div>
      {show('remarks')&&<div className="field" style={{marginTop:8}}><label>Remarks (optional)</label><input className="input" maxLength={500} disabled={!canEdit||loadingQuote||quoteLoadError||busy||quoteOcrBusy} placeholder="Optional remarks" value={v.remarks||''} onChange={e=>editPrice(i.id,{remarks:e.target.value})}/></div>}
      {show('size_variations')&&<div className="section"><span className="muted tiny">Alternative sizes (optional)</span>{sizeAlternativesEditor(i.id,v)}</div>}
     </details>
    </div>})}
   </div>

   </div>
   <div className="toolbar section task-dock">{canEdit&&<button className="btn primary" disabled={busy||loadingQuote||quoteLoadError||quoteOcrBusy||Boolean(quoteConflict)} onClick={saveQuote}>{busy?'Saving…':nextSupplier?'Save & Next Supplier →':'Save & Compare Prices →'}</button>}<span className="muted tiny">{pricedCount} priced · {unpricedCount} awaiting price · Saving does not create an order.</span></div>
   {comparison.length>0&&<div hidden className="section" style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
    <button className="btn good" type="button" disabled={busy} onClick={buildAwardReview}>Next: Review Quoted Items →</button>
    {selectedUnpriced.length>0&&<><button className="btn small" disabled={busy} onClick={selectOnlyPricedItems}>Select Priced Items Only ({pricedCount})</button><span className="muted tiny">{selectedUnpriced.length} unpriced item(s) are still selected. You can untick them individually or use this button before reviewing.</span></>}
   </div>}

   <button className="btn small section" disabled={busy||loadingQuote} onClick={()=>{rememberQuoteDraft();guideTo(5)}}>Compare saved prices →</button>
   <details className="section quote-tools"><summary>Quote tools · attachments, suppliers & details</summary>

    {show('attachment')&&canEdit&&<details className="field"><summary>Attach / read supplier quotation</summary><input key={supplier} disabled={busy||loadingQuote||quoteOcrBusy} className="input" type="file" accept="application/pdf,image/*" onChange={e=>setFile(e.target.files?.[0]||null)}/>{file&&<span className="muted tiny">Selected attachment: {file.name}</span>}{file&&<button type="button" className="btn small section" disabled={quoteOcrBusy} onClick={readQuoteAutomatically}>{quoteOcrBusy?'Reading quotation…':'Read Prices Automatically'}</button>}</details>}   {invite.find(x=>x.supplier_id===supplier)&&<SupplierRequestSelection key={active.id+'-'+supplier+'-'+JSON.stringify(invite.find(x=>x.supplier_id===supplier)?.requested_item_ids)} items={items} invitation={invite.find(x=>x.supplier_id===supplier)} scopes={supplierScopes} disabled={busy||!canEdit||!['pending','prepared'].includes(invite.find(x=>x.supplier_id===supplier)?.status)} onSave={async ids=>{setBusy(true);try{const r=await supabase.rpc('proc_set_rfq_supplier_items_v1',{p_rfq_id:active.id,p_supplier_id:supplier,p_item_ids:ids});if(r.error)throw r.error;setInvite(v=>v.map(x=>x.supplier_id===supplier?r.data:x));setBrowserRfqReady(null);flash('Supplier request items saved. Exports and messages now use this selection.')}catch(e){fail(e)}finally{setBusy(false)}}}/>}   <details className="section"><summary>Price entry help</summary><p className="muted tiny">Only enter the supplier's unit price. Enter a required quantity for any additional size you want to order. Saving adds it as a separate item in order review; leave quantity blank for reference only.</p></details></details>
   <details className="section"><summary>Quotation validity &amp; commercial terms</summary><div className="formgrid">{[['Quotation reference',quoteRef,setQuoteRef,'text'],['Supplier freight',freight,setFreight,'number'],['Minimum order value',minOrder,setMinOrder,'number']].map(([label,value,set,type])=><label key={label} className="field">{label}<input aria-label={label} className="input" type={type} min={type==='number'?0:undefined} step={type==='number'?'any':undefined} value={value} disabled={!canEdit||busy||loadingQuote} onChange={e=>set(e.target.value)}/></label>)}<label className="field">Quotation notes<input aria-label="Quotation notes" className="input" value={quoteNotes} maxLength={500} disabled={!canEdit||busy||loadingQuote} onChange={e=>setQuoteNotes(e.target.value)}/></label></div><label className="field">Valid until<input aria-label="Quotation valid until" className="input" type="date" value={validUntil} disabled={!canEdit||busy||loadingQuote} onChange={e=>setValidUntil(e.target.value)}/></label><p className="muted tiny">Expired prices cannot be used for new orders. Confirm current availability before ordering.</p></details>
   </div>
   <div hidden={guidedStep<5||awardOpen} ref={comparisonRef} tabIndex={-1} style={{scrollMarginTop:96}}>{guidedStep===6&&!awardOpen&&<div className="notice section" role="status">Review the priced items below, then tap Review &amp; Create Supplier Orders. Purchase orders are created only after your final confirmation.</div>}<RfqComparisonSheet onBackToEntry={()=>guideTo(4)} items={items} comparison={comparison} invitations={invite} supplierName={supplierName} canEdit={canEdit} busy={busy||loadingQuote||quoteOcrBusy} onEditPrice={editComparisonPrice} onOrderSelection={togglePoItem} onReview={async()=>{if(selectedUnpriced.length){const next=await selectOnlyPricedItems(false);if(next)buildAwardReview(next)}else buildAwardReview()}}/></div>

   <details className="section"><summary>Supplier replies & reminders · {quoteProgress.filter(x=>x.waiting).length} awaiting updates</summary><div className="notice section" aria-label="Supplier price follow-ups"><strong>Supplier prices · {quoteProgress.filter(x=>x.waiting).length} awaiting updates</strong><div className="muted tiny">Reminders stay visible until requested prices are saved or the supplier is marked declined. Follow-up is due after {reminderHours} hours or when the RFQ is overdue.</div><div className="stack section">{quoteProgress.map(x=><div key={x.id} className="procurement-data-row"><strong>{supplierName(x.supplier_id)}</strong><span className="muted tiny">{x.label} · {x.received}/{x.total} prices entered{x.waiting?' · '+x.missing+' missing':''}</span>{x.reminderDue&&<Badge>Reminder due</Badge>}<div className="toolbar">{x.status!=='declined'&&<button type="button" className="btn small" disabled={busy||loadingQuote||quoteOcrBusy} onClick={()=>{moveQuoteSupplier(x.supplier_id);guideTo(4)}}>Enter / Update Prices</button>}{x.waiting&&<button type="button" className="btn small" onClick={()=>reminder(x)}>WhatsApp Reminder</button>}</div></div>)}</div></div>
   </details>
   {['awarded','closed'].includes(active?.status)&&<div className="task-dock"><button className="btn primary" disabled={busy} onClick={openAssociatedOrders}>Continue to supplier POs →</button></div>}
   {active?.status==='awarded'&&items.some(i=>Number(i.requirement?.adjusted_qty||0)>Number(i.requirement?.ordered_qty||0))&&<div className="section" style={{padding:12,border:'1px solid var(--border, #334155)',borderRadius:12}}>
   <strong>Outstanding items need a follow-up RFQ</strong>
   <p className="muted tiny">The original RFQ and purchase orders stay unchanged. Prepare a new RFQ for outstanding requirements, then review its suppliers and quantities before sending.</p>
   <button className="btn primary" disabled={busy||!canEdit} onClick={createFollowUpRfq}>Prepare Follow-up RFQ</button>
  </div>}
  {awardOpen&&<div ref={awardReviewRef} tabIndex={-1} style={{scrollMarginTop:96}} className="award-review section"><div className="sectionhead"><div><h3>{t('guide.step6_order','Choose prices · Review & create orders')}</h3><p>Check supplier, quantity and unit price for each selected item. Open More only when you need to change an allocation. Creating orders is a separate final action.</p></div><button className="btn small" onClick={()=>{setAwardOpen(false);guideTo(5)}}>{t('common.close','Close')}</button></div>
    <div className="section" style={{padding:'10px 12px',border:'1px solid var(--border, #334155)',borderRadius:12}}>
     <strong>Order summary</strong>
     {awardVariations.length>0&&<div className="section"><strong>Additional sizes · {awardVariations.length} PO line(s)</strong>{awardVariations.map(v=><div key={v.quote_line_id+':'+v.variant_index} className="procurement-data-row"><span>{itemTitle(items.find(i=>i.id===v.rfq_item_id)?.requirement?.item||{})} · additional size {v.size}</span><strong>{qty(v.quantity)} × {money(v.price)} = {money(Number(v.quantity)*Number(v.price))}</strong><span>{supplierName(v.supplier_id)}{v.remarks?' · '+v.remarks:''}</span></div>)}</div>}
     <div className="muted tiny" style={{marginTop:4}}>{awardPlan.length} allocations · {awardSuppliers.length} supplier(s) · {awardUnselected.length} items not selected</div>
     <div style={{marginTop:6}}><strong>Estimated landed goods: {money(awardEstimate)}</strong></div>
     {awardSuppliers.map(id=>{const rows=awardPlan.filter(x=>x.supplier_id===id);return <div key={id} className="muted tiny" style={{marginTop:4}}>{rows[0]?.supplier_name||'Supplier'} · {rows.length} allocation(s) · {money(rows.reduce((v,x)=>v+(Number(x.qty)||0)*(Number(x.landed_unit_cost)||0),0))}</div>})}
     {awardProblems.length>0&&<div role="alert" style={{marginTop:8}}>Check {awardProblems.length} invalid allocation(s) before ordering.</div>}
     {awardUnselected.length>0&&<div className="muted tiny" style={{marginTop:8}}>Unselected items remain outstanding in stock requirements. This RFQ will close when orders are created; request new quotations for remaining items through a new RFQ.</div>}
     <div className="muted tiny" style={{marginTop:5}}>Estimated landed goods excludes possible supplier-level freight adjustments. Confirm final PO totals in Orders.</div>
    </div>

    <div className="section" style={{display:'grid',gap:6}}>{items.filter(i=>i.selected_for_po!==false).map(item=>{const plans=awardPlan.filter(p=>p.rfq_item_id===item.id),speed=itemNeedsSpeed(item.id);return <div key={item.id} style={{borderBottom:'1px solid var(--border, #334155)',padding:'8px 0',minWidth:0}}>
     <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,flexWrap:'wrap'}}><strong style={{fontSize:14,overflowWrap:'anywhere'}}>{itemTitle(item.requirement?.item||{})}</strong><span className="muted tiny">Outstanding {qty(Math.min(Number(item.requested_qty||0),Math.max(Number(item.requirement?.adjusted_qty||0)-Number(item.requirement?.ordered_qty||0),0)))}{speed?' · Urgent':''}</span></div>
     {plans.map(row=><div key={row.id} style={{marginTop:5}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) 76px',gap:6,alignItems:'center'}}>
       <ModernSelect aria-label={'Supplier for '+itemTitle(item.requirement?.item||{})} className="select" style={{minWidth:0,width:'100%',fontSize:13,padding:'9px 6px'}} value={row.quote_line_id} onChange={e=>changeAwardSupplier(row,e.target.value)}>{candidatesFor(item.id).map(x=><option value={x.quote_line_id} key={x.quote_line_id}>{x.supplier_name}</option>)}</ModernSelect>
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
    <div className="task-dock"><button className="btn primary" disabled={busy||!awardPlan.length||awardProblems.length>0} onClick={finalizeAward}>{busy?'Creating POs…':t('buying.create_orders','Approve & create POs →')}</button></div>
   </div>}
  </>}</div>
 </div>
 </>
}

