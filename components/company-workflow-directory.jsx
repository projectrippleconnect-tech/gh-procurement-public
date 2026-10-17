'use client'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {allRows} from '@/lib/query-pages'
import {supplierSetupPlan} from '@/lib/company-supplier-setup.mjs'
import {switchRouteTemplate} from '@/lib/company-route-template.mjs'
import {workflowRows,workflowValidation,uniqueIds} from '@/lib/company-workflow-directory.mjs'

const equalIds=(a,b)=>[...a].sort().join('|')===[...b].sort().join('|')
const selectedPhone=s=>s?.whatsapp||s?.phone||'Number missing'

// This is a configuration directory, not a sending panel. Saving a rule never dispatches a document.
export function CompanyWorkflowDirectory({companies=[],can=()=>false,active=true,flash=()=>{},fail=()=>{}}){
 const [data,setData]=useState(null),[query,setQuery]=useState(''),[drafts,setDrafts]=useState({}),[editing,setEditing]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('')
 const [refresh,setRefresh]=useState(0),[notice,setNotice]=useState('')
 const saving=useRef(false),latest=useRef(0)
 const companyIds=useMemo(()=>companies.map(c=>c.id),[companies])
 const signature=companyIds.join(',')

 const load=useCallback(async()=>{
  if(!companyIds.length){setData({sections:[],routes:[],links:[],pool:[],suppliers:[],directory:[]});return null}
  const scope=q=>q.in('company_id',companyIds)
  const [sections,routes,pool,suppliers,directory]=await Promise.all([
   allRows(()=>scope(supabase.from('proc_company_sections').select('id,company_id,parent_id,name,sort_order,active')).eq('active',true).order('id')),
   allRows(()=>scope(supabase.from('proc_company_section_routes').select('*').order('id'))),
   allRows(()=>scope(supabase.from('proc_company_group_contacts').select('company_id,section_id,supplier_id,sort_order').order('section_id'))),
   allRows(()=>supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp,active').eq('supplier_kind','company').eq('active',true).order('name')),
   allRows(()=>scope(supabase.from('proc_company_contact_directory').select('company_id,supplier_id,display_name').order('company_id')))
  ])
  for(const x of [sections,routes,pool,suppliers])if(x.error)throw x.error
  // The contact-directory table was added after section routing; older installations
  // may not yet have it. Routes still display and can be managed through saved contacts.
  if(directory.error&&!['PGRST205','42P01'].includes(directory.error.code))throw directory.error
  const routeIds=(routes.data||[]).map(r=>r.id)
  const links=[]
  for(let i=0;i<routeIds.length;i+=40){
   const ids=routeIds.slice(i,i+40)
   const result=await allRows(()=>supabase.from('proc_company_section_route_suppliers').select('route_id,supplier_id,sort_order').in('route_id',ids).order('route_id'))
   if(result.error)throw result.error
   links.push(...result.data)
  }
  const next={sections:sections.data||[],routes:routes.data||[],pool:pool.data||[],suppliers:suppliers.data||[],directory:directory.data||[],links}
  setData(next);return next
 },[signature])
 useEffect(()=>{
  if(!active)return
  let current=true;const version=++latest.current
  load().then(()=>{if(current&&version===latest.current)setError('')}).catch(e=>{if(current&&version===latest.current){setError(e.message||'Unable to read the workflow directory');fail(e)}})
  return()=>{current=false}
 },[active,load,refresh])

 const rows=useMemo(()=>data?workflowRows(companies,data.sections,data.routes,data.links,data.pool):[],[companies,data])
 const supplierMap=useMemo(()=>new Map((data?.suppliers||[]).map(s=>[s.id,s])),[data])
 const modeAndIds=row=>({mode:drafts[row.key]?.mode??row.mode,ids:drafts[row.key]?.ids??row.recipients})
 const contactsFor=row=>{
  const entries=(data?.directory||[]).filter(x=>x.company_id===row.company.id)
  const ids=uniqueIds([...entries.map(x=>x.supplier_id),...row.assigned,...row.recipients])
  return ids.map(id=>({id,supplier:supplierMap.get(id),label:entries.find(x=>x.supplier_id===id)?.display_name||supplierMap.get(id)?.name||'Unavailable contact'}))
 }
 const update=(row,patch)=>setDrafts(old=>({...old,[row.key]:{...modeAndIds(row),...old[row.key],...patch}}))
 const matches=row=>{
  const term=query.trim().toLocaleLowerCase()
  if(!term)return true
  const names=contactsFor(row).map(c=>c.label+' '+selectedPhone(c.supplier)).join(' ')
  return (row.company.name+' '+row.path+' '+names).toLocaleLowerCase().includes(term)
 }

 async function save(row){
  if(saving.current)return
  const {mode,ids}=modeAndIds(row)
  const validation=workflowValidation(mode,ids,data.suppliers)
  if(!validation.valid){setError(validation.error);return}
  if(mode==='rfq'&&!can('procurement.rfq.manage')){setError('RFQ approval permission is required.');return}
  if(mode==='direct'&&!can('procurement.orders.approve')){setError('PO approval permission is required.');return}
  const plan=supplierSetupPlan({assigned:ids,recipients:ids,mode,suppliers:data.suppliers})
  if(!plan.valid){setError(plan.error);return}
  saving.current=true;setBusy(row.key);setError('');setNotice('')
  try{
   const current=row.own
   const result=await supabase.rpc('proc_company_save_supplier_setup',{
    p_company_id:row.company.id,p_section_id:row.section_id,p_action:mode,
    p_assigned_ids:plan.assigned,p_recipient_ids:plan.recipients,
    p_template:switchRouteTemplate(row.effective?.document_template||{},row.effective?.route_mode||'rfq',mode==='direct'?'direct':'rfq'),
    p_expected_route_id:current?.id||null,p_expected_updated_at:current?.updated_at||null
   })
   if(result.error)throw result.error
   const refreshed=await load()
   const readback=workflowRows(companies,refreshed.sections,refreshed.routes,refreshed.links,refreshed.pool).find(x=>x.key===row.key)
   if(!readback||readback.mode!==mode||mode!=='manual'&&!equalIds(readback.recipients,ids)){
    throw new Error('The settings were saved, but verification did not match. Reload before changing anything else.')
   }
   setDrafts(old=>{const next={...old};delete next[row.key];return next})
   setNotice(row.company.name+' / '+row.path+' saved and verified. No WhatsApp message was sent.')
   flash('Company workflow saved and verified. No messages sent.')
  }catch(e){setError(e.message||String(e));fail(e)}finally{saving.current=false;setBusy('')}
 }

 if(!can('company_lists.manage'))return null
 const totals={rfq:rows.filter(x=>x.mode==='rfq').length,direct:rows.filter(x=>x.mode==='direct').length,manual:rows.filter(x=>x.mode==='manual').length}
 return <details className="card pad section" aria-label="Company workflow directory">
  <summary><strong>Company Workflow Directory</strong> · all categories &amp; suppliers</summary>
  <p className="muted tiny section">Review every company and nested category here. Auto RFQ and Auto PO are exclusive. A child category inherits its parent route unless you save a separate rule. Saving only configures future shortage handling; it does not send a message or create an order.</p>
  <div className="toolbar section" style={{alignItems:'center',flexWrap:'wrap',gap:8}}>
   <input className="input" type="search" value={query} aria-label="Search company workflow directory" onChange={e=>setQuery(e.target.value)} placeholder="Find company, category or contact" style={{flex:'1 1 230px',minWidth:0}}/>
   <button className="btn small" type="button" onClick={()=>{setDrafts({});setRefresh(x=>x+1)}} disabled={!!busy}>Reload saved rules</button>
  </div>
  <p className="muted tiny">{companies.length} companies · {rows.length} company/category scopes · {totals.rfq} Auto RFQ · {totals.direct} Auto PO · {totals.manual} manual or unconfigured</p>
  {error&&<p className="notice bad" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  {!data&&!error&&<p className="muted" role="status">Loading the saved suppliers and category routes…</p>}
  <div style={{maxHeight:'62vh',overflowY:'auto',overscrollBehavior:'contain',marginTop:8}}>
  {[...companies].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map((company,index)=>{
   const list=rows.filter(r=>r.company.id===company.id&&matches(r))
   if(!list.length)return null
   return <details key={company.id} defaultOpen={index===0||!!query} style={{border:'1px solid var(--line, #e2e8f0)',borderRadius:10,marginBottom:9,padding:'7px 9px'}}>
    <summary style={{cursor:'pointer',fontWeight:700}}>{company.name} <small className="muted">({list.length} scope{list.length===1?'':'s'})</small></summary>
    <div style={{marginTop:8,display:'grid',gap:8}}>
    {list.map(row=>{
     const chosen=modeAndIds(row),contacts=contactsFor(row)
     const changed=chosen.mode!==row.mode||!equalIds(chosen.ids,row.recipients)
     const validation=workflowValidation(chosen.mode,chosen.ids,data.suppliers)
     const rfqAllowed=can('procurement.rfq.manage'),poAllowed=can('procurement.orders.approve')
     return <div key={row.key} style={{padding:'9px',border:'1px solid var(--line, #e2e8f0)',borderRadius:8,background:'var(--surface, transparent)'}}>
      <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:6,alignItems:'baseline'}}>
       <strong style={{fontSize:13,overflowWrap:'anywhere',paddingLeft:row.section?Math.min(row.path.split(' / ').length,3)*7:0}}>{row.path}</strong>
       <small className="muted">{row.hasOverride?'Own setting':row.inherited?'Inherited from '+(row.source==='company'?'company':data.sections.find(s=>s.id===row.source)?.name||'parent'):'Not configured'}</small>
      </div>
      <p className="muted tiny" style={{margin:'5px 0 8px',overflowWrap:'anywhere'}}>Suppliers: {chosen.ids.length?chosen.ids.map(id=>{const c=contacts.find(x=>x.id===id);return (c?.label||'Unknown')+' ('+selectedPhone(c?.supplier)+')'}).join(' · '):'No supplier assigned'}</p>
      <div style={{display:'flex',gap:14,alignItems:'center',flexWrap:'wrap'}}>
       <label className="checkline" style={{whiteSpace:'nowrap'}}><input type="checkbox" disabled={!!busy||!rfqAllowed} checked={chosen.mode==='rfq'} onChange={e=>update(row,{mode:e.target.checked?'rfq':'manual'})}/>Auto RFQ</label>
       <label className="checkline" style={{whiteSpace:'nowrap'}}><input type="checkbox" disabled={!!busy||!poAllowed||chosen.ids.length!==1} checked={chosen.mode==='direct'} onChange={e=>update(row,{mode:e.target.checked?'direct':'manual'})}/>Auto PO</label>
       <button type="button" className="btn small" onClick={()=>setEditing(x=>x===row.key?'':row.key)}>{editing===row.key?'Close contacts':'Choose suppliers'}</button>
      </div>
      {editing===row.key&&<div className="section" style={{maxHeight:160,overflowY:'auto',padding:'5px 0'}}><p className="muted tiny">Designated company contacts. Edit names and numbers in Supplier Directory.</p>
       {contacts.length?contacts.map(c=><label className="checkline" key={c.id} style={{display:'flex',gap:8,marginBottom:6,overflowWrap:'anywhere'}}><input type="checkbox" checked={chosen.ids.includes(c.id)} onChange={e=>update(row,{ids:e.target.checked?uniqueIds([...chosen.ids,c.id]):chosen.ids.filter(id=>id!==c.id),mode:chosen.mode==='direct'&&e.target.checked?'manual':chosen.mode})}/>{c.label} · {selectedPhone(c.supplier)}</label>):<p className="muted tiny">No designated contacts. Add contacts in Supplier Directory first.</p>}
      </div>}
      {changed&&<div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginTop:8}}>
       <button type="button" className="btn primary small" disabled={!!busy||!validation.valid} onClick={()=>save(row)}>{busy===row.key?'Saving…':'Save this workflow'}</button>
       <button type="button" className="btn small" disabled={!!busy} onClick={()=>setDrafts(old=>{const next={...old};delete next[row.key];return next})}>Cancel</button>
       {!validation.valid&&<small className="muted">{validation.error}</small>}
      </div>}
     </div>
    })}
    </div>
   </details>
  })}
  </div>
 </details>
}
