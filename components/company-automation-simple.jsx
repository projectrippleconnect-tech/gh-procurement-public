'use client'
import {useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {GroupSupplierContactEditor} from './group-supplier-contact-editor'
import {nearestSectionRoute} from '@/lib/company-section-routing.mjs'

const uniq=ids=>[...new Set(ids.filter(Boolean))]
const scopeName=(id,sections)=>id==='company'?'Entire company list':sections.find(s=>s.id===id)?.name||'Group'
export function CompanyAutomationSimple({company,sections=[],can=()=>false,flash,fail}){
 const [suppliers,setSuppliers]=useState([]),[routes,setRoutes]=useState([]),[links,setLinks]=useState([]),[pool,setPool]=useState([])
 const [scope,setScope]=useState('company'),[assigned,setAssigned]=useState([]),[recipients,setRecipients]=useState([]),[option,setOption]=useState('manual')
 const [busy,setBusy]=useState(false),[lookup,setLookup]=useState(''),[expanded,setExpanded]=useState(false),[editing,setEditing]=useState(null),[refresh,setRefresh]=useState(0)
 const [notice,setNotice]=useState('')
 const routeIndex=useMemo(()=>new Map(routes.map(v=>[v.section_id||'company',v])),[routes])
 const members=useMemo(()=>new Map(routes.map(r=>[r.id,links.filter(x=>x.route_id===r.id).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.supplier_id)])),[routes,links])
 const poolIndex=useMemo(()=>new Map(sections.map(s=>[s.id,pool.filter(x=>x.section_id===s.id).sort((a,b)=>a.sort_order-b.sort_order).map(x=>x.supplier_id)]).filter(([,ids])=>ids.length)),[sections,pool])
 const group=sections.find(x=>x.id===scope)
 const inherited=group?nearestSectionRoute(group,[{id:'company',parent_id:null},...sections.map(x=>({...x,parent_id:x.parent_id||'company'}))],routes.map(x=>({...x,section_id:x.section_id||'company'}))):null
 const rule=routeIndex.get(scope)||inherited?.rule
 const routeMembers=rule?members.get(rule.id)||[]:[]
 async function load(){
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
  setSuppliers(a.data||[]);setRoutes(b.data||[]);setPool(c.data||[]);setLinks(rr.data||[])
 }
 useEffect(()=>{load().catch(fail)},[company?.id,refresh])
 useEffect(()=>{
  let ids=[]
  if(scope==='company')ids=routeMembers
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
  setRecipients(routeMembers)
  setOption(rule?.auto_send?(rule.route_mode==='direct'?'direct':'rfq'):'manual')
  setNotice('');setExpanded(false)
 },[company?.id,scope,sections,routes,links,pool])
 function checkAssigned(id,checked){
  const next=checked?uniq([...assigned,id]):assigned.filter(x=>x!==id)
  setAssigned(next);setRecipients(v=>checked?(option==='direct'?(v.length?v:[id]):uniq([...v,id])):v.filter(x=>x!==id))
 }
 function switchMode(next){
  setOption(next)
  if(next==='direct')setRecipients(v=>v.length?[v[0]]:assigned.slice(0,1))
  if(next==='rfq'&&!recipients.length)setRecipients(assigned)
 }
 async function save(){
  if(busy)return
  const ids=uniq(assigned),to=uniq(recipients.filter(id=>ids.includes(id)))
  if(!ids.length)throw new Error('Assign at least one company supplier contact.')
  if(!to.length)throw new Error('Choose at least one contact to receive the selected document.')
  if(option==='direct'&&(ids.length!==1||to.length!==1))throw new Error('Automatic direct POs are available only when this company/category has exactly one assigned supplier.')
  if((option==='direct'||option==='rfq')&&!can('procurement.'+(option==='rfq'?'rfq.manage':'orders.approve')))
   throw new Error('Administrator document approval permission is required for this automation.')
  setBusy(true);setNotice('')
  try{
   if(scope!=='company'){
    const p=await supabase.rpc('proc_company_save_group_contacts',{p_company_id:company.id,p_section_id:scope,p_supplier_ids:ids})
    if(p.error)throw p.error
   }
   const r=await supabase.rpc('proc_company_save_route_v2',{
    p_company_id:company.id,p_section_id:scope==='company'?null:scope,
    p_mode:option==='direct'?'direct':'rfq',p_auto_send:option!=='manual',p_supplier_ids:to,p_template:rule?.document_template||{}
   })
   if(r.error)throw r.error
   setNotice('Saved. '+(option==='manual'?'Stock shortages will wait for review.':option==='rfq'?'New shortages will create and send RFQ images after stock submission.':'New shortages will create, approve and send the PO image to the designated supplier after stock submission.'))
   flash('Supplier settings saved. No message has been sent by changing these settings.')
   setRefresh(v=>v+1)
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 if(!company?.id||!can('company_lists.manage'))return null
 return <details className="card pad section company-simple-automation" aria-label="Company supplier automation">
  <summary>Company suppliers &amp; automation</summary>
  <p className="muted tiny">1. Assign supplier contacts. 2. Choose automatic RFQ or direct PO. The same Stock Entry Submit action starts the configured process. Saving settings never sends old shortages.</p>
  <label className="field section">Company list or category
   <select className="select" value={scope} onChange={e=>setScope(e.target.value)}>
    <option value="company">Entire company list — {company.name}</option>
    {sections.filter(x=>x.active!==false).map(x=><option key={x.id} value={x.id}>{x.parent_id?'↳ ':' '}{x.name}</option>)}
   </select>
  </label>
  <p className="muted tiny">Configured for: <strong>{scopeName(scope,sections)}</strong>{inherited?.inherited?' · currently inherits its parent settings':''}. Individual categories can override the company default.</p>
  <div className="section"><strong>Supplier contacts ({assigned.length})</strong>
   <div className="company-simple-supplier-list">{assigned.map((id,index)=>{const s=suppliers.find(x=>x.id===id);return <label key={id} className="checkline"><input type="checkbox" checked onChange={()=>checkAssigned(id,false)}/>Supplier {index+1}: {s?.name||'Unavailable'} · {s?.whatsapp||s?.phone||'No number'}</label>})}</div>
   <button type="button" className="btn small section" onClick={()=>setExpanded(v=>!v)}>{expanded?'Hide supplier directory':'+ Add supplier from directory'}</button>
   {expanded&&<div className="section"><input className="input" type="search" aria-label="Search company supplier contacts" value={lookup} onChange={e=>setLookup(e.target.value)} placeholder="Name or +94 number"/>
    <div className="company-simple-directory">{suppliers.filter(s=>(s.name+' '+s.phone+' '+s.whatsapp).toLowerCase().includes(lookup.toLowerCase())).slice(0,60).map(s=><label className="checkline" key={s.id}><input type="checkbox" checked={assigned.includes(s.id)} onChange={e=>checkAssigned(s.id,e.target.checked)}/>{s.name} · {s.whatsapp||s.phone}</label>)}</div>
    <GroupSupplierContactEditor suppliers={suppliers} editingSupplier={editing} onSaved={async id=>{const r=await supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name');if(r.error)throw r.error;setSuppliers(r.data||[]);setAssigned(v=>uniq([...v,id]));setRecipients(v=>option==='direct'?(v.length?v:[id]):uniq([...v,id]));setEditing(null)}} onCancel={()=>setEditing(null)} flash={flash} fail={fail}/>
   </div>}
  </div>
  <fieldset className="company-simple-options section"><legend>After stock submission</legend>
   <label className="checkline"><input type="radio" name={'company-automation-'+company.id} checked={option==='manual'} onChange={()=>switchMode('manual')}/>Manual — keep shortages for review</label>
   <label className="checkline"><input type="radio" name={'company-automation-'+company.id} checked={option==='rfq'} onChange={()=>switchMode('rfq')}/>Auto RFQ — send PNG to selected suppliers</label>
   <label className="checkline"><input type="radio" name={'company-automation-'+company.id} checked={option==='direct'} disabled={assigned.length!==1&&option!=='direct'} onChange={()=>switchMode('direct')}/>Auto direct PO — approve and send PNG to the sole supplier</label>
   {assigned.length>1&&<p className="muted tiny">Direct PO automation requires one assigned supplier. Use RFQ for multiple suppliers.</p>}
  </fieldset>
  {option!=='manual'&&<div className="section"><strong>{option==='direct'?'Designated PO supplier':'RFQ recipients'}</strong>
   <div className="company-simple-supplier-list">{assigned.map(id=>{const s=suppliers.find(x=>x.id===id);return <label className="checkline" key={id}><input type={option==='direct'?'radio':'checkbox'} name={option==='direct'?'preferred-po-'+company.id:undefined} checked={recipients.includes(id)} onChange={e=>setRecipients(v=>option==='direct'?[id]:e.target.checked?uniq([...v,id]):v.filter(x=>x!==id))}/>{s?.name||'Unavailable supplier'} · {s?.whatsapp||s?.phone||''}</label>})}</div>
  </div>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  <button type="button" className="btn primary section" disabled={busy||!assigned.length||!recipients.length} onClick={()=>save().catch(fail)}>{busy?'Saving…':'Save supplier & automation settings'}</button>
  <p className="muted tiny">Automatic sending requires an active WhatsApp connection and valid +94 supplier numbers. A failed or uncertain delivery remains recorded for review; it must not be resent blindly.</p>
 </details>
}
