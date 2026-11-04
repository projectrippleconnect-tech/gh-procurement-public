'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import {supplierSetupPlan} from '@/lib/company-supplier-setup.mjs'
import {supabase} from '@/lib/supabase'
import {GroupSupplierContactEditor} from './group-supplier-contact-editor'
import {switchRouteTemplate} from '@/lib/company-route-template.mjs'
import {nearestSectionRoute,companyAutomationScope} from '@/lib/company-section-routing.mjs'

const uniq=ids=>[...new Set(ids.filter(Boolean))]
const scopeName=(id,sections)=>id==='company'?'Entire company list':sections.find(s=>s.id===id)?.name||'Group'
export function CompanyAutomationSimple({company,sections=[],can=()=>false,flash,fail,onChanged=()=>{}}){
 const [suppliers,setSuppliers]=useState([]),[routes,setRoutes]=useState([]),[links,setLinks]=useState([]),[pool,setPool]=useState([])
 const [selectedScope,setScope]=useState(null),[assigned,setAssigned]=useState([]),[recipients,setRecipients]=useState([]),[option,setOption]=useState('manual')
 const [busy,setBusy]=useState(false),[lookup,setLookup]=useState(''),[expanded,setExpanded]=useState(false),[editing,setEditing]=useState(null),[refresh,setRefresh]=useState(0)
 const [setupStep,setSetupStep]=useState(0)
 const saveLock=useRef(false)
 const [loadError,setLoadError]=useState(false)
 const [notice,setNotice]=useState(''),[loaded,setLoaded]=useState(false)
 const scope=selectedScope??companyAutomationScope(company,sections,routes,pool)
 const routeIndex=useMemo(()=>new Map(routes.map(v=>[v.section_id||'company',v])),[routes])
 const members=useMemo(()=>new Map(routes.map(r=>[r.id,links.filter(x=>x.route_id===r.id).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.supplier_id)])),[routes,links])
 const poolIndex=useMemo(()=>new Map(sections.map(s=>[s.id,pool.filter(x=>x.section_id===s.id).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.supplier_id)]).filter(([,ids])=>ids.length)),[sections,pool])
 const group=sections.find(x=>x.id===scope)
 const inherited=group?nearestSectionRoute(group,[{id:'company',parent_id:null},...sections.map(x=>({...x,parent_id:x.parent_id||'company'}))],routes.map(x=>({...x,section_id:x.section_id||'company'}))):null
 const rule=routeIndex.get(scope)||inherited?.rule
 const routeMembers=rule?members.get(rule.id)||[]:[]
 async function load(isCurrent){
  if(!company?.id)return
  const [a,b,c]=await Promise.all([
   supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name'),
   supabase.from('proc_company_section_routes').select('*').eq('company_id',company.id),
   supabase.from('proc_company_group_contacts').select('section_id,supplier_id,sort_order').eq('company_id',company.id)
  ])
  if(a.error)throw a.error
  if(b.error)throw b.error
  if(c.error)throw c.error
  // Reload new route links after route list is fetched; do not depend on stale state.
  const ids=(b.data||[]).map(x=>x.id)
  const rr=ids.length?await supabase.from('proc_company_section_route_suppliers').select('route_id,supplier_id,sort_order').in('route_id',ids):{data:[],error:null}
  if(rr.error)throw rr.error
  if(!isCurrent())return
  setLoadError(false);setSuppliers(a.data||[]);setRoutes(b.data||[]);setPool(c.data||[]);setLinks(rr.data||[]);setLoaded(true)
 }
 useEffect(()=>{let current=true;load(()=>current).catch(e=>{if(current){setLoadError(true);fail(e)}});return()=>{current=false}},[company?.id,company?.updated_at,refresh])
 useEffect(()=>{
  let ids=[]
  if(scope==='company')ids=rule?(rule.assigned_supplier_ids||routeMembers):[company.default_supplier_id].filter(Boolean)
  else {
   let node=group,seen=new Set()
   while(node&&!seen.has(node.id)){
    seen.add(node.id)
    if(poolIndex.has(node.id)){ids=poolIndex.get(node.id);break}
    node=sections.find(x=>x.id===node.parent_id)
   }
   if(!ids.length)ids=routeMembers
  }
  setAssigned(uniq([...ids,...routeMembers]))
  setRecipients(rule?routeMembers:ids)
  setOption(rule?.auto_send?(rule.route_mode==='direct'?'direct':'rfq'):'manual')
  setExpanded(false)
 },[company?.id,company?.default_supplier_id,scope,sections,routes,links,pool])
 function checkAssigned(id,checked){
  const next=checked?uniq([...assigned,id]):assigned.filter(x=>x!==id)
  setAssigned(next);setRecipients(v=>checked?(option==='direct'?(v.length?v:[id]):uniq([...v,id])):v.filter(x=>x!==id))
 }
 function switchMode(next){
  setOption(next)
  if(next==='direct')setRecipients(v=>v.length?[v[0]]:assigned.slice(0,1))
  if(next==='rfq'&&!recipients.length)setRecipients(assigned)
 }
 async function reloadSettings(){
  if(saveLock.current)return
  saveLock.current=true;setBusy(true);setNotice('')
  try{await onChanged();await load(()=>true)}catch(e){fail(e)}finally{saveLock.current=false;setBusy(false)}
 }
 async function save(){
  if(saveLock.current)return
  const plan=supplierSetupPlan({assigned,recipients,mode:option,suppliers})
  if(!plan.valid)throw new Error(plan.error)
  if(option!=='manual'&&!can(option==='rfq'?'procurement.rfq.manage':'procurement.orders.approve'))throw new Error('Document approval permission is required for automatic sending.')
  saveLock.current=true;setBusy(true);setNotice('')
  try{
   const ownRule=routeIndex.get(scope)
   const r=await supabase.rpc('proc_company_save_supplier_setup',{
    p_company_id:company.id,p_section_id:scope==='company'?null:scope,p_action:option,
    p_assigned_ids:plan.assigned,p_recipient_ids:plan.recipients,
    p_template:switchRouteTemplate(rule?.document_template||{},rule?.route_mode||'rfq',option==='direct'?'direct':'rfq'),
    p_expected_route_id:ownRule?.id||null,p_expected_updated_at:ownRule?.updated_at||null
   })
   if(r.error)throw r.error
   setNotice('Saved. '+(option==='manual'?'Stock shortages will wait for review.':option==='rfq'?'New shortages will create and send RFQ images after stock submission.':'New shortages will create, approve and send the PO image to the designated supplier after stock submission.'))
   flash('Supplier settings saved. No message has been sent by changing these settings.')
   await onChanged();await load(()=>true)
  }catch(e){fail(e)}finally{saveLock.current=false;setBusy(false)}
 }
 if(!company?.id||!can('company_lists.manage'))return null
 if(loadError)return <div role="alert">Supplier settings could not load. <button className="btn small" onClick={()=>{setLoadError(false);setLoaded(false);setRefresh(v=>v+1)}}>Reload supplier settings</button></div>
 if(!loaded)return <p className="muted tiny" role="status">Loading company supplier settings…</p>
 return <details className="card pad section company-simple-automation" aria-label="Company supplier automation">
  <summary>Company suppliers &amp; automation</summary>
  <fieldset disabled={busy} className="supplier-setup-fields"><nav className="setup-steps section" aria-label="Supplier setup steps">{['Scope','Suppliers','Action'].map((label,i)=><button key={label} className={'btn small '+(setupStep===i?'primary':'')} aria-current={setupStep===i?'step':undefined} onClick={()=>setSetupStep(i)}>{i+1}. {label}</button>)}</nav>
  <div hidden={setupStep!==0}>
  <label className="field section">Company list or category
   <select className="select" value={scope} onChange={e=>{if(!busy){setScope(e.target.value);setNotice('');setSetupStep(0)}}}>
    <option value="company">Entire company list — {company.name}</option>
    {sections.filter(x=>x.active!==false).map(x=><option key={x.id} value={x.id}>{x.parent_id?'↳ ':' '}{x.name}</option>)}
   </select>
  </label>
  <p className="muted tiny">Configured for: <strong>{scopeName(scope,sections)}</strong>{inherited?.inherited?' · currently inherits its parent settings':''}. Individual categories can override the company default.</p>
  {selectedScope===null&&scope!=='company'&&<p className="muted tiny">Opened the existing supplier settings for this company’s only active category.</p>}
  </div><div hidden={setupStep!==1}>
  <div className="section"><strong>Supplier contacts ({assigned.length})</strong>
   {scope==='company'&&company.default_supplier_id&&!assigned.includes(company.default_supplier_id)&&<div className="notice section"><p>A previously saved contact differs from this route: <strong>{suppliers.find(s=>s.id===company.default_supplier_id)?.name||'Unavailable contact'}</strong>. Sending uses the selected recipients below.</p><button className="btn small" onClick={()=>checkAssigned(company.default_supplier_id,true)}>Add saved contact to suppliers</button></div>}
   <div className="company-simple-supplier-list">{assigned.map((id,index)=>{const s=suppliers.find(x=>x.id===id);return <label key={id} className="checkline"><input type="checkbox" checked onChange={()=>checkAssigned(id,false)}/>Supplier {index+1}: {s?.name||'Unavailable'} · {s?.whatsapp||s?.phone||'No number'}</label>})}</div>
   <div className="toolbar">{assigned.map(id=><button key={id} className="btn small" onClick={()=>{setEditing(suppliers.find(s=>s.id===id));setExpanded(true)}}>Edit {suppliers.find(s=>s.id===id)?.name||'supplier'}</button>)}</div>
   <button type="button" className="btn small section" onClick={()=>setExpanded(v=>!v)}>{expanded?'Hide supplier directory':'+ Add supplier from directory'}</button>
   {expanded&&<div className="section"><input className="input" type="search" aria-label="Search company supplier contacts" value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="Name or +94 number"/>
    <div className="company-simple-directory">{suppliers.filter(s=>(s.name+' '+s.phone+' '+s.whatsapp).toLowerCase().includes(lookup.toLowerCase())).slice(0,60).map(s=><label className="checkline" key={s.id}><input type="checkbox" checked={assigned.includes(s.id)} onChange={e=>checkAssigned(s.id,e.target.checked)}/>{s.name} · {s.whatsapp||s.phone}</label>)}</div>
    <GroupSupplierContactEditor suppliers={suppliers} editingSupplier={editing} onSaved={async id=>{const r=await supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name');if(r.error)throw r.error;setSuppliers(r.data||[]);setAssigned(v=>uniq([...v,id]));setRecipients(v=>option==='direct'?(v.length?v:[id]):uniq([...v,id]));setEditing(null)}} onCancel={()=>setEditing(null)} flash={flash} fail={fail}/>
   </div>}
  </div>
  </div><div hidden={setupStep!==2}>
  <fieldset className="company-simple-options section"><legend>After stock submission</legend>
   <label className="checkline"><input type="radio" name={'company-automation-'+company.id} checked={option==='manual'} onChange={()=>switchMode('manual')}/>Manual — keep shortages for review</label>
   <label className="checkline"><input type="radio" name={'company-automation-'+company.id} checked={option==='rfq'} onChange={()=>switchMode('rfq')}/>Auto RFQ — send PNG to selected suppliers</label>
   <label className="checkline"><input type="radio" name={'company-automation-'+company.id} checked={option==='direct'} disabled={assigned.length!==1&&option!=='direct'} onChange={()=>switchMode('direct')}/>Auto direct PO — approve and send PNG to the sole supplier</label>
   {!assigned.length&&<p className="muted tiny">Add a supplier from the directory to enable automatic sending. Direct PO needs exactly one assigned supplier.</p>}
   {assigned.length>1&&<p className="muted tiny">Direct PO automation requires one assigned supplier. Use RFQ for multiple suppliers.</p>}
  </fieldset>
  <div className="workflow-next-card section" aria-label="Sending summary"><small>{scopeName(scope,sections)}</small><strong>{option==='manual'?'Manual review · no automatic sending':option==='direct'?'Automatic purchase order':'Automatic price request'}</strong><span>{option==='manual'?`${assigned.length} supplier(s) available for review`:recipients.map(id=>{const s=suppliers.find(x=>x.id===id);return (s?.name||'Unavailable')+' · '+(s?.whatsapp||s?.phone||'No number')}).join('; ')||'Select a recipient'}</span></div>
  {option!=='manual'&&<div className="section"><strong>{option==='direct'?'Designated PO supplier':'RFQ recipients'}</strong>
   <div className="company-simple-supplier-list">{assigned.map(id=>{const s=suppliers.find(x=>x.id===id);return <label className="checkline" key={id}><input type={option==='direct'?'radio':'checkbox'} name={option==='direct'?'preferred-po-'+company.id:undefined} checked={recipients.includes(id)} onChange={e=>setRecipients(v=>option==='direct'?[id]:e.target.checked?uniq([...v,id]):v.filter(x=>x!==id))}/>{s?.name||'Unavailable supplier'} · {s?.whatsapp||s?.phone||''}</label>})}</div>
  </div>}
  </div>
  <div className="setup-step-actions section"><button className="btn" disabled={setupStep===0} onClick={()=>setSetupStep(v=>v-1)}>← Back</button>{setupStep<2&&<button className="btn primary" onClick={()=>setSetupStep(v=>v+1)}>Next →</button>}<button className="btn small" disabled={busy} onClick={reloadSettings}>Reload saved settings</button></div>
  {notice&&<p className="notice" role="status">{notice}</p>}
  <button type="button" className="btn primary section" hidden={setupStep!==2} disabled={busy||!supplierSetupPlan({assigned,recipients,mode:option,suppliers}).valid} onClick={()=>save().catch(fail)}>{busy?'Saving…':'Save supplier & automation settings'}</button>
  </fieldset>
  <p className="muted tiny">Automatic sending requires an active WhatsApp connection and valid +94 supplier numbers. A failed or uncertain delivery remains recorded for review; it must not be resent blindly.</p>
 </details>
}
