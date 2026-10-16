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
export function CompanySectionRouteManager({company,sections=[],rows=[],can=()=>false,profile,flash,fail,navigate,onChanged=()=>{}}){
 const confirm=useDangerConfirmation()
 const [routes,setRoutes]=useState([]),[routeSuppliers,setRouteSuppliers]=useState([]),[suppliers,setSuppliers]=useState([])
 const [template,setTemplate]=useState(defaultRouteTemplate('rfq'))
 const routeSections=useMemo(()=>[{id:companyScope,name:'Entire company · default contacts',active:true,parent_id:null},...sections.map(s=>({...s,parent_id:s.parent_id||companyScope}))],[sections])
 const [editing,setEditing]=useState(''),[draft,setDraft]=useState(initial),[search,setSearch]=useState('')
 const [supplierSearch,setSupplierSearch]=useState(''),[editContactId,setEditContactId]=useState('')
 const [busy,setBusy]=useState(false),[sendResults,setSendResults]=useState([]),[pendingRfq,setPendingRfq]=useState(null),[routeNotice,setRouteNotice]=useState('')
 const running=useRef(false)
 const admin=(profile?.role_key||profile?.role)==='admin'&&can('company_lists.manage')
 const paths=useMemo(()=>sectionPaths(sections),[sections])
 const groups=useMemo(()=>[...routeSections].filter(s=>s.active!==false&&(paths.get(s.id)||s.name).toLowerCase().includes(search.trim().toLowerCase()))
  .sort((a,b)=>(paths.get(a.id)||a.name).localeCompare(paths.get(b.id)||b.name,undefined,{numeric:true})),[routeSections,paths,search])
 const routeIndex=useMemo(()=>new Map(routes.map(r=>[r.section_id,r])),[routes])
 const coverage=useMemo(()=>new Map(routeSections.filter(s=>s.active!==false).map(s=>[s.id,sectionRouteCoverage(s.id,routeSections,rows.map(r=>({...r,section_id:r.section_id||companyScope})),routes)])),[routeSections,rows,routes])
 const members=useMemo(()=>new Map(routes.map(r=>[r.id,routeSuppliers.filter(v=>v.route_id===r.id).sort((a,b)=>a.sort_order-b.sort_order).map(v=>v.supplier_id)])),[routes,routeSuppliers])
 async function load(){
  if(!company?.id)return
  const [rules,contacts]=await Promise.all([
   supabase.from('proc_company_section_routes').select('*').eq('company_id',company.id),
   supabase.from('proc_suppliers').select('id,name,contact_person,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name')
  ])
  if(rules.error)throw rules.error
  if(contacts.error)throw contacts.error
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
 }
 useEffect(()=>{load().catch(fail);setEditing('');setDraft(initial);setSearch('');setPendingRfq(null);setSendResults([]);setRouteNotice('')},[company?.id])
 const openEditor=s=>{
  const existing=routeIndex.get(s.id)||nearestSectionRoute(s,routeSections,routes)?.rule
  const ids=existing?members.get(existing.id)||[]:[]
  setEditing(s.id)
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
  const check=validateSectionRoute({mode:draft.mode,supplierIds:draft.supplier_ids,autoSend:draft.auto_send})
  if(!check.valid)throw new Error(check.reason)
  const ids=check.supplierIds
  const r=await supabase.rpc('proc_company_save_route_v2',{
   p_company_id:company.id,p_section_id:editing===companyScope?null:editing,p_mode:draft.mode,
   p_auto_send:draft.auto_send,p_supplier_ids:ids,p_template:routeTemplate(template,draft.mode)
  })
  if(r.error)throw r.error
  setRouteNotice('Group route saved.');
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
   if(r.error)throw new Error('Route saved. '+r.error.message)
   setPendingRfq(r.data)
   setRouteNotice('Route saved. RFQ '+r.data.rfq_no+' prepared; sending images…')
   await sendRfq(r.data)
   setRouteNotice('Route saved. RFQ '+r.data.rfq_no+' — see each supplier’s sending result below.')
  }else{
   const r=await supabase.rpc('proc_company_prepare_route_po',{p_company_id:company.id,p_section_id:sectionId})
   if(r.error)throw new Error('Route saved. '+r.error.message)
   setRouteNotice('Route saved. Direct PO prepared.')
   const sent=await companyApi('orders',{companyId:company.id,poIds:(r.data||[]).map(po=>po.id)})
   setSendResults((sent.outcomes||[]).map(outcome=>({...outcome,supplierId:outcome.id,message:outcome.error||'Image and caption accepted by WhatsApp.'})))
  }
  setEditing('')
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
  setDraft(v=>{
   const ids=uniq([...v.supplier_ids,id])
   return {...v,supplier_ids:ids,mode:ids.length>1?'rfq':v.mode,auto_send:ids.length>1&&v.mode!=='rfq'?false:v.auto_send}
  })
  setEditContactId('')
 }
 function toggleSupplier(id,checked){
  setDraft(v=>{
   const ids=checked?uniq([...v.supplier_ids,id]):v.supplier_ids.filter(x=>x!==id)
   return {...v,supplier_ids:ids,mode:ids.length>1?'rfq':v.mode,auto_send:ids.length>1&&v.mode!=='rfq'?false:v.auto_send}
  })
  if(!checked&&editContactId===id)setEditContactId('')
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
 return <details className="card pad section" aria-label="Group supplier routing">
  <summary>Company / category contacts &amp; automatic RFQ / PO</summary>
  <p className="muted tiny">Choose the entire company or a category below, add its supplier contacts, then choose RFQ or PO. Set a route for each item group. One supplier can receive an approved direct PO automatically; two or more suppliers can receive separate RFQ invitations. Nested groups inherit their parent route until you override it. Unconfigured groups keep their previous company settings.</p>
  {routeNotice&&<p role="status" className="notice">{routeNotice}</p>}
  {sendResults.length>0&&<div aria-label="Group WhatsApp sending results" className="section">{sendResults.map(result=><p key={result.supplierId} className="tiny">{result.name||'Purchase order'} · <strong>{result.status}</strong> · {result.message}</p>)}</div>}
  {pendingRfq&&<div className="toolbar section"><button className="btn small" disabled={busy} onClick={()=>run(()=>sendRfq(pendingRfq))}>Resume unsent RFQ images</button><button className="btn small" disabled={busy} onClick={()=>navigate('rfq',pendingRfq.rfq_id,3)}>Open {pendingRfq.rfq_no}</button></div>}
  <label className="field section">Find company / category<input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Alkathene, PVC, ceiling fittings…"/></label>
  <div className="company-section-directory section">
   {groups.map(s=>{
    const own=routeIndex.get(s.id),inherited=nearestSectionRoute(s,routeSections,routes),rule=own||inherited?.rule
    const selectedNames=rule?(members.get(rule.id)||[]).map(id=>suppliers.find(v=>v.id===id)?.name||'Unavailable contact'):[]
    const scope=coverage.get(s.id)||{directItems:0,totalItems:0,coveredItems:0,overriddenItems:0,descendantSections:0}
    return <div key={s.id} className="company-section-directory-row" style={{display:'block'}}>
     <div className="toolbar" style={{justifyContent:'space-between',alignItems:'center'}}>
      <div><strong>{paths.get(s.id)||s.name}</strong>
       <div className="muted tiny"><strong>{scope.totalItems} item(s){scope.descendantSections>0?' including nested subgroups':''}</strong>{scope.descendantSections>0?' · '+scope.directItems+' directly assigned':''} · {rule?(rule.route_mode==='rfq'?'RFQ':'Direct PO')+(inherited?.inherited?' · inherited':''):'Company fallback route'}{rule?.auto_send?' · Auto-send':''}</div>
       {scope.descendantSections>0&&<div className="muted tiny">{scope.coveredItems} item(s) covered when routed here · {scope.descendantSections} nested subgroup(s){scope.overriddenItems>0?' · '+scope.overriddenItems+' item(s) use child-specific overrides':''}</div>}
       {selectedNames.length>0&&<div className="muted tiny">{selectedNames.join(' · ')}</div>}</div>
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
      <p className="muted tiny"><strong>Scope: {scope.coveredItems} item(s)</strong> in {paths.get(s.id)||s.name}{scope.descendantSections>0?' and its nested subgroups':''}. {scope.overriddenItems>0?scope.overriddenItems+' item(s) are excluded because their child group has its own routing rule.':'Child groups inherit this route unless you override them individually.'} Only approved outstanding shortages are included when an RFQ or PO is actually prepared.</p>
      <div className="formgrid">
       <label className="checkline"><input type="radio" name={'route-'+s.id} checked={draft.mode==='direct'} onChange={()=>{setDraft(v=>({...v,mode:'direct',auto_send:false}));setTemplate(defaultRouteTemplate('direct'))}}/>Send direct purchase order (one supplier)</label>
       <label className="checkline"><input type="radio" name={'route-'+s.id} checked={draft.mode==='rfq'} onChange={()=>{setDraft(v=>({...v,mode:'rfq',auto_send:false}));setTemplate(defaultRouteTemplate('rfq'))}}/>Request quotation / RFQ (one or more suppliers)</label>
      </div>
      {<label className="checkline section"><input type="checkbox" checked={draft.auto_send} onChange={e=>setDraft(v=>({...v,auto_send:e.target.checked}))}/>{draft.mode==='rfq'?'Automatically create and send RFQ images after stock submission':'Automatically create, approve and send PO images after stock submission'}</label>}
      <label className="field section">Search suppliers for this group
       <input className="input" type="search" value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)} placeholder="Supplier name or number…"/>
      </label>
      <div className="formgrid section" style={{maxHeight:250,overflowY:'auto'}}>
       {suppliers.filter(s=>(s.name+' '+(s.phone||'')).toLowerCase().includes(supplierSearch.toLowerCase())).slice(0,70).map(person=><label key={person.id} className="checkline">
        <input type="checkbox" checked={draft.supplier_ids.includes(person.id)} onChange={e=>toggleSupplier(person.id,e.target.checked)}/>
        {person.name}{person.contact_person?' · '+person.contact_person:''} · {person.phone||person.whatsapp||'No number'}
       </label>)}
      </div>
      {draft.supplier_ids.length>0&&<div className="section" aria-label="Selected group suppliers">
       <strong>Selected suppliers ({draft.supplier_ids.length})</strong>
       {draft.supplier_ids.map((id,index)=>{
        const person=suppliers.find(s=>s.id===id)
        return <div key={id} className="company-document-row">
         <span><strong>Supplier {index+1}:</strong> {person?.name||'Contact unavailable'}{person?.contact_person?' · '+person.contact_person:''} · {person?.phone||person?.whatsapp||'No number'}</span>
         <div className="toolbar" style={{flexWrap:'wrap'}}>
          <button type="button" className="btn small" disabled={busy||!person} onClick={()=>setEditContactId(id)}>Edit</button>
          <button type="button" className="btn small" disabled={busy} onClick={()=>toggleSupplier(id,false)}>Remove</button>
         </div>
        </div>
       })}
      </div>}
      <GroupSupplierContactEditor key={editing} suppliers={suppliers} editingSupplier={suppliers.find(s=>s.id===editContactId)||null}
       onCancel={()=>setEditContactId('')} onSaved={contactSaved} flash={flash} fail={fail}/>
      <details className="section"><summary>Outgoing image &amp; WhatsApp message</summary>
       <div className="formgrid section">{[['name','Business heading',80],['title','Document title',60],['note','Remarks / instructions',300],['caption','WhatsApp caption',2000]].map(([key,label,max])=><label key={key} className="field">{label}<textarea aria-label={label} className="input" rows={key==='caption'?4:2} maxLength={max} value={template[key]} onChange={e=>setTemplate(v=>({...v,[key]:e.target.value}))}/></label>)}</div>
       <div className="pillrow section">{[['no','Row number'],['uom','Unit of measure'],['rate','Blank unit-rate column'],['remarks','Item remarks']].map(([key,label])=><label key={key} className="choice-pill"><input type="checkbox" checked={template.fields[key]!==false} onChange={e=>setTemplate(v=>({...v,fields:{...v.fields,[key]:e.target.checked}}))}/>{label}</label>)}</div>
       <p className="muted tiny">Description and quantity are always included. Unit-rate blanks can be enabled or disabled; quantity-only POs do not invent prices. Use {'{company_name}, {supplier_name}, {rfq_number}, {po_number}'} in captions. Settings are saved with this route for all stock handlers.</p>
      </details>
      <p className="muted tiny">Save group route stores the settings only. Save route &amp; send WhatsApp image also prepares and sends the current approved shortages. Future direct POs use the automatic-send setting above.</p>
      <p className="muted tiny">Selected: {draft.supplier_ids.length}. Direct POs require exactly one supplier. RFQs keep quotation prices separate and require approval before a PO is made.</p>
      <div className="toolbar section"><button className="btn primary" disabled={busy||!draft.supplier_ids.length||(draft.mode==='direct'&&draft.supplier_ids.length!==1)} onClick={()=>run(()=>save())}>{busy?'Working…':'Save group route'}</button>
       <button type="button" className="btn primary" disabled={busy||!draft.supplier_ids.length||(draft.mode==='direct'&&(!draft.auto_send||draft.supplier_ids.length!==1))||!can(draft.mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve')} onClick={()=>confirm({title:'Save route and send WhatsApp image',message:'Save this group route and send '+(draft.mode==='rfq'?'a quotation request':'an approved quantity-only purchase order')+' to '+draft.supplier_ids.map(id=>suppliers.find(s=>s.id===id)?.name||'supplier').join(', ')+'?',warning:'Only approved outstanding shortages are included. Each supplier receives an image with a caption. RFQs still require quote review before any purchase order.',confirmLabel:'Save route & send image',onConfirm:()=>run(saveAndSend)})}>{busy?'Working…':'Save route & send WhatsApp image'}</button>
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
