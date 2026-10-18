'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {isCompleteCompanyContact,normalizeCompanyMobile} from '@/lib/company-contact-directory.mjs'
import {ALL_DIRECTORY_COMPANIES,companyDirectoryView} from '@/lib/company-contact-directory-view.mjs'
import {allRows} from '@/lib/query-pages'
import {contactNameKey,matchContactPhone,duplicateContactNumbers} from '@/lib/contact-duplicates.mjs'

/** One contact per save. Directory membership never changes RFQ or PO recipients. */
export function CompanyContactDirectory({companies=[],active=true,can=()=>false,flash=()=>{},fail=()=>{},onReviewRouting=()=>{}}){
 const [expanded,setExpanded]=useState(false)
 const [companyId,setCompanyId]=useState(ALL_DIRECTORY_COMPANIES)
 const [search,setSearch]=useState('')
 const [saved,setSaved]=useState([])
 const [assigned,setAssigned]=useState([])
 const [name,setName]=useState('')
 const [phone,setPhone]=useState('')
 const [loading,setLoading]=useState(false)
 const [saving,setSaving]=useState(false)
 const [status,setStatus]=useState('')
 const [routingReviewNeeded,setRoutingReviewNeeded]=useState(false)
 const [editingId,setEditingId]=useState(null)
 const [editName,setEditName]=useState('')
 const [editPhone,setEditPhone]=useState('')
 const [deleteTargetId,setDeleteTargetId]=useState(null)
 const [changing,setChanging]=useState(false)
 const [error,setError]=useState('')
 const [reviewedAddConflict,setReviewedAddConflict]=useState(false)
 const [reviewedEditConflict,setReviewedEditConflict]=useState(false)
 const nameInput=useRef(null)
 const savingLock=useRef(false)
 const canManage=can('company_lists.manage')
 const sorted=useMemo(()=>[...companies].sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{sensitivity:'base'})),[companies])
 const visible=useMemo(()=>{
  const q=search.trim().toLocaleLowerCase()
  if(!q)return sorted
  return sorted.filter(c=>c.name.toLocaleLowerCase().includes(q)||
   [...saved,...assigned].some(item=>item.company_id===c.id&&[item.name,item.phone].some(v=>String(v||'').toLocaleLowerCase().includes(q))))
 },[sorted,search,saved,assigned])
 const selected=sorted.find(c=>c.id===companyId)||null
 const {savedRows:scopedSaved,assignedRows:scopedAssigned,companyNames}=useMemo(()=>
  companyDirectoryView({saved,assigned,companies:sorted,companyId,query:search}),
  [saved,assigned,sorted,companyId,search])
 const allContacts=useMemo(()=>{
  const view=companyDirectoryView({saved,assigned,companies:sorted,companyId:ALL_DIRECTORY_COMPANIES,query:''})
  return [...view.savedRows,...view.assignedRows].map(c=>({...c,company_name:view.companyNames.get(c.company_id)||'Unknown company'}))
 },[saved,assigned,sorted])
 const duplicateNumbers=useMemo(()=>duplicateContactNumbers(allContacts),[allContacts])
 const addPhoneMatches=matchContactPhone(allContacts,phone)
 const addNameConflicts=name.trim()?addPhoneMatches.filter(c=>contactNameKey(c.name)!==contactNameKey(name)):[]
 const needsAddReview=addNameConflicts.length>0
 const editPhoneMatches=matchContactPhone(allContacts,editPhone).filter(c=>c.id!==editingId)
 const editNameConflicts=editName.trim()?editPhoneMatches.filter(c=>contactNameKey(c.name)!==contactNameKey(editName)):[]
 const needsEditReview=editNameConflicts.length>0
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
  setCompanyId(id);setName('');setPhone('');setStatus('');setError('');setEditingId(null);setDeleteTargetId(null);setReviewedAddConflict(false);setReviewedEditConflict(false);setRoutingReviewNeeded(false)
 }
 async function saveContact(e){
  e.preventDefault()
  if(!selected||!complete||savingLock.current)return
  if(needsAddReview&&!reviewedAddConflict)return
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
   setName('');setPhone('');setReviewedAddConflict(false);setRoutingReviewNeeded(true)
   flash?.('Contact saved to GH Procurement.')
   nameInput.current?.focus()
  }catch(e){setError(e.message||String(e));fail?.(e)}
  finally{savingLock.current=false;setSaving(false)}
 }

 function beginEdit(c){
  if(savingLock.current)return
  setEditingId(c.id);setEditName(c.name);setEditPhone(c.phone);setReviewedEditConflict(false)
  setDeleteTargetId(null);setStatus('');setError('')
 }
 function cancelEdit(){
  if(savingLock.current)return
  setEditingId(null);setEditName('');setEditPhone('');setError('');setReviewedEditConflict(false)
 }
 async function saveEdit(e){
  e.preventDefault()
  const original=saved.find(c=>c.id===editingId&&(c.company_id===companyId||companyId===ALL_DIRECTORY_COMPANIES))
  if(!original||!canSaveEdit||savingLock.current||(needsEditReview&&!reviewedEditConflict))return
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
   setEditingId(null);setEditName('');setEditPhone('');setReviewedEditConflict(false)
   setRoutingReviewNeeded(!!result.data.routing_unchanged)
   setStatus(result.data.routing_unchanged
    ?'Contact updated in directory, but an RFQ/PO route still uses the previous supplier number. Review routing before sending a new order.'
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
   setRoutingReviewNeeded(!!result.data.routing_unchanged)
   setStatus(result.data.routing_unchanged
    ?'Removed from directory only. This supplier is still assigned to an RFQ/PO route: review that route separately.'
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
   <p className="muted tiny">Each Save Contact writes directly to the database. Draft entries are NOT saved until Save. Contacts join the company’s available supplier pool, but new auto-send RFQ/PO recipients require explicit selection in Workflow Settings; existing orders remain unchanged.</p>
   <label className="field" htmlFor="company-directory-search">Find a company or contact</label>
   <input id="company-directory-search" className="input" type="search" placeholder="Search company, contact name or phone…" value={search} onChange={e=>setSearch(e.target.value)}/>
   <button type="button" className={'btn small company-directory-all-button '+(companyId===ALL_DIRECTORY_COMPANIES?'company-directory-selected':'')} onClick={()=>selectCompany(ALL_DIRECTORY_COMPANIES)} aria-pressed={companyId===ALL_DIRECTORY_COMPANIES}>All Companies <span className="muted">· {sorted.length} companies · {saved.length} saved</span></button>
   <div className="company-directory-company-list" aria-label="Company choices">
    {visible.map(c=><button type="button" key={c.id} className={'btn small '+(c.id===companyId?'company-directory-selected':'')} onClick={()=>selectCompany(c.id)} aria-pressed={c.id===companyId}>{c.name} <span className="muted">{saved.filter(r=>r.company_id===c.id).length}</span></button>)}
    {!visible.length&&<span className="muted tiny">No matching company</span>}
   </div>
   {duplicateNumbers.length>0&&<details className="notice section company-directory-duplicate-warnings">
    <summary role="alert"><strong>⚠️ {duplicateNumbers.length} repeated number{duplicateNumbers.length===1?'':'s'} across the supplier directory</strong> · Tap to inspect names and companies</summary>
    <div className="stack section">
     {duplicateNumbers.map(group=><div className="company-directory-record" key={group.phone}>
      <strong>{group.differentNames?'⚠️ Same number, different names':'Possible duplicate / shared contact'} · {group.phone}</strong>
      {group.contacts.map((c,i)=><span key={(c.company_id||'')+':'+(c.supplier_id||c.id||i)}>{c.name} — {c.company_name}</span>)}
     </div>)}
    </div>
   </details>}
   {companyId===ALL_DIRECTORY_COMPANIES
    ? <p className="muted tiny company-directory-all-hint">Showing contacts across all companies. Select a company above to add a new contact.</p>
    : <form onSubmit={saveContact} className="company-directory-form">
    <h4>{selected?.name||'Select a company'}</h4>
    <label className="field" htmlFor="company-directory-name">Contact name</label>
    <input id="company-directory-name" ref={nameInput} className="input" type="text" maxLength={200} autoComplete="off" placeholder="Enter contact person's name" value={name} onChange={e=>{setName(e.target.value);setStatus('');setError('');setReviewedAddConflict(false)}}/>
    <label className="field" htmlFor="company-directory-phone">WhatsApp number</label>
    <input id="company-directory-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="076 360 9930 or +94763609930" value={phone} onChange={e=>{setPhone(e.target.value);setStatus('');setError('');setReviewedAddConflict(false)}}/>
    <p className="muted tiny company-directory-number-preview" aria-live="polite">{phone?'Number entered: '+phone+(canonical?' · Save as '+canonical:' · Check the number'):'The full number will appear here as you type.'}</p>
    {addPhoneMatches.length>0&&<div className="notice section" role="alert">
     <strong>{needsAddReview?'⚠️ Warning: this number is already saved under a different name.':'This number is already in the supplier directory.'}</strong>
     {addPhoneMatches.map((c,i)=><div className="muted tiny" key={(c.company_id||'')+':'+(c.supplier_id||c.id||i)}>{c.name} · {c.company_name} · {normalizeCompanyMobile(c.phone||c.whatsapp)}</div>)}
     {needsAddReview&&<><p className="muted tiny">Review the contact before saving. If this is the same number within this company, saving can replace its directory display name. Existing supplier routing will not be changed.</p>
      <label className="field"><input type="checkbox" checked={reviewedAddConflict} onChange={e=>setReviewedAddConflict(e.target.checked)}/> I reviewed the existing number and still want to save this name.</label></>}
    </div>}
    <button type="submit" className="btn primary company-directory-save" disabled={!selected||!complete||saving||(needsAddReview&&!reviewedAddConflict)}>{saving?'Saving…':'Save Contact & Add Next'}</button>
   </form>}
   {status&&<p className="success" role="status">{status}</p>}
    {routingReviewNeeded&&<button type="button" className="btn small" onClick={()=>onReviewRouting(companyId===ALL_DIRECTORY_COMPANIES?null:companyId)}>Review / assign RFQ &amp; PO recipients →</button>}
   {error&&<p className="error" role="alert">{error} Review the existing directory before retrying.</p>}
   <div className="company-directory-existing">
    <h4>{companyId===ALL_DIRECTORY_COMPANIES?'All Companies · Supplier Directory':'Existing contacts for '+selected?.name} <small className="muted">({scopedSaved.length} saved)</small></h4>
    {loading&&<p className="muted tiny">Loading contacts…</p>}
    {!loading&&!scopedSaved.length&&<p className="muted tiny">No directory contacts yet.</p>}
    {scopedSaved.map((c,index)=><div className="company-directory-entry" key={c.id}>
     {companyId===ALL_DIRECTORY_COMPANIES&&(index===0||scopedSaved[index-1].company_id!==c.company_id)&&<h5 className="company-directory-group-heading">{companyNames.get(c.company_id)||'Other company'}</h5>}
     <div className="company-directory-record company-directory-compact-row">
      <strong className="company-directory-contact-name" title={c.name}>{c.name}{duplicateNumbers.some(g=>g.contacts.some(x=>x.company_id===c.company_id&&x.supplier_id===c.supplier_id))&&<small title="This number appears on multiple contact records"> ⚠️</small>}</strong>
      <span className="company-directory-contact-phone" title={c.phone}>{c.phone}</span>
      <div className="company-directory-record-actions">
       <button type="button" className="btn small company-directory-icon-button" aria-label={'Edit '+c.name} title={'Edit '+c.name} disabled={changing} onClick={()=>beginEdit(c)}>✎</button>
       <button type="button" className="btn small bad company-directory-icon-button" aria-label={'Delete '+c.name} title={'Delete '+c.name} disabled={changing} onClick={()=>{setDeleteTargetId(c.id);setEditingId(null);setError('');setStatus('')}}>×</button>
      </div>
     </div>
     {editingId===c.id&&<form className="company-directory-form company-directory-edit-form" onSubmit={saveEdit}>
      <h5>Edit {c.name}</h5>
      <label className="field" htmlFor={'company-edit-name-'+c.id}>Contact name / title</label>
      <input id={'company-edit-name-'+c.id} className="input" type="text" maxLength={200} value={editName} onChange={e=>{setEditName(e.target.value);setReviewedEditConflict(false)}}/>
      <label className="field" htmlFor={'company-edit-number-'+c.id}>WhatsApp number</label>
      <input id={'company-edit-number-'+c.id} className="input" type="tel" inputMode="tel" value={editPhone} onChange={e=>{setEditPhone(e.target.value);setReviewedEditConflict(false)}}/>
      <p className="muted tiny company-directory-number-preview" aria-live="polite">{editPhone?'Number entered: '+editPhone+(editCanonical?' · Save as '+editCanonical:' · Invalid number'):'Enter the contact number.'}</p>
      {editPhoneMatches.length>0&&<div className="notice section" role="alert">
       <strong>{needsEditReview?'⚠️ Warning: this number is already used under another contact name.':'This number already appears elsewhere in the directory.'}</strong>
       {editPhoneMatches.map((x,i)=><div className="muted tiny" key={(x.company_id||'')+':'+(x.supplier_id||x.id||i)}>{x.name} · {x.company_name} · {normalizeCompanyMobile(x.phone||x.whatsapp)}</div>)}
       {needsEditReview&&<label className="field"><input type="checkbox" checked={reviewedEditConflict} onChange={e=>setReviewedEditConflict(e.target.checked)}/> I reviewed the existing number and still want to save this edit.</label>}
      </div>}
      <p className="muted tiny">Edits change this company’s directory entry only. Existing RFQ/PO recipients and historical orders are not changed.</p>
      <div className="company-directory-inline-actions">
       <button className="btn primary" type="submit" disabled={!canSaveEdit||changing||(needsEditReview&&!reviewedEditConflict)}>{changing?'Saving…':'Save Changes'}</button>
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
