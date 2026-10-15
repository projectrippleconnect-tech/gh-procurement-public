'use client'
import {useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {companyApi} from './company-controls'
import {sectionPaths} from '@/lib/company-section-tree.mjs'
import {GroupSupplierContactEditor} from './group-supplier-contact-editor'
import {defaultSectionRoute,nearestSectionRoute,validateSectionRoute} from '@/lib/company-section-routing.mjs'
import {useDangerConfirmation} from './danger-confirmation'

const initial={mode:'direct',auto_send:true,supplier_ids:[]}
const uniq=ids=>[...new Set(ids.filter(Boolean))]
export function CompanySectionRouteManager({company,sections=[],rows=[],can=()=>false,profile,flash,fail,navigate,onChanged=()=>{}}){
 const confirm=useDangerConfirmation()
 const [routes,setRoutes]=useState([]),[routeSuppliers,setRouteSuppliers]=useState([]),[suppliers,setSuppliers]=useState([])
 const [editing,setEditing]=useState(''),[draft,setDraft]=useState(initial),[search,setSearch]=useState('')
 const [supplierSearch,setSupplierSearch]=useState(''),[editContactId,setEditContactId]=useState('')
 const [busy,setBusy]=useState(false)
 const admin=(profile?.role_key||profile?.role)==='admin'&&can('company_lists.manage')
 const paths=useMemo(()=>sectionPaths(sections),[sections])
 const groups=useMemo(()=>[...sections].filter(s=>s.active!==false&&(paths.get(s.id)||s.name).toLowerCase().includes(search.trim().toLowerCase()))
  .sort((a,b)=>(paths.get(a.id)||a.name).localeCompare(paths.get(b.id)||b.name,undefined,{numeric:true})),[sections,paths,search])
 const routeIndex=useMemo(()=>new Map(routes.map(r=>[r.section_id,r])),[routes])
 const members=useMemo(()=>new Map(routes.map(r=>[r.id,routeSuppliers.filter(v=>v.route_id===r.id).sort((a,b)=>a.sort_order-b.sort_order).map(v=>v.supplier_id)])),[routes,routeSuppliers])
 async function load(){
  if(!company?.id)return
  const [rules,contacts]=await Promise.all([
   supabase.from('proc_company_section_routes').select('*').eq('company_id',company.id),
   supabase.from('proc_suppliers').select('id,name,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name')
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
  setRoutes(rules.data||[])
  setRouteSuppliers(links)
  setSuppliers(contacts.data||[])
 }
 useEffect(()=>{load().catch(fail);setEditing('');setDraft(initial);setSearch('')},[company?.id])
 const openEditor=s=>{
  const existing=routeIndex.get(s.id)
  const ids=existing?members.get(existing.id)||[]:[]
  setEditing(s.id)
  setDraft(existing?{mode:existing.route_mode,auto_send:existing.auto_send,supplier_ids:ids}:
   {mode:defaultSectionRoute(ids.length||1).mode,auto_send:true,supplier_ids:[]})
  setSupplierSearch('')
  setEditContactId('')
 }
 const run=async callback=>{
  if(busy)return
  setBusy(true)
  try{await callback()}catch(e){fail(e)}finally{setBusy(false)}
 }
 async function save(){
  const check=validateSectionRoute({mode:draft.mode,supplierIds:draft.supplier_ids,autoSend:draft.auto_send})
  if(!check.valid)throw new Error(check.reason)
  const ids=check.supplierIds
  const r=await supabase.rpc('proc_company_save_section_route',{
   p_company_id:company.id,p_section_id:editing,p_mode:draft.mode,
   p_auto_send:draft.mode==='direct'&&draft.auto_send,p_supplier_ids:ids
  })
  if(r.error)throw r.error
  await load();await onChanged();setEditing('')
  flash(draft.mode==='direct'?(draft.auto_send?'Direct PO with automatic sending configured.':'Direct PO route saved without automatic sending.'):'RFQ route saved for '+ids.length+' supplier(s).')
 }
 async function removeOverride(section){
  const r=await supabase.rpc('proc_company_clear_section_route',{p_company_id:company.id,p_section_id:section.id})
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
   return {...v,supplier_ids:ids,mode:ids.length>1?'rfq':v.mode,auto_send:ids.length>1?false:v.auto_send}
  })
  setEditContactId('')
 }
 function toggleSupplier(id,checked){
  setDraft(v=>{
   const ids=checked?uniq([...v.supplier_ids,id]):v.supplier_ids.filter(x=>x!==id)
   return {...v,supplier_ids:ids,mode:ids.length>1?'rfq':v.mode,auto_send:ids.length>1?false:v.auto_send}
  })
  if(!checked&&editContactId===id)setEditContactId('')
 }
 async function prepare(s,rule){
  if(rule.route_mode==='rfq'){
   if(!can('procurement.rfq.manage'))throw new Error('RFQ management permission required.')
   const r=await supabase.rpc('proc_company_prepare_group_rfq',{p_company_id:company.id,p_section_id:s.id,p_due_date:null})
   if(r.error)throw r.error
   flash('RFQ '+r.data.rfq_no+' prepared. Review and send it from the RFQ screen.')
   navigate('rfq',r.data.rfq_id,3)
  }else{
   if(!can('procurement.orders.approve'))throw new Error('Purchase order approval permission required.')
   const r=await supabase.rpc('proc_company_prepare_group_po',{p_company_id:company.id,p_section_id:s.id})
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
  <summary>Group suppliers &amp; RFQ / direct PO routing</summary>
  <p className="muted tiny">Set a route for each item group. One supplier can receive an approved direct PO automatically; two or more suppliers can receive separate RFQ invitations. Nested groups inherit their parent route until you override it. Unconfigured groups keep their previous company settings.</p>
  <label className="field section">Find item group<input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Alkathene, PVC, ceiling fittings…"/></label>
  <div className="company-section-directory section">
   {groups.map(s=>{
    const own=routeIndex.get(s.id),inherited=nearestSectionRoute(s,sections,routes),rule=own||inherited?.rule
    const selectedNames=rule?(members.get(rule.id)||[]).map(id=>suppliers.find(v=>v.id===id)?.name||'Unavailable contact'):[]
    const count=rows.filter(r=>r.section_id===s.id).length
    return <div key={s.id} className="company-section-directory-row" style={{display:'block'}}>
     <div className="toolbar" style={{justifyContent:'space-between',alignItems:'center'}}>
      <div><strong>{paths.get(s.id)||s.name}</strong><div className="muted tiny">{count} item(s) directly in this section · {rule?(rule.route_mode==='rfq'?'RFQ':'Direct PO')+(inherited?.inherited?' · inherited':''):'Company fallback route'}{rule?.route_mode==='direct'&&rule.auto_send?' · Auto-send':''}</div>
       {selectedNames.length>0&&<div className="muted tiny">{selectedNames.join(' · ')}</div>}</div>
      <button className="btn small" type="button" onClick={()=>editing===s.id?setEditing(''):openEditor(s)}>{editing===s.id?'Close':'Configure'}</button>
     </div>
     {own&&editing!==s.id&&<div className="toolbar section">
      <button type="button" className="btn small" disabled={busy||!can(own.route_mode==='rfq'?'procurement.rfq.manage':'procurement.orders.approve')} onClick={()=>confirm({
       title:own.route_mode==='rfq'?'Prepare group RFQ':'Create group purchase order',
       message:'Use approved outstanding requirements in '+(paths.get(s.id)||s.name)+'?',
       warning:own.route_mode==='rfq'?'This prepares the RFQ; supplier messages are sent from the RFQ screen.':'Approved orders may be sent automatically if enabled. Check the supplier and quantities.',
       confirmLabel:own.route_mode==='rfq'?'Prepare RFQ':'Create PO',
       onConfirm:()=>run(()=>prepare(s,own))
      })}>{own.route_mode==='rfq'?'Prepare RFQ for approved shortages':'Create direct PO for approved shortages'}</button>
     </div>}
     {editing===s.id&&<div className="section">
      <div className="formgrid">
       <label className="checkline"><input type="radio" name={'route-'+s.id} checked={draft.mode==='direct'} onChange={()=>setDraft(v=>({...v,mode:'direct',auto_send:true}))}/>Send direct purchase order (one supplier)</label>
       <label className="checkline"><input type="radio" name={'route-'+s.id} checked={draft.mode==='rfq'} onChange={()=>setDraft(v=>({...v,mode:'rfq',auto_send:false}))}/>Request quotation / RFQ (one or more suppliers)</label>
      </div>
      {draft.mode==='direct'&&<label className="checkline section"><input type="checkbox" checked={draft.auto_send} onChange={e=>setDraft(v=>({...v,auto_send:e.target.checked}))}/>Automatically approve and send direct POs after a submitted stock count (default on)</label>}
      <label className="field section">Search suppliers for this group
       <input className="input" type="search" value={supplierSearch} onChange={e=>setSupplierSearch(e.target.value)} placeholder="Supplier name or number…"/>
      </label>
      <div className="formgrid section" style={{maxHeight:250,overflowY:'auto'}}>
       {suppliers.filter(s=>(s.name+' '+(s.phone||'')).toLowerCase().includes(supplierSearch.toLowerCase())).slice(0,70).map(person=><label key={person.id} className="checkline">
        <input type="checkbox" checked={draft.supplier_ids.includes(person.id)} onChange={e=>toggleSupplier(person.id,e.target.checked)}/>
        {person.name} · {person.phone||person.whatsapp||'No number'}
       </label>)}
      </div>
      {draft.supplier_ids.length>0&&<div className="section" aria-label="Selected group suppliers">
       <strong>Selected suppliers ({draft.supplier_ids.length})</strong>
       {draft.supplier_ids.map((id,index)=>{
        const person=suppliers.find(s=>s.id===id)
        return <div key={id} className="company-document-row">
         <span><strong>Supplier {index+1}:</strong> {person?.name||'Contact unavailable'} · {person?.phone||person?.whatsapp||'No number'}</span>
         <div className="toolbar" style={{flexWrap:'wrap'}}>
          <button type="button" className="btn small" disabled={busy||!person} onClick={()=>setEditContactId(id)}>Edit</button>
          <button type="button" className="btn small" disabled={busy} onClick={()=>toggleSupplier(id,false)}>Remove</button>
         </div>
        </div>
       })}
      </div>}
      <GroupSupplierContactEditor key={editing} suppliers={suppliers} editingSupplier={suppliers.find(s=>s.id===editContactId)||null}
       onCancel={()=>setEditContactId('')} onSaved={contactSaved} flash={flash} fail={fail}/>
      <p className="muted tiny">Selected: {draft.supplier_ids.length}. Direct POs require exactly one supplier. RFQs keep quotation prices separate and require approval before a PO is made.</p>
      <div className="toolbar section"><button className="btn primary" disabled={busy||!draft.supplier_ids.length||(draft.mode==='direct'&&draft.supplier_ids.length!==1)} onClick={()=>run(save)}>{busy?'Saving…':'Save group route'}</button>
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
