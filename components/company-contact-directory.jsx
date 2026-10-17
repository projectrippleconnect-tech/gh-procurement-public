'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {isCompleteCompanyContact,normalizeCompanyMobile} from '@/lib/company-contact-directory.mjs'
import {ALL_DIRECTORY_COMPANIES,companyDirectoryView} from '@/lib/company-contact-directory-view.mjs'
import {allRows} from '@/lib/query-pages'

/** One contact per save. Directory membership never changes RFQ or PO recipients. */
export function CompanyContactDirectory({companies=[],active=true,can=()=>false,flash=()=>{},fail=()=>{}}){
 const [expanded,setExpanded]=useState(false)
 const [companyId,setCompanyId]=useState(ALL_DIRECTORY_COMPANIES)
 const [search,setSearch]=useState('')
 const [contactSearch,setContactSearch]=useState('')
 const [saved,setSaved]=useState([])
 const [assigned,setAssigned]=useState([])
 const [name,setName]=useState('')
 const [phone,setPhone]=useState('')
 const [loading,setLoading]=useState(false)
 const [saving,setSaving]=useState(false)
 const [status,setStatus]=useState('')
 const [editingId,setEditingId]=useState(null)
 const [editName,setEditName]=useState('')
 const [editPhone,setEditPhone]=useState('')
 const [deleteTargetId,setDeleteTargetId]=useState(null)
 const [changing,setChanging]=useState(false)
 const [error,setError]=useState('')
 const nameInput=useRef(null)
 const savingLock=useRef(false)
 const canManage=can('company_lists.manage')
 const sorted=useMemo(()=>[...companies].sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{sensitivity:'base'})),[companies])
 const visible=useMemo(()=>sorted.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())),[sorted,search])
 const selected=sorted.find(c=>c.id===companyId)||null
 const {savedRows:scopedSaved,assignedRows:scopedAssigned,companyNames}=useMemo(()=>
  companyDirectoryView({saved,assigned,companies:sorted,companyId,query:contactSearch}),
  [saved,assigned,sorted,companyId,contactSearch])
 const complete=isCompleteCompanyContact(name,phone)&&name.trim().length<=200
 const canonical=normalizeCompanyMobile(phone)
 const editCanonical=normalizeCompanyMobile(editPhone)
 const canSaveEdit=isCompleteCompanyContact(editName,editPhone)&&editName.trim().length<=200

 useEffect(()=>{
  if(companyId!==ALL_DIRECTORY_COMPANIES&&!sorted.some(c=>c.id===companyId))setCompanyId(ALL_DIRECTORY_COMPANIES)
 },[sorted,companyId])

 const load=useCallback(async(strict=false)=>{
  if(!canManage)return
  setLoading(true)
  try{
   const [dir,groups]=await Promise.all([
    allRows(()=>supabase.from('proc_company_contact_directory').select('id,company_id,supplier_id,display_name,created_at,updated_at').order('created_at').order('id')),
    allRows(()=>supabase.from('proc_company_group_contacts').select('company_id,supplier_id').order('company_id').order('supplier_id'))
   ])
   if(dir.error)throw dir.error
   if(groups.error)throw groups.error
   const ids=[...new Set([
    ...(dir.data||[]).map(r=>r.supplier_id),
    ...(groups.data||[]).map(r=>r.supplier_id),
    ...sorted.map(c=>c.default_supplier_id)
   ].filter(Boolean))]
   const supplierMap=new Map()
   for(let i=0;i<ids.length;i+=100){
    const r=await supabase.from('proc_suppliers').select('id,name,whatsapp,phone').in('id',ids.slice(i,i+100))
    if(r.error)throw r.error
    for(const supplier of r.data||[])supplierMap.set(supplier.id,supplier)
   }
   const mapped=(dir.data||[]).map(d=>({...d,name:d.display_name,phone:supplierMap.get(d.supplier_id)?.whatsapp||supplierMap.get(d.supplier_id)?.phone||''}))
   setSaved(mapped)
   const asg=new Map()
   for(const c of sorted){
    const s=supplierMap.get(c.default_supplier_id)
    if(s)asg.set(c.id+':'+s.id,{company_id:c.id,supplier_id:s.id,name:s.name,phone:s.whatsapp||s.phone||'',source:'Default supplier'})
   }
   for(const row of groups.data||[]){
    const s=supplierMap.get(row.supplier_id)
    if(s)asg.set(row.company_id+':'+row.supplier_id,{company_id:row.company_id,supplier_id:row.supplier_id,name:s.name,phone:s.whatsapp||s.phone||'',source:'Section supplier route'})
   }
   setAssigned([...asg.values()])
  }catch(e){setError(e.message||String(e));if(strict)throw e}
  finally{setLoading(false)}
 },[canManage,sorted])
 useEffect(()=>{if(expanded&&active&&canManage)load()},[expanded,active,canManage,load])

 function selectCompany(id){
  if(savingLock.current)return
  setCompanyId(id);setName('');setPhone('');setStatus('');setError('');setEditingId(null);setDeleteTargetId(null)
 }
 async function saveContact(e){
  e.preventDefault()
  if(!selected||!complete||savingLock.current)return
  savingLock.current=true
  setSaving(true);setError('');setStatus('');setEditingId(null);setDeleteTargetId(null)
  try{
   const result=await supabase.rpc('proc_company_directory_save_contact',{
    p_company_id:selected.id,p_display_name:name.trim(),p_phone:canonical
   })
   if(result.error)throw result.error
   if(!result.data?.id||result.data.company_id!==selected.id||result.data.phone!==canonical)throw new Error('The contact save was not confirmed. Check the directory before retrying.')
   await load(true)
   setStatus((result.data.already_saved?'Contact updated: ':'Saved to database: ')+result.data.name+' · '+result.data.phone)
   setName('');setPhone('')
   flash?.('Contact saved to GH Procurement.')
   nameInput.current?.focus()
  }catch(e){setError(e.message||String(e));fail?.(e)}
  finally{savingLock.current=false;setSaving(false)}
 }

 function beginEdit(c){
  if(savingLock.current)return
  setEditingId(c.id);setEditName(c.name);setEditPhone(c.phone)
  setDeleteTargetId(null);setStatus('');setError('')
 }
 function cancelEdit(){
  if(savingLock.current)return
  setEditingId(null);setEditName('');setEditPhone('');setError('')
 }
 async function saveEdit(e){
  e.preventDefault()
  const original=saved.find(c=>c.id===editingId&&(c.company_id===companyId||companyId===ALL_DIRECTORY_COMPANIES))
  if(!original||!canSaveEdit||savingLock.current)return
  savingLock.current=true
  setChanging(true);setError('');setStatus('')
  try{
   const result=await supabase.rpc('proc_company_directory_update_contact',{
    p_id:original.id,p_display_name:editName.trim(),p_phone:editCanonical,
    p_expected_updated_at:original.updated_at
   })
   if(result.error)throw result.error
   if(!result.data?.id||result.data.id!==original.id||result.data.phone!==editCanonical)throw new Error('The update was not verified; refresh before retrying.')
   await load(true)
   setEditingId(null);setEditName('');setEditPhone('')
   setStatus(result.data.routing_unchanged
    ?'Contact updated. This number changed only in the directory. An existing RFQ/PO route still uses the old number—review the company supplier route separately.'
    :'Contact updated and saved in GH Procurement.')
   flash?.('Company directory contact updated.')
  }catch(e){setError(e.message||String(e))}
  finally{savingLock.current=false;setChanging(false)}
 }
 async function removeContact(c){
  if(!c||savingLock.current)return
  savingLock.current=true
  setChanging(true);setError('');setStatus('')
  try{
   const result=await supabase.rpc('proc_company_directory_delete_contact',{
    p_id:c.id,p_expected_updated_at:c.updated_at
   })
   if(result.error)throw result.error
   if(result.data?.id!==c.id||!result.data.deleted_from_directory)throw new Error('Deletion could not be verified. Refresh the directory.')
   await load(true)
   setDeleteTargetId(null);setEditingId(null)
   setStatus(result.data.routing_unchanged
    ?'Removed from the company directory. The supplier remains assigned to an existing RFQ/PO route, which was not changed.'
    :'Removed from the company directory. Existing order history and supplier records are preserved.')
   flash?.('Company contact removed from directory.')
  }catch(e){setError(e.message||String(e))}
  finally{savingLock.current=false;setChanging(false)}
 }

 if(!canManage)return null
 return <section className="card pad section company-directory-panel">
  <button type="button" className="company-directory-toggle" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>
   <span>Company Supplier Directory <small>· one-at-a-time saving</small></span>
   <span aria-hidden="true">{expanded?'−':'+'}</span>
  </button>
  {expanded&&<div className="company-directory-body section">
   <p className="muted tiny">Each Save Contact writes directly to the database. Draft entries are NOT saved until you press Save. Existing RFQ/PO routes are not changed.</p>
   <label className="field" htmlFor="company-directory-search">Find a company</label>
   <input id="company-directory-search" className="input" placeholder="Search all companies…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <button type="button" className={'btn small company-directory-all-button '+(companyId===ALL_DIRECTORY_COMPANIES?'company-directory-selected':'')} onClick={()=>selectCompany(ALL_DIRECTORY_COMPANIES)} aria-pressed={companyId===ALL_DIRECTORY_COMPANIES}>All Companies <span className="muted">· {sorted.length} companies · {saved.length} saved</span></button>
   <div className="company-directory-company-list" aria-label="Company choices">
    {visible.map(c=><button type="button" key={c.id} className={'btn small '+(c.id===companyId?'company-directory-selected':'')} onClick={()=>selectCompany(c.id)} aria-pressed={c.id===companyId}>{c.name} <span className="muted">{saved.filter(r=>r.company_id===c.id).length}</span></button>)}
    {!visible.length&&<span className="muted tiny">No matching company</span>}
   </div>
   <label className="field" htmlFor="company-directory-contact-search">Search directory contacts</label>
   <input id="company-directory-contact-search" className="input" type="search" placeholder="Search name, number or company…" value={contactSearch} onChange={e=>setContactSearch(e.target.value)}/>
   {companyId===ALL_DIRECTORY_COMPANIES
    ? <p className="muted tiny company-directory-all-hint">Showing contacts across all companies. Select a company above to add a new contact.</p>
    : <form onSubmit={saveContact} className="company-directory-form">
    <h4>{selected?.name||'Select a company'}</h4>
    <label className="field" htmlFor="company-directory-name">Contact name</label>
    <input id="company-directory-name" ref={nameInput} className="input" type="text" maxLength={200} autoComplete="off" placeholder="Enter contact person's name" value={name} onChange={e=>{setName(e.target.value);setStatus('');setError('')}}/>
    <label className="field" htmlFor="company-directory-phone">WhatsApp number</label>
    <input id="company-directory-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="076 360 9930 or +94763609930" value={phone} onChange={e=>{setPhone(e.target.value);setStatus('');setError('')}}/>
    <p className="muted tiny company-directory-number-preview" aria-live="polite">{phone?'Number entered: '+phone+(canonical?' · Save as '+canonical:' · Check the number'):'The full number will appear here as you type.'}</p>
    <button type="submit" className="btn primary company-directory-save" disabled={!selected||!complete||saving}>{saving?'Saving…':'Save Contact & Add Next'}</button>
   </form>}
   {status&&<p className="success" role="status">{status}</p>}
   {error&&<p className="error" role="alert">{error} Review the existing directory before retrying.</p>}
   <div className="company-directory-existing">
    <h4>{companyId===ALL_DIRECTORY_COMPANIES?'All Companies · Supplier Directory':'Existing contacts for '+selected?.name} <small className="muted">({scopedSaved.length} saved)</small></h4>
    {loading&&<p className="muted tiny">Loading contacts…</p>}
    {!loading&&!scopedSaved.length&&<p className="muted tiny">No directory contacts yet.</p>}
    {scopedSaved.map((c,index)=><div className="company-directory-entry" key={c.id}>
     {companyId===ALL_DIRECTORY_COMPANIES&&(index===0||scopedSaved[index-1].company_id!==c.company_id)&&<h5 className="company-directory-group-heading">{companyNames.get(c.company_id)||'Other company'}</h5>}
     <div className="company-directory-record company-directory-compact-row">
      <strong className="company-directory-contact-name" title={c.name}>{c.name}</strong>
      <span className="company-directory-contact-phone" title={c.phone}>{c.phone}</span>
      <div className="company-directory-record-actions">
       <button type="button" className="btn small company-directory-icon-button" aria-label={'Edit '+c.name} title={'Edit '+c.name} disabled={changing} onClick={()=>beginEdit(c)}>✎</button>
       <button type="button" className="btn small bad company-directory-icon-button" aria-label={'Delete '+c.name} title={'Delete '+c.name} disabled={changing} onClick={()=>{setDeleteTargetId(c.id);setEditingId(null);setError('');setStatus('')}}>×</button>
      </div>
     </div>
     {editingId===c.id&&<form className="company-directory-form company-directory-edit-form" onSubmit={saveEdit}>
      <h5>Edit {c.name}</h5>
      <label className="field" htmlFor={'company-edit-name-'+c.id}>Contact name / title</label>
      <input id={'company-edit-name-'+c.id} className="input" type="text" maxLength={200} value={editName} onChange={e=>setEditName(e.target.value)}/>
      <label className="field" htmlFor={'company-edit-number-'+c.id}>WhatsApp number</label>
      <input id={'company-edit-number-'+c.id} className="input" type="tel" inputMode="tel" value={editPhone} onChange={e=>setEditPhone(e.target.value)}/>
      <p className="muted tiny company-directory-number-preview" aria-live="polite">{editPhone?'Number entered: '+editPhone+(editCanonical?' · Save as '+editCanonical:' · Invalid number'):'Enter the contact number.'}</p>
      <p className="muted tiny">Edits change this company’s directory entry only. Existing RFQ/PO recipients and historical orders are not changed.</p>
      <div className="company-directory-inline-actions">
       <button className="btn primary" type="submit" disabled={!canSaveEdit||changing}>{changing?'Saving…':'Save Changes'}</button>
       <button type="button" className="btn" disabled={changing} onClick={cancelEdit}>Cancel</button>
      </div>
     </form>}
     {deleteTargetId===c.id&&<div className="company-directory-confirm" role="group" aria-label={'Confirm removal of '+c.name}>
      <strong>Remove {c.name} from {companyNames.get(c.company_id)||selected?.name||'this company'}?</strong>
      <p>This removes only this company’s directory entry. The supplier record, existing RFQ/PO routes and order history stay intact.</p>
      <div className="company-directory-inline-actions">
       <button type="button" className="btn bad" disabled={changing} onClick={()=>removeContact(c)}>{changing?'Removing…':'Yes, Remove'}</button>
       <button type="button" className="btn" disabled={changing} onClick={()=>setDeleteTargetId(null)}>Cancel</button>
      </div>
     </div>}
    </div>)}
    {scopedAssigned.length>0&&<><h5>Already assigned to routing (not yet in directory)</h5>{scopedAssigned.map((c,index)=><div className="company-directory-route-entry" key={c.company_id+':'+c.supplier_id}>
     {companyId===ALL_DIRECTORY_COMPANIES&&(index===0||scopedAssigned[index-1].company_id!==c.company_id)&&<h5 className="company-directory-group-heading">{companyNames.get(c.company_id)||'Other company'}</h5>}
     <div className="company-directory-record company-directory-compact-row company-directory-compact-route" title={c.source}><strong className="company-directory-contact-name" title={c.name}>{c.name}</strong><span className="company-directory-contact-phone" title={c.phone}>{c.phone}</span></div>
    </div>)}</>}
   </div>
  </div>}
 </section>
}
