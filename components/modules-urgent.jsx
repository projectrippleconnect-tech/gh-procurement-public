'use client'

import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {Badge,Empty,fieldEnabled,fieldLabel} from './ui'
import {qty,itemTitle} from '@/lib/helpers'
import {InfoButton} from './help-ui'

const reasonLabels={
 zero_stock:'Zero Stock',
 fast_mover:'FAST Mover',
 bulk_sale:'Bulk Sale / Sudden Depletion',
 customer_paid:'Customer Paid',
 customer_request:'Customer Requested',
 manual_urgent:'Manual Urgent'
}
const priorities=['urgent','high','normal','low']
const cleanName=s=>String(s||'file').replace(/[^a-zA-Z0-9._-]/g,'_')

async function uploadUrgentImage(file,prefix){
 if(!file)return null
 const path='urgent-requests/'+prefix+'/'+Date.now()+'-'+cleanName(file.name)
 const r=await supabase.storage.from('gh-procurement').upload(path,file,{upsert:false})
 if(r.error)throw r.error
 return path
}

export function UrgentActions({profile,fields,features=[],flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const canManage=can('urgent.manage')
 const canAutomation=can('procurement.requirements.manage')||can('procurement.rfq.manage')||can('procurement.orders.edit')||can('admin.audit.view')
 const[rows,setRows]=useState([]),[jobs,setJobs]=useState([]),[loading,setLoading]=useState(true),[priority,setPriority]=useState('all'),[reason,setReason]=useState('all')
 const[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([]),[selectedItem,setSelectedItem]=useState(null)
 const[urgent,setUrgent]=useState({required_qty:'',current_stock:'',reason:'manual_urgent',customer_paid:false,customer_reference:'',notes:''}),[urgentImage,setUrgentImage]=useState(null)
 const[missing,setMissing]=useState({proposed_name:'',brand:'',category:'GENERAL',main_group:'',subgroup:'',size:'',uom:'PCS',movement:'NORMAL',required_qty:'',suggested_max_stock:'',reason:'customer_request',customer_paid:false,customer_reference:'',notes:''}),[missingImage,setMissingImage]=useState(null)
 const[busy,setBusy]=useState(false)

 const load=useCallback(async()=>{setLoading(true);try{
  const r=await supabase.from('proc_v_urgent_actions').select('*').order('priority_score',{ascending:false}).order('created_at',{ascending:true}).limit(1000)
  if(r.error)throw r.error
  setRows(r.data||[])
  if(canAutomation){
   const j=await supabase.from('proc_automation_jobs').select('*').in('status',['pending','needs_action','failed']).order('updated_at',{ascending:false}).limit(200)
   if(j.error)throw j.error
   setJobs(j.data||[])
  }else setJobs([])
 }catch(e){fail(e)}finally{setLoading(false)}},[fail,canAutomation])
 useEffect(()=>{load()},[load])

 useEffect(()=>{
  const term=itemSearch.trim()
  if(term.length<2){setItemResults([]);return}
  const t=setTimeout(async()=>{try{
   const r=await supabase.rpc('proc_search_stock_items_v1',{p_query:term,p_category:null,p_main_group:null,p_movement:null,p_limit:20})
   if(r.error)throw r.error
   setItemResults(r.data||[])
  }catch(e){fail(e)}},160)
  return()=>clearTimeout(t)
 },[itemSearch,fail])

 const shown=useMemo(()=>rows.filter(r=>
  (priority==='all'||r.effective_priority===priority)
  &&(reason==='all'||r.urgency_reason===reason)
 ),[rows,priority,reason])

 async function markExisting(){
  if(!selectedItem)return fail(new Error(t('validation.urgent_existing','Select an existing item.')))
  const required=urgent.required_qty===''?null:Number(urgent.required_qty)
  const current=urgent.current_stock===''?null:Number(urgent.current_stock)
  if(required!==null&&(!Number.isFinite(required)||required<=0))return fail(new Error(t('validation.required_positive','Required quantity must be greater than zero.')))
  if(current!==null&&(!Number.isFinite(current)||current<0))return fail(new Error(t('validation.current_nonnegative','Current stock cannot be negative.')))
  setBusy(true);let path=null
  try{
   path=await uploadUrgentImage(urgentImage,'existing-'+selectedItem.item_id)
   const r=await supabase.rpc('proc_mark_item_urgent_v1',{
    p_item_id:selectedItem.item_id,p_required_qty:required,p_reason:urgent.reason,
    p_current_stock:current,p_customer_paid:urgent.customer_paid,
    p_customer_reference:urgent.customer_reference||null,p_notes:urgent.notes||null,p_image_path:path
   })
   if(r.error)throw r.error
   flash(itemTitle(selectedItem)+' added to Urgent Actions as '+String(r.data?.priority||'urgent').toUpperCase()+'.')
   setItemSearch('');setItemResults([]);setSelectedItem(null);setUrgent({required_qty:'',current_stock:'',reason:'manual_urgent',customer_paid:false,customer_reference:'',notes:''});setUrgentImage(null)
   await load()
  }catch(e){
   if(path)await supabase.storage.from('gh-procurement').remove([path])
   fail(e)
  }finally{setBusy(false)}
 }

 async function createMissing(){
  const required=Number(missing.required_qty),max=missing.suggested_max_stock===''?0:Number(missing.suggested_max_stock)
  if(!missing.proposed_name.trim())return fail(new Error(t('validation.missing_name','Enter the requested item name or description.')))
  if(!Number.isFinite(required)||required<=0)return fail(new Error(t('validation.required_positive','Required quantity must be greater than zero.')))
  if(!Number.isFinite(max)||max<0)return fail(new Error(t('validation.max_nonnegative','Suggested max stock cannot be negative.')))
  setBusy(true);let path=null
  try{
   path=await uploadUrgentImage(missingImage,'missing-'+crypto.randomUUID())
   const r=await supabase.rpc('proc_create_missing_item_request_v1',{
    p_proposed_name:missing.proposed_name.trim(),p_required_qty:required,p_movement:missing.movement,
    p_brand:missing.brand||null,p_category:missing.category||'GENERAL',p_main_group:missing.main_group||null,
    p_subgroup:missing.subgroup||null,p_size:missing.size||null,p_uom:missing.uom||'PCS',
    p_suggested_max_stock:max,p_priority:null,p_urgency_reason:missing.customer_paid?'customer_paid':missing.reason,
    p_customer_paid:missing.customer_paid,p_customer_reference:missing.customer_reference||null,
    p_image_path:path,p_notes:missing.notes||null
   })
   if(r.error)throw r.error
   flash('Missing item request '+r.data.request_no+' created as '+String(r.data.priority).toUpperCase()+' priority.')
   setMissing({proposed_name:'',brand:'',category:'GENERAL',main_group:'',subgroup:'',size:'',uom:'PCS',movement:'NORMAL',required_qty:'',suggested_max_stock:'',reason:'customer_request',customer_paid:false,customer_reference:'',notes:''});setMissingImage(null)
   await load()
  }catch(e){
   if(path)await supabase.storage.from('gh-procurement').remove([path])
   fail(e)
  }finally{setBusy(false)}
 }

 async function convert(r){
  if(!canManage)return
  if(!confirm(t('confirm.urgent_convert','Create/match this Item Master record and create its urgent procurement requirement?')))return
  setBusy(true)
  const x=await supabase.rpc('proc_convert_missing_item_request_v1',{p_request_id:r.missing_request_id})
  setBusy(false)
  if(x.error)return fail(x.error)
  flash('Item created/matched and '+x.data.requirement_no+' added to Procurement Review.')
  load()
 }
 async function approve(r){
  if(!canManage||r.action_type!=='existing_item')return
  const x=await supabase.rpc('proc_review_requirements',{p_requirement_ids:[r.action_id],p_action:'approve',p_selected:true,p_reason:null})
  if(x.error)return fail(x.error)
  flash('Urgent requirement approved for supplier pricing.');load()
 }
 async function rejectMissing(r){
  if(!canManage||r.action_type!=='missing_item')return
  const why=prompt(t('prompt.urgent_reject','Reason for rejecting this missing-item request (optional):'))||''
  const x=await supabase.from('proc_item_requests').update({status:'rejected',notes:why||null,reviewed_by:profile.id,reviewed_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',r.missing_request_id)
  if(x.error)return fail(x.error)
  flash('Missing-item request rejected.');load()
 }
 async function retryAutomation(job){
  if(!canAutomation)return
  setBusy(true)
  const r=await supabase.rpc('proc_retry_automation_job_v1',{p_job_id:job.id})
  setBusy(false)
  if(r.error)return fail(r.error)
  if(r.data?.status==='needs_action'&&r.data?.reason==='manual_send_confirmation')flash('This RFQ needs a real supplier send confirmation from Supplier Prices.')
  else if(r.data?.status==='failed')fail(new Error(r.data.error||'Automation retry failed.'))
  else flash('Automation retried: '+String(r.data?.status||'completed').replaceAll('_',' ')+'.')
  load()
 }

 async function viewImage(path){
  if(!path)return
  const r=await supabase.storage.from('gh-procurement').createSignedUrl(path,600)
  if(r.error)return fail(r.error)
  window.open(r.data.signedUrl,'_blank','noopener,noreferrer')
 }

 return <>
  <div className="sectionhead urgent-page-head"><div><h3>{t('urgent.title','Urgent Actions')} <InfoButton topic="urgent_orders" language={language}/></h3><p>{t('urgent.subtitle','Priority purchasing queue for zero stock, customer-paid needs and other time-critical requirements.')}</p></div></div>
  <div className="urgent-summary-grid">
   <div className="card metric"><div className="kicker">Urgent</div><div className="value num">{rows.filter(x=>x.effective_priority==='urgent').length}</div><div className="sub">Immediate owner/procurement action</div></div>
   <div className="card metric"><div className="kicker">High Priority</div><div className="value num">{rows.filter(x=>x.effective_priority==='high').length}</div><div className="sub">Includes FAST-moving shortages</div></div>
   <div className="card metric"><div className="kicker">Customer Paid</div><div className="value num">{rows.filter(x=>x.customer_paid).length}</div><div className="sub">Committed customer orders</div></div>
   <div className="card metric"><div className="kicker">Missing Items</div><div className="value num">{rows.filter(x=>x.action_type==='missing_item').length}</div><div className="sub">Need Item Master review/conversion</div></div>
  </div>

  <div className="split section">
   <div className="card pad">
    <div className="sectionhead"><div><h3>Existing Item · Urgent</h3><p>Use this when stock suddenly depletes, a bulk sale happens, or a customer has paid for an existing item.</p></div></div>
    {!selectedItem?<><div className="field"><label>Search Item Master</label><input className="input" value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder="Item name, code, brand or size"/></div>{itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button className="btn record-button" key={i.item_id} onClick={()=>{setSelectedItem(i);setUrgent(x=>({...x,current_stock:i.book_stock??'',reason:Number(i.book_stock??1)===0?'zero_stock':i.movement==='FAST'?'fast_mover':'manual_urgent'}));setItemResults([])}}><div><strong>{itemTitle(i)}</strong><div className="muted tiny">{[i.item_code,i.brand,i.uom].filter(Boolean).join(' · ')}</div></div><div className="right"><Badge>{i.movement}</Badge><span className="muted tiny">Book {i.book_stock??'—'}</span></div></button>)}</div>}</>:<>
     <div className="selected-item-box"><div><strong>{itemTitle(selectedItem)}</strong><div className="muted tiny">{[selectedItem.item_code,selectedItem.brand,selectedItem.uom].filter(Boolean).join(' · ')}</div></div><button className="btn small" onClick={()=>setSelectedItem(null)}>Change</button></div>
     <div className="formgrid section">
      <div className="field"><label>Physical Stock Now</label><input className="input" inputMode="decimal" value={urgent.current_stock} onChange={e=>setUrgent(x=>({...x,current_stock:e.target.value,reason:Number(e.target.value)===0?'zero_stock':x.reason}))}/></div>
      <div className="field"><label>Required Qty <span className="muted">(blank = auto replenish)</span></label><input className="input" inputMode="decimal" value={urgent.required_qty} onChange={e=>setUrgent(x=>({...x,required_qty:e.target.value}))}/></div>
      <div className="field"><label>Why urgent?</label><select className="select" value={urgent.reason} onChange={e=>setUrgent(x=>({...x,reason:e.target.value}))}>{Object.entries(reasonLabels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></div>
      <div className="field"><label>Photo (optional)</label><input className="input" type="file" accept="image/*" onChange={e=>setUrgentImage(e.target.files?.[0]||null)}/></div>
      <div className="field"><label>Customer reference (optional)</label><input className="input" value={urgent.customer_reference} onChange={e=>setUrgent(x=>({...x,customer_reference:e.target.value}))}/></div>
      <div className="field"><label>Note</label><input className="input" value={urgent.notes} onChange={e=>setUrgent(x=>({...x,notes:e.target.value}))}/></div>
     </div>
     <label className={'choice-pill '+(urgent.customer_paid?'selected-choice':'')}><input type="checkbox" checked={urgent.customer_paid} onChange={e=>setUrgent(x=>({...x,customer_paid:e.target.checked,reason:e.target.checked?'customer_paid':x.reason}))}/>Customer already paid / committed</label>
     <button className="btn primary section" disabled={busy} onClick={markExisting}>{busy?'Saving…':'Add to Urgent Actions'}</button>
    </>}
   </div>

   <div className="card pad">
    <div className="sectionhead"><div><h3>Customer Requested · Item Not in System</h3><p>Create a missing-item request with the customer quantity and optional photo. Admin/Procurement can convert it into the Item Master and procurement queue.</p></div></div>
    <div className="formgrid">
     <div className="field wide"><label>Requested Item / Description</label><input className="input" value={missing.proposed_name} onChange={e=>setMissing(x=>({...x,proposed_name:e.target.value}))} placeholder="What did the customer ask for?"/></div>
     <div className="field"><label>Required Qty</label><input className="input" inputMode="decimal" value={missing.required_qty} onChange={e=>setMissing(x=>({...x,required_qty:e.target.value}))}/></div>
     <div className="field"><label>Movement</label><select className="select" value={missing.movement} onChange={e=>setMissing(x=>({...x,movement:e.target.value}))}><option>FAST</option><option>NORMAL</option><option>SLOW</option></select></div>
     <div className="field"><label>Brand</label><input className="input" value={missing.brand} onChange={e=>setMissing(x=>({...x,brand:e.target.value}))}/></div>
     <div className="field"><label>Category</label><input className="input" value={missing.category} onChange={e=>setMissing(x=>({...x,category:e.target.value}))}/></div>
     <div className="field"><label>Main Group</label><input className="input" value={missing.main_group} onChange={e=>setMissing(x=>({...x,main_group:e.target.value}))}/></div>
     <div className="field"><label>Subgroup</label><input className="input" value={missing.subgroup} onChange={e=>setMissing(x=>({...x,subgroup:e.target.value}))}/></div>
     <div className="field"><label>Size</label><input className="input" value={missing.size} onChange={e=>setMissing(x=>({...x,size:e.target.value}))}/></div>
     <div className="field"><label>UOM</label><input className="input" value={missing.uom} onChange={e=>setMissing(x=>({...x,uom:e.target.value}))}/></div>
     <div className="field"><label>Suggested Max Stock (optional)</label><input className="input" inputMode="decimal" value={missing.suggested_max_stock} onChange={e=>setMissing(x=>({...x,suggested_max_stock:e.target.value}))}/></div>
     <div className="field"><label>Reason</label><select className="select" value={missing.reason} onChange={e=>setMissing(x=>({...x,reason:e.target.value}))}>{Object.entries(reasonLabels).filter(([k])=>k!=='zero_stock').map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></div>
     <div className="field"><label>Photo (optional)</label><input className="input" type="file" accept="image/*" capture="environment" onChange={e=>setMissingImage(e.target.files?.[0]||null)}/></div>
     <div className="field"><label>Customer reference</label><input className="input" value={missing.customer_reference} onChange={e=>setMissing(x=>({...x,customer_reference:e.target.value}))}/></div>
     <div className="field wide"><label>Note</label><input className="input" value={missing.notes} onChange={e=>setMissing(x=>({...x,notes:e.target.value}))}/></div>
    </div>
    <label className={'choice-pill section '+(missing.customer_paid?'selected-choice':'')}><input type="checkbox" checked={missing.customer_paid} onChange={e=>setMissing(x=>({...x,customer_paid:e.target.checked,reason:e.target.checked?'customer_paid':x.reason}))}/>Customer already paid / order committed</label>
    <button className="btn primary section" disabled={busy} onClick={createMissing}>{busy?'Saving…':'Create Missing Item Request'}</button>
   </div>
  </div>

  {canAutomation&&<div className="card pad section">
   <div className="sectionhead"><div><h3>Automation Exceptions</h3><p>Only tasks that could not safely continue automatically appear here.</p></div><Badge>{jobs.length} open</Badge></div>
   {jobs.length===0?<Empty>No automation exceptions.</Empty>:<div className="stack section">{jobs.map(j=><div className="mobile-data-card" key={j.id}>
    <div className="stock-card-title"><div><strong>{String(j.job_type).replaceAll('_',' ')}</strong><div className="muted tiny">{j.entity_type} · {new Date(j.updated_at).toLocaleString()}</div></div><Badge>{j.status}</Badge></div>
    {j.last_error&&<div className="notice section">{j.last_error}</div>}
    <div className="toolbar section">{['stock_continue','award_retry'].includes(j.job_type)?<button className="btn small primary" disabled={busy} onClick={()=>retryAutomation(j)}>Retry Now</button>:j.job_type==='rfq_send'?<span className="muted tiny">Action: open Supplier Prices → send the prepared RFQ → Confirm Sent.</span>:j.job_type==='rfq_reminder'?<span className="muted tiny">Action: open Supplier Prices → send a WhatsApp reminder to the waiting supplier.</span>:j.job_type==='po_send'?<span className="muted tiny">Action: open Orders → send the approved PO → Confirm Sent.</span>:j.job_type==='po_delivery_overdue'?<span className="muted tiny">Action: follow up with the supplier and update Receive Goods when delivery arrives.</span>:<span className="muted tiny">Review this exception before continuing.</span>}</div>
   </div>)}</div>}
  </div>}

  <div className="card pad section">
   <div className="sectionhead"><div><h3>Priority Queue</h3><p>Sorted by business urgency: customer-paid and zero-stock items first, then explicit urgent/high priorities and FAST-moving shortages.</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>
   <div className="toolbar section"><select className="select toolbar-select" value={priority} onChange={e=>setPriority(e.target.value)}><option value="all">All priorities</option>{priorities.map(x=><option key={x} value={x}>{x.toUpperCase()}</option>)}</select><select className="select toolbar-select" value={reason} onChange={e=>setReason(e.target.value)}><option value="all">All reasons</option>{Object.entries(reasonLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><span className="muted tiny">{shown.length} active action(s)</span></div>
   {loading?<Empty>Loading urgent actions…</Empty>:shown.length===0?<Empty>No urgent actions in this filter.</Empty>:<div className="urgent-action-list">{shown.map(r=><div className={'urgent-action-card priority-'+r.effective_priority} key={r.action_type+'-'+r.action_id}>
    <div className="urgent-card-head"><div><div className="pillrow"><Badge>{r.effective_priority}</Badge><Badge>{r.action_type==='missing_item'?'missing item':r.movement}</Badge>{r.customer_paid&&<Badge>customer paid</Badge>}</div><h3>{itemTitle(r)}</h3><div className="muted tiny">{[r.brand,r.uom,r.category,r.main_group].filter(Boolean).join(' · ')}</div></div><div className="priority-score"><span>Priority score</span><b>{r.priority_score}</b></div></div>
    <div className="urgent-card-grid"><div><span>Reason</span><b>{reasonLabels[r.urgency_reason]||r.urgency_reason||'FAST / Stock'}</b></div><div><span>Required</span><b>{qty(r.required_qty)}</b></div><div><span>Book Stock</span><b>{r.book_stock===null||r.book_stock===undefined?'—':qty(r.book_stock)}</b></div><div><span>Status</span><b>{String(r.status).replaceAll('_',' ')}</b></div>{r.customer_reference&&<div><span>Customer Ref</span><b>{r.customer_reference}</b></div>}</div>
    <div className="toolbar section">{r.image_path&&<button className="btn small" onClick={()=>viewImage(r.image_path)}>View Photo</button>}{canManage&&r.action_type==='missing_item'&&<><button className="btn good" disabled={busy} onClick={()=>convert(r)}>Create Item + Requirement</button><button className="btn bad" onClick={()=>rejectMissing(r)}>Reject</button></>}{canManage&&r.action_type==='existing_item'&&r.approval_status==='pending_review'&&<button className="btn good" onClick={()=>approve(r)}>Approve for Supplier Prices</button>}</div>
   </div>)}</div>}
  </div>
 </>
}
