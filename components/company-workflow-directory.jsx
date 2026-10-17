'use client'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {allRows} from '@/lib/query-pages'
import {supplierSetupPlan} from '@/lib/company-supplier-setup.mjs'
import {switchRouteTemplate} from '@/lib/company-route-template.mjs'
import {workflowRows,workflowValidation,uniqueIds} from '@/lib/company-workflow-directory.mjs'
import {companyScopeTree,branchItemCount,requestedModeFor,REQUESTED_COMPANY_MODES,planBranchMode} from '@/lib/company-workflow-tree.mjs'

const equalIds=(a=[],b=[])=>[...a].sort().join('|')===[...b].sort().join('|')
const phone=s=>s?.whatsapp||s?.phone||'No number'

// Settings-only screen. Configuring routes MUST NOT create an RFQ, PO or WAHA dispatch.
export function CompanyWorkflowDirectory({companies=[],can=()=>false,active=true,flash=()=>{},fail=()=>{}}){
 const [data,setData]=useState(null)
 const [query,setQuery]=useState('')
 const [drafts,setDrafts]=useState({})
 const [expanded,setExpanded]=useState({})
 const [contactsOpen,setContactsOpen]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [results,setResults]=useState([])
 const [refresh,setRefresh]=useState(0)
 const lock=useRef(false)
 const runVersion=useRef(0)
 const companyIds=useMemo(()=>companies.map(c=>c.id),[companies])
 const signature=companyIds.join(',')

 const load=useCallback(async()=>{
  if(!companyIds.length){const empty={sections:[],routes:[],links:[],pool:[],suppliers:[],directory:[],items:[]};setData(empty);return empty}
  const scope=q=>q.in('company_id',companyIds)
  const [sections,routes,pool,suppliers,directory,items]=await Promise.all([
   allRows(()=>scope(supabase.from('proc_company_sections').select('id,company_id,parent_id,name,sort_order,active')).eq('active',true).order('id')),
   allRows(()=>scope(supabase.from('proc_company_section_routes').select('*').order('id'))),
   allRows(()=>scope(supabase.from('proc_company_group_contacts').select('company_id,section_id,supplier_id,sort_order').order('section_id'))),
   allRows(()=>supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp,active').eq('supplier_kind','company').eq('active',true).order('name')),
   allRows(()=>scope(supabase.from('proc_company_contact_directory').select('company_id,supplier_id,display_name').order('company_id'))),
   allRows(()=>scope(supabase.from('proc_company_list_items').select('id,company_id,section_id,active')).eq('active',true).order('id'))
  ])
  for(const r of [sections,routes,pool,suppliers,items])if(r.error)throw r.error
  if(directory.error&&!['PGRST205','42P01'].includes(directory.error.code))throw directory.error
  const routeIds=(routes.data||[]).map(r=>r.id),links=[]
  for(let i=0;i<routeIds.length;i+=40){
   const ids=routeIds.slice(i,i+40)
   const q=await allRows(()=>supabase.from('proc_company_section_route_suppliers').select('route_id,supplier_id,sort_order').in('route_id',ids).order('route_id'))
   if(q.error)throw q.error
   links.push(...q.data)
  }
  const next={sections:sections.data||[],routes:routes.data||[],pool:pool.data||[],suppliers:suppliers.data||[],directory:directory.data||[],items:items.data||[],links}
  setData(next)
  return next
 },[signature])

 useEffect(()=>{
  if(!active)return
  let current=true;const version=++runVersion.current
  load().then(()=>{if(current&&version===runVersion.current)setError('')})
   .catch(e=>{if(current&&version===runVersion.current){setError(e.message||'Cannot load company workflow');fail(e)}})
  return()=>{current=false}
 },[active,load,refresh])

 const rows=useMemo(()=>data?workflowRows(companies,data.sections,data.routes,data.links,data.pool):[],[companies,data])
 const rowByKey=useMemo(()=>new Map(rows.map(r=>[r.key,r])),[rows])
 const supplierMap=useMemo(()=>new Map((data?.suppliers||[]).map(s=>[s.id,s])),[data])
 const countByKey=useMemo(()=>new Map(rows.map(r=>[r.key,branchItemCount(data?.items||[],r,data?.sections||[])])),[rows,data])
 const treeByCompany=useMemo(()=>new Map(companies.map(c=>[c.id,companyScopeTree(rows,c.id)])),[rows,companies])
 const rowDraft=row=>drafts[row.key]||null
 const ownMode=row=>rowDraft(row)?.mode??row.mode
 const ownIds=row=>rowDraft(row)?.ids??(row.recipients.length?row.recipients:row.assigned)
 const activeAncestorDraft=row=>{
  if(rowDraft(row))return null
  let current=row.section,seen=new Set()
  while(current&&!seen.has(current.id)){
   seen.add(current.id)
   const parent=current.parent_id?rowByKey.get(row.company.id+':'+current.parent_id):rowByKey.get(row.company.id+':company')
   if(!parent)break
   if(drafts[parent.key]?.applyChildren)return {row:parent,draft:drafts[parent.key]}
   current=parent.section
  }
  return drafts[row.company.id+':company']?.applyChildren?{row:rowByKey.get(row.company.id+':company'),draft:drafts[row.company.id+':company']}:null
 }
 const preview=row=>{
  const inherited=activeAncestorDraft(row)
  if(!inherited)return {mode:ownMode(row),ids:ownIds(row),from:null}
  const ownContacts=uniqueIds((data?.pool||[]).filter(x=>x.company_id===row.company.id&&x.section_id===row.section_id).map(x=>x.supplier_id))
  const ids=row.own?row.recipients:ownContacts.length?ownContacts:inherited.draft.ids
  return {mode:inherited.draft.mode,ids,from:inherited.row?.path}
 }
 const contactChoices=row=>{
  const owned=(data?.directory||[]).filter(x=>x.company_id===row.company.id)
  const ids=uniqueIds([...owned.map(x=>x.supplier_id),...row.assigned,...row.recipients])
  return ids.map(id=>({id,supplier:supplierMap.get(id),label:owned.find(x=>x.supplier_id===id)?.display_name||supplierMap.get(id)?.name||'Unavailable'}))
 }
 const update=(row,patch)=>{
  setDrafts(old=>({...old,[row.key]:{mode:old[row.key]?.mode??row.mode,ids:old[row.key]?.ids??(row.recipients.length?row.recipients:row.assigned),applyChildren:old[row.key]?.applyChildren??false,...patch}}))
  setNotice('');setResults([])
 }
 const matches=row=>{
  const q=query.trim().toLowerCase()
  if(!q)return true
  const contacts=contactChoices(row).map(x=>x.label+' '+phone(x.supplier)).join(' ')
  return (row.company.name+' '+row.path+' '+contacts).toLowerCase().includes(q)
 }
 const hasMatchBelow=row=>row.section&&rows.some(child=>child.company.id===row.company.id&&child.path.startsWith(row.path+' / ')&&matches(child))
 const isVisible=row=>matches(row)||!!hasMatchBelow(row)
 const toggle=key=>setExpanded(old=>({...old,[key]:!old[key]}))
 const clearDraft=row=>setDrafts(old=>{const next={...old};delete next[row.key];return next})

 function planFor(row){
  if(rowDraft(row)?.applyChildren)return planBranchMode(rows,row,ownMode(row),ownIds(row),data?.pool||[])
  return {actions:[{row,mode:ownMode(row),ids:ownIds(row)}],expected:[{row,mode:ownMode(row),ids:ownIds(row)}],conflicts:[],descendantSections:0}
 }
 function checkRow(row){
  const plan=planFor(row)
  if(plan.conflicts.length)return {valid:false,error:plan.conflicts[0].path+': '+plan.conflicts[0].reason+'. Review supplier assignments first.'}
  for(const choice of plan.expected){
   if(choice.mode!=='manual'&&!can(choice.mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve'))
    return {valid:false,error:'Document approval permission required.'}
   const v=workflowValidation(choice.mode,choice.ids,data?.suppliers||[])
   if(!v.valid)return {valid:false,error:choice.row.path+': '+v.error}
   const p=supplierSetupPlan({assigned:choice.ids,recipients:choice.ids,mode:choice.mode,suppliers:data?.suppliers||[]})
   if(!p.valid)return {valid:false,error:choice.row.path+': '+p.error}
  }
  return {valid:true,error:''}
 }
 function changed(row){
  const draft=rowDraft(row)
  if(!draft)return false
  if(draft.mode!==row.mode||!equalIds(draft.ids,row.recipients))return true
  const plan=planFor(row)
  return plan.actions.length>1||plan.expected.some(x=>x.row.mode!==draft.mode)
 }
 async function saveRoute(row){
  const validation=checkRow(row)
  if(!validation.valid)throw new Error(validation.error)
  const plan=planFor(row)
  let updated=0
  for(const choice of plan.actions){
   const current=choice.row
   const res=await supabase.rpc('proc_company_save_supplier_setup',{
    p_company_id:current.company.id,p_section_id:current.section_id,p_action:choice.mode,
    p_assigned_ids:choice.ids,p_recipient_ids:choice.ids,
    p_template:switchRouteTemplate(current.effective?.document_template||{},current.effective?.route_mode||'rfq',choice.mode==='direct'?'direct':'rfq'),
    p_expected_route_id:current.own?.id||null,p_expected_updated_at:current.own?.updated_at||null
   })
   if(res.error)throw new Error((updated?'Previous group(s) saved; ':'')+current.path+': '+res.error.message)
   updated++
  }
  return {row,mode:ownMode(row),ids:ownIds(row),updated,expected:plan.expected,branch:!!rowDraft(row)?.applyChildren}
 }
 async function runSave(requested,{batch=false}={}){
  if(lock.current||!requested.length)return
  const valid=[],skipped=[]
  for(const row of requested){
   const check=checkRow(row)
   if(check.valid)valid.push(row)
   else skipped.push({name:row.company.name+' / '+row.path,status:'Skipped',reason:check.error})
  }
  if(!valid.length){setResults(skipped);setError('No valid routes ready to save. Assign active suppliers with +94 WhatsApp numbers first.');return}
  const nestedUpdates=valid.reduce((n,row)=>n+Math.max(0,planFor(row).actions.length-1),0)
  const description=valid.length+' parent workflow'+(valid.length===1?'':'s')+
   (nestedUpdates?' and update '+nestedUpdates+' child-specific route'+(nestedUpdates===1?'':'s'):'')+
   '. The choice applies below each parent and preserves designated child suppliers. No messages or orders will be sent now. Continue?'
  if(!window.confirm(description))return
  lock.current=true;setBusy(true);setError('');setNotice('');setResults([])
  const completed=[],failed=[]
  try{
   for(const row of valid){
    try{completed.push(await saveRoute(row))}
    catch(e){failed.push({name:row.company.name+' / '+row.path,status:'Error',reason:e.message||String(e)})}
   }
   let refreshed
   try{refreshed=await load()}
   catch(e){failed.push({name:'Verification',status:'Error',reason:e.message||String(e)})}
   const readback=refreshed?workflowRows(companies,refreshed.sections,refreshed.routes,refreshed.links,refreshed.pool):[]
   const verified=[]
   for(const done of completed){
    if(!refreshed)continue
    const verifiedAll=done.expected.every(choice=>{
     const found=readback.find(r=>r.key===choice.row.key)
     return found?.mode===choice.mode&&(choice.mode==='manual'||equalIds(found?.recipients,choice.ids))
    })
    if(!verifiedAll)failed.push({name:done.row.company.name+' / '+done.row.path,status:'Check required',reason:'A parent or child route did not match saved readback. Reload and review.'})
    else verified.push(done)
   }
   setResults([...verified.map(x=>({name:x.row.company.name+' / '+x.row.path,status:'Saved',reason:x.updated>1?x.updated+' category routes verified, with designated suppliers preserved.':'Verified'})),...skipped,...failed])
   if(verified.length)setDrafts(prev=>{
    const next={...prev}
    for(const saved of verified)delete next[saved.row.key]
    return next
   })
   setNotice(verified.length+' verified workflow'+(verified.length===1?'':'s')+' saved, '+skipped.length+' skipped, '+failed.length+' needing review. No messages or orders were sent.')
   if(failed.length)setError('Some workflows need attention. See the results below; do not assume failed items were rolled back.')
   else flash(verified.length+' company workflows saved and verified. No messages sent.')
  }finally{lock.current=false;setBusy(false)}
 }

 function stagePreferences(){
  const next={...drafts}
  let matched=0
  for(const row of rows.filter(r=>!r.section)){
   const mode=requestedModeFor(row.company.name)
   if(!mode)continue
   next[row.key]={mode,ids:uniqueIds(row.assigned.length?row.assigned:row.recipients),applyChildren:true}
   matched++
  }
  setDrafts(next);setError('');setResults([])
  setNotice('Loaded '+matched+' of '+Object.keys(REQUESTED_COMPANY_MODES).length+' requested company modes for review. Nothing has been saved yet. Missing/invalid contacts will be skipped on save.')

 }
 const pendingRows=rows.filter(r=>changed(r))
 const countPending=pendingRows.length
 const stagedCompanyRows=rows.filter(r=>!r.section&&changed(r)&&requestedModeFor(r.company.name))
 const readyStaged=stagedCompanyRows.filter(r=>checkRow(r).valid)
 const invalidStaged=stagedCompanyRows.length-readyStaged.length
 const totals={rfq:rows.filter(r=>r.mode==='rfq').length,direct:rows.filter(r=>r.mode==='direct').length,manual:rows.filter(r=>r.mode==='manual').length}

 function renderRow(row,depth=0){
  if(!isVisible(row))return null
  const isCompany=!row.section
  const openKey=isCompany?row.company.id:row.key
  const canExpand=isCompany?!!treeByCompany.get(row.company.id)?.sections.length:rows.some(r=>r.company.id===row.company.id&&r.section?.parent_id===row.section_id)
  const expandedNow=!!query.trim()||!!expanded[openKey]
  const chosen=preview(row),selected=ownIds(row)
  const draft=rowDraft(row)
  const inherited=!!chosen.from
  const dirty=changed(row)
  const check=dirty?checkRow(row):{valid:true,error:''}
  const contacts=contactChoices(row)
  const supplierNames=chosen.ids.map(id=>supplierMap.get(id)?.name||'Missing supplier')
  const label=isCompany?row.company.name:row.section.name
  const count=countByKey.get(row.key)||0
  return <div key={row.key} className={'company-workflow-check-row'+(isCompany?' company-workflow-company':'')+(dirty?' company-workflow-unsaved':'')} style={{'--workflow-depth':Math.min(depth,6)}}>
   <div className="company-workflow-check-main">
    <div className="company-workflow-check-name">
     {canExpand?<button type="button" className="company-workflow-expand" aria-expanded={expandedNow} aria-label={(expandedNow?'Collapse ':'Expand ')+row.company.name+' / '+row.path} disabled={busy} onClick={()=>toggle(openKey)}>{expandedNow?'▾':'▸'}</button>:<span className="company-workflow-expand company-workflow-expand-empty" aria-hidden="true"/>}
     <div className="company-workflow-check-name-inner">
      <span className="company-workflow-label" title={row.company.name+' / '+row.path}>{label}</span>
      <span className="company-workflow-subline">
       <span>{count} items</span>
       <button className="company-workflow-supplier-link" type="button" disabled={busy} aria-expanded={contactsOpen===row.key} aria-label={'Select supplier contacts for '+row.company.name+' / '+row.path} title={supplierNames.join(', ')||'No supplier'} onClick={()=>setContactsOpen(x=>x===row.key?'':row.key)}>Suppliers: {chosen.ids.length}</button>
       {dirty&&<span className="company-workflow-changed">Unsaved</span>}
       {!dirty&&inherited&&<span>Parent pending</span>}
      </span>
     </div>
    </div>
    <label className="company-workflow-check-cell" title={'Auto RFQ for '+row.company.name+' / '+row.path}>
     <input type="checkbox" aria-label={'Auto RFQ for '+row.company.name+' / '+row.path} checked={chosen.mode==='rfq'} disabled={busy||!can('procurement.rfq.manage')||inherited} onChange={e=>update(row,{mode:e.target.checked?'rfq':'manual',applyChildren:true})}/>
    </label>
    <label className="company-workflow-check-cell" title={'Auto PO for '+row.company.name+' / '+row.path}>
     <input type="checkbox" aria-label={'Auto PO for '+row.company.name+' / '+row.path} checked={chosen.mode==='direct'} disabled={busy||!can('procurement.orders.approve')||inherited} onChange={e=>update(row,{mode:e.target.checked?'direct':'manual',applyChildren:true})}/>
    </label>
   </div>
   {(contactsOpen===row.key||dirty||inherited)&&<div className="company-workflow-detail">
    {contactsOpen===row.key&&<div className="company-workflow-contact-panel">
     <strong className="muted tiny">Designated supplier contacts</strong>
     {contacts.length?contacts.map(contact=><label key={contact.id} className="company-workflow-contact-option">
      <input type="checkbox" checked={selected.includes(contact.id)} disabled={busy||inherited} onChange={e=>update(row,{ids:e.target.checked?uniqueIds([...selected,contact.id]):selected.filter(id=>id!==contact.id),mode:ownMode(row)==='direct'&&e.target.checked?'manual':ownMode(row)})}/>
      <span>{contact.label} · {phone(contact.supplier)}</span>
     </label>):<p className="muted tiny">No company contacts. Add a number in Supplier Directory first.</p>}
    </div>}
    {inherited&&<button className="btn small" type="button" disabled={busy} onClick={()=>update(row,{mode:row.mode,ids:row.recipients,applyChildren:true})}>Set a separate rule for this category</button>}
    {dirty&&<div className="company-workflow-check-actions">
     {canExpand&&draft?.applyChildren&&<span className="muted tiny">Applies to {planFor(row).descendantSections} subcategories below; preserves their assigned suppliers</span>}
     <button className="btn small primary" type="button" disabled={busy||!check.valid} onClick={()=>runSave([row])}>{busy?'Saving…':'Save this selection'}</button>
     <button className="btn small" type="button" disabled={busy} onClick={()=>clearDraft(row)}>Undo</button>
     {!check.valid&&<span className="company-workflow-validation" role="status">{check.error}</span>}
    </div>}
   </div>}
  </div>
 }
 function renderNode(node,depth=1){
  if(depth>50)return null
  if(!isVisible(node.row)&&!node.children.some(c=>isVisible(c.row)||c.children.some(n=>isVisible(n.row))))return null
  const visible=!!query.trim()||!!expanded[node.row.key]
  return <div key={node.row.key} className="company-workflow-tree-branch">
   {renderRow(node.row,depth)}
   {visible&&node.children.map(child=>renderNode(child,depth+1))}
  </div>
 }

 if(!can('company_lists.manage'))return null
 return <details className="card pad section" aria-label="Company workflow directory">
  <summary><strong>Company Workflow Directory</strong> · expandable RFQ / PO categories</summary>
  <p className="muted tiny section">Choose Auto RFQ or Auto PO on a parent, then Save branch. The choice applies to every nested category and its items. Different subcategories retain their own designated suppliers. Saving applies only to future shortages and never generates or sends a document.</p>
  <div className="toolbar section" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
   <input className="input" type="search" value={query} onChange={e=>setQuery(e.target.value)} aria-label="Search companies and categories" placeholder="Search company, category, supplier" style={{flex:'1 1 180px',minWidth:0}}/>
   <button className="btn small" type="button" disabled={busy} onClick={()=>{setDrafts({});setResults([]);setRefresh(x=>x+1)}}>Reload saved</button>
   <button className="btn small" type="button" disabled={busy||!rows.length} onClick={stagePreferences}>Load my 19 choices</button>
  </div>
  <p className="muted tiny">{companies.length} companies · {rows.length} scopes · saved: {totals.rfq} auto RFQ / {totals.direct} auto PO / {totals.manual} manual</p>
  {!!stagedCompanyRows.length&&<div style={{border:'1px solid var(--line, #e2e8f0)',padding:9,borderRadius:8,marginTop:8}}>
   <strong>Preferred company workflows — review before applying</strong>
   <p className="muted tiny">{stagedCompanyRows.length} staged · {readyStaged.length} valid with designated suppliers · {invalidStaged} require contact updates. Invalid configurations are skipped. Company-level choices apply to all nested items unless you later create an exception.</p>
   <button className="btn primary small" type="button" disabled={busy||!readyStaged.length} onClick={()=>runSave(stagedCompanyRows,{batch:true})}>Save valid preferred company workflows</button>
  </div>}
  {error&&<p className="notice bad" role="alert">{error}</p>}
  {notice&&<p className="notice" role="status">{notice}</p>}
  {!!results.length&&<details className="section" open><summary>Saved / skipped / errors ({results.length})</summary>
   <div style={{maxHeight:150,overflowY:'auto'}}>
   {results.map((r,i)=><p className="muted tiny" key={r.name+':'+i}><strong>{r.status}</strong> · {r.name} · {r.reason}</p>)}
   </div>
  </details>}
  {!data&&!error&&<p className="muted" role="status">Loading company suppliers and nested categories…</p>}
  {data&&<div style={{maxHeight:'65vh',overflowY:'auto',overscrollBehavior:'contain',marginTop:8}}>
   {[...companies].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true})).map(company=>{
    const tree=treeByCompany.get(company.id)
    if(!tree?.company)return null
    if(query.trim()&&!rows.some(r=>r.company.id===company.id&&matches(r)))return null
    const companyOpen=!!query.trim()||!!expanded[company.id]
    return <div key={company.id} style={{border:'1px solid var(--line, #e2e8f0)',borderRadius:10,marginBottom:8,padding:'5px 7px'}}>
     <div style={{display:'flex',alignItems:'center',gap:8}}>
      <button type="button" className="btn small" aria-label={(companyOpen?'Collapse ':'Expand ')+company.name} aria-expanded={companyOpen} onClick={()=>toggle(company.id)} style={{padding:'2px 7px',minWidth:30}}>{companyOpen?'▾':'▸'}</button>
      <strong style={{flex:1,fontSize:13,overflowWrap:'anywhere'}}>{company.name}</strong>
      <small className="muted">{countByKey.get(tree.company.key)||0} items</small>
      <small className="muted">{preview(tree.company).mode==='rfq'?'RFQ':preview(tree.company).mode==='direct'?'PO':'Manual'}</small>
     </div>
     {companyOpen&&<div>
      {renderRow(tree.company)}
      {tree.sections.map(node=>renderNode(node,0))}
     </div>}
    </div>
   })}
  </div>}
 </details>
}
