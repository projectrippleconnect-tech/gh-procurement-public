'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {companyApi} from './company-controls'
import {sendGroupRfqImages} from '@/lib/group-rfq-send.mjs'
import {defaultRouteTemplate,routeTemplate} from '@/lib/company-route-template.mjs'
import {createSupplierPriceRequestPng} from '@/lib/rfq-share'
import {sectionPaths} from '@/lib/company-section-tree.mjs'
import {GroupSupplierContactEditor} from './group-supplier-contact-editor'
import {nearestSectionRoute,validateSectionRoute,sectionRouteCoverage} from '@/lib/company-section-routing.mjs'
import {useDangerConfirmation} from './danger-confirmation'

const initial={mode:'rfq',auto_send:false,supplier_ids:[]}
const companyScope='company-default'
const uniq=ids=>[...new Set(ids.filter(Boolean))]
export function CompanySectionRouteManager({company,sections=[],rows=[],can=()=>false,profile,flash,fail,navigate,onChanged=()=>{},directoryRevision=0,toolsOnly=false}){
 const confirm=useDangerConfirmation()
 const [routes,setRoutes]=useState([]),[routeSuppliers,setRouteSuppliers]=useState([]),[suppliers,setSuppliers]=useState([])
 const [groupContactLinks,setGroupContactLinks]=useState([]),[groupIds,setGroupIds]=useState([]),[poolDirty,setPoolDirty]=useState(false),[showFallback,setShowFallback]=useState(false)
 const [template,setTemplate]=useState(defaultRouteTemplate('rfq'))
 const routeSections=useMemo(()=>[{id:companyScope,name:'Advanced · fallback for unassigned groups',active:true,parent_id:null},...sections.map(s=>({...s,parent_id:s.parent_id||companyScope}))],[sections])
 const [editing,setEditing]=useState(''),[draft,setDraft]=useState(initial),[search,setSearch]=useState('')
 const [editorVersion,setEditorVersion]=useState({id:null,updated_at:null})
 const [supplierSearch,setSupplierSearch]=useState(''),[editContactId,setEditContactId]=useState('')
 const [busy,setBusy]=useState(false),[sendResults,setSendResults]=useState([]),[pendingRfq,setPendingRfq]=useState(null),[routeNotice,setRouteNotice]=useState(''),[dispatchNotice,setDispatchNotice]=useState(null)
 const running=useRef(false)
 const admin=(profile?.role_key||profile?.role)==='admin'&&can('company_lists.manage')
 const paths=useMemo(()=>sectionPaths(sections),[sections])
 const groups=useMemo(()=>[...routeSections].filter(s=>s.active!==false&&(s.id!==companyScope||showFallback)&&(paths.get(s.id)||s.name).toLowerCase().includes(search.trim().toLowerCase()))
  .sort((a,b)=>a.id===companyScope?1:b.id===companyScope?-1:(paths.get(a.id)||a.name).localeCompare(paths.get(b.id)||b.name,undefined,{numeric:true})),[routeSections,paths,search,showFallback])
 const routeIndex=useMemo(()=>new Map(routes.map(r=>[r.section_id,r])),[routes])
 const coverage=useMemo(()=>new Map(routeSections.filter(s=>s.active!==false).map(s=>[s.id,sectionRouteCoverage(s.id,routeSections,rows.map(r=>({...r,section_id:r.section_id||companyScope})),routes)])),[routeSections,rows,routes])
 const members=useMemo(()=>new Map(routes.map(r=>[r.id,routeSuppliers.filter(v=>v.route_id===r.id).sort((a,b)=>a.sort_order-b.sort_order).map(v=>v.supplier_id)])),[routes,routeSuppliers])
 const contactBySection=useMemo(()=>new Map(sections.map(s=>[s.id,groupContactLinks.filter(v=>v.section_id===s.id).sort((a,b)=>a.sort_order-b.sort_order).map(v=>v.supplier_id)]).filter(([,ids])=>ids.length)),[sections,groupContactLinks])
 function inheritedContacts(s){
  let current=s,seen=new Set()
  while(current&&current.id!==companyScope&&!seen.has(current.id)){
   seen.add(current.id)
   if(contactBySection.has(current.id))return contactBySection.get(current.id)
   current=routeSections.find(v=>v.id===current.parent_id)
  }
  const rule=routeIndex.get(s.id)||nearestSectionRoute(s,routeSections,routes)?.rule
  return rule?rule.assigned_supplier_ids||members.get(rule.id)||[]:[]
 }
 async function load(){
  if(!company?.id)return
  const [rules,contacts,pool]=await Promise.all([
   supabase.from('proc_company_section_routes').select('*').eq('company_id',company.id),
   supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name'),
   supabase.from('proc_company_group_contacts').select('company_id,section_id,supplier_id,sort_order').eq('company_id',company.id)
  ])
  if(rules.error)throw rules.error
  if(contacts.error)throw contacts.error
  if(pool.error)throw pool.error
  const ids=(rules.data||[]).map(v=>v.id)
  const links=[]
  for(let i=0;i<ids.length;i+=40){
   const result=await supabase.from('proc_company_section_route_suppliers').select('route_id,supplier_id,sort_order').in('route_id',ids.slice(i,i+40)).limit(1000)
   if(result.error)throw result.error
   links.push(...result.data||[])
  }
  setRoutes((rules.data||[]).map(r=>({...r,section_id:r.section_id||companyScope})))
  setRouteSuppliers(links)
  setSuppliers(contacts.data||[])
  setGroupContactLinks(pool.data||[])
 }
 useEffect(()=>{load().catch(fail)},[company?.id,company?.updated_at,directoryRevision])
 useEffect(()=>{setEditing('');setDraft(initial);setSearch('');setPendingRfq(null);setSendResults([]);setRouteNotice('');setDispatchNotice(null);setShowFallback(false);setGroupIds([])},[company?.id])
 const openEditor=s=>{
  const own=routeIndex.get(s.id);setEditorVersion({id:own?.id||null,updated_at:own?.updated_at||null})
  const existing=routeIndex.get(s.id)||nearestSectionRoute(s,routeSections,routes)?.rule
  const ids=existing?members.get(existing.id)||[]:[]
  const assigned=inheritedContacts(s)
  setGroupIds(uniq([...assigned,...ids]))
  setPoolDirty(false)
  setEditing(s.id)
  setDispatchNotice(null)
  setTemplate(routeTemplate(existing?.document_template||{},existing?.route_mode||'rfq'))
  setDraft(existing?{mode:existing.route_mode,auto_send:existing.auto_send,supplier_ids:ids}:
   {...initial})
  setSupplierSearch('')
  setEditContactId('')
 }
 const run=async callback=>{
  if(running.current)return
  running.current=true;setBusy(true)
  try{await callback()}catch(e){fail(e)}finally{running.current=false;setBusy(false)}
 }
 async function save(close=true){
  setDispatchNotice(null)
  const check=validateSectionRoute({mode:draft.mode,supplierIds:draft.supplier_ids,autoSend:draft.auto_send})
  if(draft.supplier_ids.some(id=>!groupIds.includes(id)))throw new Error('Select assigned group contacts for sending.')
  if(!check.valid)throw new Error(check.reason)
  const ids=check.supplierIds
  if(draft.mode==='direct'&&draft.auto_send&&ids.length!==1)throw new Error('Select exactly one recipient for automatic direct PO; your other assigned contacts stay available.')
  const r=await supabase.rpc('proc_company_save_supplier_setup',{
   p_company_id:company.id,p_section_id:editing===companyScope?null:editing,
   p_action:draft.auto_send?draft.mode:draft.mode+'_manual',p_assigned_ids:groupIds,p_recipient_ids:ids,
   p_template:routeTemplate(template,draft.mode),p_expected_route_id:editorVersion.id,p_expected_updated_at:editorVersion.updated_at
  })
  if(r.error)throw r.error
  setEditorVersion({id:r.data?.id||null,updated_at:r.data?.updated_at||null});setRouteNotice('Group route saved.');
  await load();await onChanged();if(close)setEditing('')
  flash(draft.mode==='direct'?(draft.auto_send?'Direct PO with automatic sending configured.':'Direct PO route saved without automatic sending.'):'RFQ route saved for '+ids.length+' supplier(s).'+(draft.auto_send?' Automatic sending after stock submission is enabled.':''))
 }
 async function gatewayRequest(path,body){
  const {data:{session}}=await supabase.auth.getSession()
  if(!session?.access_token)throw new Error('Sign in again before sending.')
  const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000),cache:'no-store'})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||'WhatsApp sending failed. Check dispatch status before resending.')
  return data
 }
 async function sendRfq(rfq){
  setSendResults([])
  await sendGroupRfqImages({db:supabase,rfqId:rfq.rfq_id,template:rfq.document_template||template,request:gatewayRequest,createImage:createSupplierPriceRequestPng,
   encode:blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read RFQ image.'));reader.readAsDataURL(blob)}),
   onResult:result=>setSendResults(v=>[...v,result])})
 }
 async function saveAndSend(){
  const sectionId=editing===companyScope?null:editing,mode=draft.mode
  if(!can(mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve'))throw new Error('Permission to prepare this document is required.')
  // Check before making a document; ordinary route saving remains independent.
  const gateway=await gatewayRequest('/api/integrations/whatsapp/'+(mode==='rfq'?'rfq':'po'))
  if(!gateway.connected||!gateway.sendingEnabled)throw new Error('Connect WhatsApp and enable sending in RFQs first, or use Save group route to save without sending.')
  await save(false)
  if(mode==='rfq'){
   const r=await supabase.rpc('proc_company_prepare_route_rfq',{p_company_id:company.id,p_section_id:sectionId,p_due_date:null})
   if(r.error){
    if(/No approved unquoted shortages remain for this group/i.test(r.error.message||'')){
     setDispatchNotice({groupId:editing,text:'RFQ not sent — your supplier settings were saved. This group has no approved shortage waiting for a quotation. Check Stock Entry, approve new shortages in Review, or open an existing RFQ before trying again.'})
     return
    }
    throw new Error('Route saved, but RFQ preparation failed: '+r.error.message)
   }
   setPendingRfq(r.data)
   setRouteNotice('Route saved. RFQ '+r.data.rfq_no+' prepared; sending images…')
   await sendRfq(r.data)
   setRouteNotice('Route saved. RFQ '+r.data.rfq_no+' — see each supplier’s sending result below.')
  }else{
   const r=await supabase.rpc('proc_company_prepare_route_po',{p_company_id:company.id,p_section_id:sectionId})
   if(r.error){
    if(/No approved un-ordered shortages remain for this group/i.test(r.error.message||'')){
     setDispatchNotice({groupId:editing,text:'PO not sent — your supplier settings were saved. There are no approved un-ordered shortages for this group. Check Stock Entry and Review, or look for an existing purchase order.'})
     return
    }
    throw new Error('Route saved, but purchase-order preparation failed: '+r.error.message)
   }
   setRouteNotice('Route saved. Direct PO prepared.')
   const sent=await companyApi('orders',{companyId:company.id,poIds:(r.data||[]).map(po=>po.id)})
   setSendResults((sent.outcomes||[]).map(outcome=>({...outcome,supplierId:outcome.id,message:outcome.error||'Image and caption accepted by WhatsApp.'})))
  }
  setEditing('')
 }
 // The advanced panel deliberately does NOT edit route assignment or sending modes.
 // A template write uses a dedicated RPC so even a stale UI cannot silently
 // change the supplier pool, recipient list or automatic sending preference.
 async function saveTemplateOnly(){
  if(!editorVersion.id||!editorVersion.updated_at)throw new Error('Choose an explicitly saved route. An inherited template must be edited at its parent group.')
  const payload=routeTemplate(template,draft.mode)
  const result=await supabase.rpc('proc_company_update_route_template',{
   p_route_id:editorVersion.id,p_template:payload,
   p_expected_updated_at:editorVersion.updated_at
  })
  if(result.error)throw result.error
  if(result.data?.id!==editorVersion.id||!result.data.updated_at)throw new Error('The template update could not be verified; reload before editing again.')
  const updatedId=result.data.id
  await load()
  setEditorVersion({id:updatedId,updated_at:result.data.updated_at})
  await onChanged()
  setEditing('')
  setRouteNotice('Document template saved. Supplier assignments, RFQ/PO mode and WhatsApp automatic sending settings remain unchanged.')
  flash('Document image and caption template saved. No WhatsApp message sent.')
 }
 async function sendConfiguredRoute(section,rule){
  const recipientIds=members.get(rule?.id)||[]
  if(!rule?.id)throw new Error('Select an explicitly saved RFQ/PO route.')
  const latest=await supabase.from('proc_company_section_routes').select('id,updated_at,route_mode,auto_send').eq('id',rule.id).eq('company_id',company.id).single()
  if(latest.error)throw latest.error
  if(latest.data.updated_at!==rule.updated_at||latest.data.route_mode!==rule.route_mode||latest.data.auto_send!==rule.auto_send)
   throw new Error('This group route changed since it was loaded. Refresh before sending any document.')
  const savedRecipients=await supabase.from('proc_company_section_route_suppliers').select('supplier_id,sort_order').eq('route_id',rule.id).order('sort_order')
  if(savedRecipients.error)throw savedRecipients.error
  const currentRecipientIds=(savedRecipients.data||[]).map(row=>row.supplier_id)
  if(currentRecipientIds.length!==recipientIds.length||currentRecipientIds.some((id,index)=>id!==recipientIds[index]))
   throw new Error('Recipient selections changed since this screen opened. Refresh and review before sending.')
  const mode=rule.route_mode
  if(mode==='direct'&&recipientIds.length!==1)throw new Error('Direct PO must have exactly one saved sending recipient. Correct this in RFQ & PO Workflow Settings.')
  if(!recipientIds.length)throw new Error('No saved recipients for this route. Correct this in RFQ & PO Workflow Settings.')
  if(!can(mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve'))throw new Error('Document preparation permission required.')
  const gateway=await gatewayRequest('/api/integrations/whatsapp/'+(mode==='rfq'?'rfq':'po'))
  if(!gateway.connected||!gateway.sendingEnabled)throw new Error('WhatsApp sending is not connected and enabled. No new document was prepared.')
  const sectionId=section.id===companyScope?null:section.id
  setDispatchNotice(null);setSendResults([])
  if(mode==='rfq'){
   const result=await supabase.rpc('proc_company_prepare_route_rfq',{p_company_id:company.id,p_section_id:sectionId,p_due_date:null})
   if(result.error){
    if(/No approved unquoted shortages remain for this group/i.test(result.error.message||'')){
     setDispatchNotice({groupId:section.id,text:'Nothing sent: no approved, unquoted shortage remains for this group. Check existing RFQs.'})
     return
    }
    throw new Error('RFQ preparation failed: '+result.error.message)
   }
   setPendingRfq(result.data)
   setRouteNotice('RFQ '+result.data.rfq_no+' prepared. Sending images to saved recipients…')
   await sendRfq(result.data)
   setRouteNotice('RFQ '+result.data.rfq_no+' — review each supplier result below before retrying.')
  }else{
   const result=await supabase.rpc('proc_company_prepare_route_po',{p_company_id:company.id,p_section_id:sectionId})
   if(result.error){
    if(/No approved un-ordered shortages remain for this group/i.test(result.error.message||'')){
     setDispatchNotice({groupId:section.id,text:'Nothing sent: no approved un-ordered shortage remains for this group. Check existing POs.'})
     return
    }
    throw new Error('PO preparation failed: '+result.error.message)
   }
   const poIds=(result.data||[]).map(po=>po.id)
   if(!poIds.length)throw new Error('No new PO IDs were returned. Check order history before retrying.')
   const sent=await companyApi('orders',{companyId:company.id,poIds})
   setSendResults((sent.outcomes||[]).map(outcome=>({...outcome,supplierId:outcome.id,message:outcome.error||'Accepted by WhatsApp gateway; delivery is not guaranteed.'})))
   setRouteNotice('Purchase-order sending attempted. Check individual results and the audit record before retrying.')
  }
 }
 async function removeOverride(section){
  const r=await supabase.rpc('proc_company_clear_section_route',{p_company_id:company.id,p_section_id:section.id===companyScope?null:section.id})
  if(r.error)throw r.error
  await load()
  await onChanged()
  setEditing('')
  flash('Custom group route cleared. The parent or company fallback now applies.')
 }
 async function contactSaved(id){
  // Save the supplier independently, but only save the group assignment on Save group route.
  await load()
  setGroupIds(v=>uniq([...v,id]))
  setPoolDirty(true)
  setDraft(v=>({...v,supplier_ids:v.mode==='rfq'?uniq([...v.supplier_ids,id]):v.supplier_ids.length?v.supplier_ids:[id]}))
  setEditContactId('')
 }
 function toggleGroupContact(id,checked){
  setPoolDirty(true)
  setGroupIds(v=>checked?uniq([...v,id]):v.filter(x=>x!==id))
  setDraft(v=>{
   if(!checked)return {...v,supplier_ids:v.supplier_ids.filter(x=>x!==id)}
   return {...v,supplier_ids:v.mode==='rfq'?uniq([...v.supplier_ids,id]):v.supplier_ids.length?v.supplier_ids:[id]}
  })
  if(!checked&&editContactId===id)setEditContactId('')
 }
 function toggleRecipient(id,checked){
  if(!groupIds.includes(id))return
  setDraft(v=>({...v,supplier_ids:checked?(v.mode==='direct'?[id]:uniq([...v.supplier_ids,id])):v.supplier_ids.filter(x=>x!==id)}))
 }
 async function prepare(s,rule){
  if(rule.route_mode==='rfq'){
   if(!can('procurement.rfq.manage'))throw new Error('RFQ management permission required.')
   const r=await supabase.rpc('proc_company_prepare_route_rfq',{p_company_id:company.id,p_section_id:s.id===companyScope?null:s.id,p_due_date:null})
   if(r.error)throw r.error
   flash('RFQ '+r.data.rfq_no+' prepared. Review and send it from the RFQ screen.')
   navigate('rfq',r.data.rfq_id,3)
  }else{
   if(!can('procurement.orders.approve'))throw new Error('Purchase order approval permission required.')
   const r=await supabase.rpc('proc_company_prepare_route_po',{p_company_id:company.id,p_section_id:s.id===companyScope?null:s.id})
   if(r.error)throw r.error
   flash((r.data?.length||0)+' approved direct purchase order(s) created.')
   if(rule.auto_send) {
    try{const sent=await companyApi('orders',{companyId:company.id});flash(sent.message)}
    catch(e){fail(new Error('Purchase order was created and queued, but automatic WhatsApp sending needs attention: '+e.message))}
   }
   navigate('po')
  }
 }
 if(!company?.id||!admin)return null
 if(toolsOnly)return <section aria-label="Advanced company document tools" className="section company-advanced-document-tools">
  <p className="muted tiny">Supplier assignment, recipient selection and RFQ/PO automation are edited only in RFQ &amp; PO Workflow Settings above. Here you can edit a saved route’s outgoing image and caption, prepare an approved shortage, or send it to its already-selected recipients.</p>
  {routeNotice&&<p role="status" className="notice">{routeNotice}</p>}
  {sendResults.length>0&&<div aria-label="Group WhatsApp sending results" className="section">{sendResults.map((result,i)=><p key={result.supplierId||i} className="tiny">{result.name||'Purchase order'} · <strong>{result.status}</strong> · {result.message}</p>)}</div>}
  {pendingRfq&&<div className="toolbar section"><button className="btn small" disabled={busy} onClick={()=>confirm({title:'Resume RFQ sending',message:'Retry only the unconfirmed recipient images for '+pendingRfq.rfq_no+'?',warning:'Check individual dispatch results first; never resend recipients with accepted or uncertain delivery.',confirmLabel:'Resume eligible RFQ recipients',onConfirm:()=>run(()=>sendRfq(pendingRfq))})}>Resume eligible RFQ images</button><button className="btn small" type="button" onClick={()=>navigate('rfq',pendingRfq.rfq_id,3)}>Open {pendingRfq.rfq_no}</button></div>}
  <label className="field section">Find group or subgroup<input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search category or subgroup…"/></label>
  <label className="checkline section"><input type="checkbox" checked={showFallback} onChange={e=>setShowFallback(e.target.checked)}/>Show company-wide fallback template</label>
  <div className="company-section-directory section">
  {groups.map(section=>{
   const own=routeIndex.get(section.id)
   const inherited=nearestSectionRoute(section,routeSections,routes)
   const effective=own||inherited?.rule
   const recipientIds=effective?members.get(effective.id)||[]:[]
   const scope=coverage.get(section.id)||{totalItems:0,coveredItems:0,overriddenItems:0}
   return <div key={section.id} className="company-section-directory-row section">
    <div className="toolbar" style={{justifyContent:'space-between',alignItems:'center',gap:8}}>
     <div style={{minWidth:0,flex:1}}><strong>{paths.get(section.id)||section.name}</strong>
      <div className="muted tiny">{scope.coveredItems} catalogue items covered · {effective?(effective.route_mode==='rfq'?'RFQ':'Direct PO')+(effective.auto_send?' · auto-send':' · manual'):'No saved route'} · {recipientIds.length} saved recipient{recipientIds.length===1?'':'s'}{!own&&effective?' · inherited':''}</div>
     </div>
     {own?<button type="button" className="btn small" disabled={busy} aria-expanded={editing===section.id} onClick={()=>editing===section.id?setEditing(''):openEditor(section)}>{editing===section.id?'Close template':'Image &amp; caption'}</button>:<span className="muted tiny">{effective?'Edit template at parent group':'Set up in workflow checklist'}</span>}
    </div>
    {own&&<div className="toolbar section" style={{flexWrap:'wrap',gap:6}}>
      <button className="btn small" type="button" disabled={busy||!can(own.route_mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve')} onClick={()=>confirm({
       title:own.route_mode==='rfq'?'Prepare approved-shortage RFQ':'Prepare approved-shortage PO',
       message:'Prepare '+(own.route_mode==='rfq'?'an RFQ':'a direct purchase order')+' for approved outstanding shortages for '+(paths.get(section.id)||section.name)+' using its currently saved route?',
       warning:own.route_mode==='rfq'?'Review and send from the RFQ page; this button does not send RFQ images.':'This creates a purchase order. If this saved route has auto-send enabled, its existing sending behavior may dispatch the order.',
       confirmLabel:own.route_mode==='rfq'?'Prepare RFQ':'Create PO',
       onConfirm:()=>run(()=>prepare(section,own))
      })}>{own.route_mode==='rfq'?'Prepare approved RFQ':'Create approved PO'}</button>
      <button className="btn small" type="button" disabled={busy||recipientIds.length===0||(own.route_mode==='direct'&&recipientIds.length!==1)||!can(own.route_mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve')}
       onClick={()=>confirm({
        title:own.route_mode==='rfq'?'Send approved RFQ images':'Send approved PO images',
        message:'Use the '+recipientIds.length+' saved recipient'+(recipientIds.length===1?'':'s')+' for '+(paths.get(section.id)||section.name)+'? Only approved uncovered shortages may be prepared.',
        warning:'This creates a new RFQ/PO when eligible and attempts sending via WhatsApp. It does not change supplier routing. Check the audit and sending status before retrying.',
        confirmLabel:own.route_mode==='rfq'?'Prepare & send RFQ':'Prepare & send PO',
        onConfirm:()=>run(()=>sendConfiguredRoute(section,own))
       })}>{own.route_mode==='rfq'?'Send RFQ image now':'Send PO image now'}</button>
    </div>}
    {dispatchNotice?.groupId===section.id&&<p role="status" className="notice group-route-feedback">{dispatchNotice.text}</p>}
    {editing===section.id&&own&&<div className="section" aria-label="Document image and WhatsApp caption template">
      <p className="muted tiny">Template only · RFQ/PO type, assigned contacts, recipients and automatic sending cannot be changed here.</p>
      <div className="formgrid section">{[['name','Business heading',80],['title','Document title',60],['note','Remarks / instructions',300],['caption','WhatsApp caption',2000]].map(([key,label,max])=><label key={key} className="field">{label}<textarea aria-label={label} className="input" rows={key==='caption'?4:2} maxLength={max} value={template[key]} onChange={e=>setTemplate(v=>({...v,[key]:e.target.value}))}/></label>)}</div>
      <div className="pillrow section">{[['no','Row number'],['uom','Unit of measure'],['rate','Blank unit-rate column'],['remarks','Item remarks']].map(([key,label])=><label key={key} className="choice-pill"><input type="checkbox" checked={template.fields[key]!==false} onChange={e=>setTemplate(v=>({...v,fields:{...v.fields,[key]:e.target.checked}}))}/>{label}</label>)}</div>
      <p className="muted tiny">Item description and quantity remain included. Supported caption placeholders: {'{company_name}, {supplier_name}, {rfq_number}, {po_number}'}.</p>
      <div className="toolbar"><button className="btn primary" disabled={busy} type="button" onClick={()=>run(saveTemplateOnly)}>{busy?'Saving…':'Save image &amp; caption only'}</button><button type="button" className="btn small" disabled={busy} onClick={()=>setEditing('')}>Cancel</button></div>
    </div>}
   </div>
  })}
  {!groups.length&&<p className="muted tiny">No company category matches your search.</p>}
  </div>
 </section>
 return <details className="card pad section" aria-label="Group supplier routing">
  <summary>Group supplier contacts · RFQ / PO</summary>
  <p className="muted tiny">Assign Supplier 1, Supplier 2 and more to each main group. Subgroups inherit those contacts unless you override them. Next, select which assigned contacts will receive RFQs, or choose one contact for purchase orders. Automatic sending uses the saved routing selection, not every contact in your directory.</p>
  {routeNotice&&<p role="status" className="notice">{routeNotice}</p>}
  {sendResults.length>0&&<div aria-label="Group WhatsApp sending results" className="section">{sendResults.map(result=><p key={result.supplierId} className="tiny">{result.name||'Purchase order'} · <strong>{result.status}</strong> · {result.message}</p>)}</div>}
  {pendingRfq&&<div className="toolbar section"><button className="btn small" disabled={busy} onClick={()=>run(()=>sendRfq(pendingRfq))}>Resume unsent RFQ images</button><button className="btn small" disabled={busy} onClick={()=>navigate('rfq',pendingRfq.rfq_id,3)}>Open {pendingRfq.rfq_no}</button></div>}
  <label className="field section">Find item group / subgroup<input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ALCATHINE, ALCATHINE HOSE…"/></label>
  <label className="checkline section"><input type="checkbox" checked={showFallback} onChange={e=>setShowFallback(e.target.checked)}/>Advanced: show optional company-wide fallback</label>
  <div className="company-section-directory section">
   {groups.map(s=>{
    const own=routeIndex.get(s.id),inherited=nearestSectionRoute(s,routeSections,routes),rule=own||inherited?.rule
    const selectedNames=inheritedContacts(s).map(id=>suppliers.find(v=>v.id===id)?.name||'Unavailable contact')
    const scope=coverage.get(s.id)||{directItems:0,totalItems:0,coveredItems:0,overriddenItems:0,descendantSections:0}
    const isSubgroup=s.id!==companyScope&&!!sections.find(v=>v.id===s.id)?.parent_id
    return <div key={s.id} className="company-section-directory-row" style={{display:'block',marginLeft:isSubgroup?'18px':0,borderLeft:isSubgroup?'3px solid var(--line, #496475)':undefined,paddingLeft:isSubgroup?'12px':undefined}}>
     <div className="toolbar" style={{justifyContent:'space-between',alignItems:'center'}}>
      <div>{isSubgroup&&<span aria-hidden="true">↳ </span>}<strong>{s.name}</strong>
       <div className="muted tiny"><strong>{scope.totalItems} item(s){scope.descendantSections>0?' including nested subgroups':''}</strong>{scope.descendantSections>0?' · '+scope.directItems+' directly assigned':''} · {rule?(rule.route_mode==='rfq'?'RFQ':'Direct PO')+(inherited?.inherited?' · inherited':'') :s.id===companyScope?'Fallback not configured':'No group send rule'}{rule?.auto_send?' · Auto-send':''}</div>
       {scope.descendantSections>0&&<div className="muted tiny">{scope.coveredItems} item(s) covered when routed here · {scope.descendantSections} nested subgroup(s){scope.overriddenItems>0?' · '+scope.overriddenItems+' item(s) use child-specific overrides':''}</div>}
       {selectedNames.length>0&&<div className="muted tiny">{'Group contacts: '+selectedNames.join(' · ')}</div>}</div>
      <button className="btn small" type="button" onClick={()=>editing===s.id?setEditing(''):openEditor(s)}>{editing===s.id?'Close':'Configure'}</button>
     </div>
     {own&&editing!==s.id&&<div className="toolbar section">
      <button type="button" className="btn small" disabled={busy||!can(own.route_mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve')} onClick={()=>confirm({
       title:own.route_mode==='rfq'?'Prepare group RFQ':'Create group purchase order',
       message:'Use approved outstanding requirements from '+(paths.get(s.id)||s.name)+' and its inheriting subgroups ('+scope.coveredItems+' catalogue items in scope)?',
       warning:own.route_mode==='rfq'?'This prepares the RFQ; supplier messages are sent from the RFQ screen.':'Approved orders may be sent automatically if enabled. Check the supplier and quantities.',
       confirmLabel:own.route_mode==='rfq'?'Prepare RFQ':'Create PO',
       onConfirm:()=>run(()=>prepare(s,own))
      })}>{own.route_mode==='rfq'?'Prepare RFQ for approved shortages':'Create direct PO for approved shortages'}</button>
     </div>}
     {editing===s.id&&<div className="section">
      <p className="muted tiny"><strong>Scope: {scope.coveredItems} item(s)</strong> in {paths.get(s.id)||s.name}{scope.descendantSections>0?' and its nested subgroups':''}. {scope.overriddenItems>0?scope.overriddenItems+' item(s) are excluded because their child group has its own routing rule.':'Subgroups inherit the main group contacts and sending rule until individually overridden.'} Only approved outstanding shortages are included when an RFQ or PO is actually prepared.</p>
      <div className="formgrid">
       <label className="checkline"><input type="radio" name={'route-'+s.id} checked={draft.mode==='direct'} onChange={()=>{setDraft(v=>({...v,mode:'direct',auto_send:false,supplier_ids:v.supplier_ids.slice(0,1).length?v.supplier_ids.slice(0,1):groupIds.slice(0,1)}));setTemplate(defaultRouteTemplate('direct'))}}/>Send direct purchase order (one supplier)</label>
       <label className="checkline"><input type="radio" name={'route-'+s.id} checked={draft.mode==='rfq'} onChange={()=>{setDraft(v=>({...v,mode:'rfq',auto_send:false}));setTemplate(defaultRouteTemplate('rfq'))}}/>Request quotation / RFQ (one or more suppliers)</label>
      </div>
      {<label className="checkline section"><input type="checkbox" checked={draft.auto_send} onChange={e=>setDraft(v=>({...v,auto_send:e.target.checked}))}/>{draft.mode==='rfq'?'Automatically create and send RFQ images after stock submission':'Automatically create, approve and send PO images after stock submission'}</label>}
      <p className="section"><strong>1. Assign contacts to this main group / subgroup</strong></p>
      <p className="muted tiny">Keep several supplier numbers here even when your default purchase order goes to only one. Assigned contacts remain available for future RFQs and POs.</p>
      <label className="field section">Search suppliers for this group
       <input className="input" type="search" value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)} placeholder="Supplier name or number…"/>
      </label>
      <div className="formgrid section" style={{maxHeight:250,overflowY:'auto'}}>
       {suppliers.filter(s=>(s.name+' '+(s.phone||'')).toLowerCase().includes(supplierSearch.toLowerCase())).slice(0,70).map(person=><label key={person.id} className="checkline">
        <input type="checkbox" checked={groupIds.includes(person.id)} onChange={e=>toggleGroupContact(person.id,e.target.checked)}/>
        {person.name}{person.contact_person?' · '+person.contact_person:''} · {person.phone||person.whatsapp||'No number'}
       </label>)}
      </div>
      {groupIds.length>0&&<div className="section" aria-label="Assigned group contacts">
       <strong>Assigned contacts ({groupIds.length})</strong>
       {groupIds.map((id,index)=>{
        const person=suppliers.find(s=>s.id===id)
        return <div key={id} className="company-document-row">
         <span><strong>Supplier {index+1}:</strong> {person?.name||'Contact unavailable'}{person?.contact_person?' · '+person.contact_person:''} · {person?.phone||person?.whatsapp||'No number'}</span>
         <div className="toolbar" style={{flexWrap:'wrap'}}>
          <button type="button" className="btn small" disabled={busy||!person} onClick={()=>setEditContactId(id)}>Edit</button>
          <button type="button" className="btn small" disabled={busy} onClick={()=>toggleGroupContact(id,false)}>Remove</button>
         </div>
        </div>
       })}
      </div>}
      <GroupSupplierContactEditor key={editing} suppliers={suppliers} editingSupplier={suppliers.find(s=>s.id===editContactId)||null}
       onCancel={()=>setEditContactId('')} onSaved={contactSaved} flash={flash} fail={fail}/>
      <div className="section" aria-label="Sending recipients">
       <p><strong>2. Choose recipients for this RFQ / PO rule</strong></p>
       <p className="muted tiny">{draft.mode==='direct'?'Choose one preferred PO supplier from the saved group contacts.':'Choose one or more contacts to receive quotation requests. Automatic RFQs use this saved selection.'}</p>
       <div className="formgrid">{groupIds.map(id=>{
        const person=suppliers.find(v=>v.id===id)
        return <label key={id} className="checkline"><input type={draft.mode==='direct'?'radio':'checkbox'} name={draft.mode==='direct'?'po-recipient-'+editing:undefined} checked={draft.supplier_ids.includes(id)} onChange={e=>toggleRecipient(id,e.target.checked)}/>{person?.name||'Unavailable supplier'} · {person?.phone||person?.whatsapp||''}</label>
       })}</div>
      </div>
      <details className="section"><summary>Outgoing image &amp; WhatsApp message</summary>
       <div className="formgrid section">{[['name','Business heading',80],['title','Document title',60],['note','Remarks / instructions',300],['caption','WhatsApp caption',2000]].map(([key,label,max])=><label key={key} className="field">{label}<textarea aria-label={label} className="input" rows={key==='caption'?4:2} maxLength={max} value={template[key]} onChange={e=>setTemplate(v=>({...v,[key]:e.target.value}))}/></label>)}</div>
       <div className="pillrow section">{[['no','Row number'],['uom','Unit of measure'],['rate','Blank unit-rate column'],['remarks','Item remarks']].map(([key,label])=><label key={key} className="choice-pill"><input type="checkbox" checked={template.fields[key]!==false} onChange={e=>setTemplate(v=>({...v,fields:{...v.fields,[key]:e.target.checked}}))}/>{label}</label>)}</div>
       <p className="muted tiny">Description and quantity are always included. Unit-rate blanks can be enabled or disabled; quantity-only POs do not invent prices. Use {'{company_name}, {supplier_name}, {rfq_number}, {po_number}'} in captions. Settings are saved with this route for all stock handlers.</p>
      </details>
      <p className="muted tiny">Saving contacts or a routing rule does not send WhatsApp messages. Sending now requires an <strong>approved shortage not already quoted or ordered</strong>. Automatic sending only runs when enabled.</p>
      <p className="muted tiny">Assigned contacts: {groupIds.length} · Sending recipients: {draft.supplier_ids.length}. Direct POs use one selected supplier; RFQs may use several.</p>
      {dispatchNotice?.groupId===s.id&&<div className="notice group-route-feedback" role="status" aria-label="RFQ or PO sending status">{dispatchNotice.text}</div>}
      <div className="toolbar section group-routing-actions"><button className="btn primary" disabled={busy||!draft.supplier_ids.length||(draft.mode==='direct'&&draft.supplier_ids.length!==1)} onClick={()=>run(()=>save())}>{busy?'Working…':'Save group route'}</button>
       <button type="button" className="btn primary" disabled={busy||!draft.supplier_ids.length||(draft.mode==='direct'&&(!draft.auto_send||draft.supplier_ids.length!==1))||!can(draft.mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve')} onClick={()=>confirm({title:'Save route and send WhatsApp image',message:'Save this group route and send '+(draft.mode==='rfq'?'a quotation request':'an approved quantity-only purchase order')+' to '+draft.supplier_ids.map(id=>suppliers.find(s=>s.id===id)?.name||'supplier').join(', ')+'?',warning:'Only approved outstanding shortages are included. Each supplier receives an image with a caption. RFQs still require quote review before any purchase order.',confirmLabel:'Save route & send image',onConfirm:()=>run(saveAndSend)})}>{busy?'Working…':draft.mode==='rfq'?'Save & send RFQ now':'Save & send PO now'}</button>
       {own&&<button type="button" className="btn bad small" disabled={busy} onClick={()=>confirm({
        title:'Remove group routing override',message:'Remove the custom route for '+(paths.get(s.id)||s.name)+'?',
        warning:'Existing POs and RFQs are retained. Future stock submissions will use the parent or company fallback. Queued unsent direct orders are checked again before sending.',
        confirmLabel:'Remove override',onConfirm:()=>run(()=>removeOverride(s))
       })}>Use inherited / company default</button>}
      </div>
     </div>}
    </div>
   })}
   {!groups.length&&<p className="muted tiny">No section matches. Create item sections first, then assign suppliers.</p>}
  </div>
 </details>
}
