'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {isCompleteCompanyContact,normalizeCompanyMobile} from '@/lib/company-contact-directory.mjs'
import {contactNameKey,matchContactPhone,duplicateContactNumbers} from '@/lib/contact-duplicates.mjs'

/** One contact per save. Directory membership never changes RFQ or PO recipients. */
export function CompanyContactDirectory({companies=[],active=true,can=()=>false,flash=()=>{},fail=()=>{}}){
 const [expanded,setExpanded]=useState(false)
 const [companyId,setCompanyId]=useState('')
 const [search,setSearch]=useState('')
 const [saved,setSaved]=useState([])
 const [assigned,setAssigned]=useState([])
 const [name,setName]=useState('')
 const [phone,setPhone]=useState('')
 const [loading,setLoading]=useState(false)
 const [saving,setSaving]=useState(false)
 const [status,setStatus]=useState('')
 const [error,setError]=useState('')
 const [reviewedConflict,setReviewedConflict]=useState(false)
 const nameInput=useRef(null)
 const savingLock=useRef(false)
 const canManage=can('company_lists.manage')
 const sorted=useMemo(()=>[...companies].sort((a,b)=>String(a.name).localeCompare(String(b.name),undefined,{sensitivity:'base'})),[companies])
 const visible=useMemo(()=>sorted.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())),[sorted,search])
 const allContacts=useMemo(()=>{
  const companyNames=new Map(sorted.map(c=>[c.id,c.name]))
  const byAssociation=new Map()
  for(const c of saved)byAssociation.set(c.company_id+':'+c.supplier_id,{...c,company_name:companyNames.get(c.company_id)||'Unknown company'})
  for(const c of assigned){
   const key=c.company_id+':'+c.supplier_id
   if(!byAssociation.has(key))byAssociation.set(key,{...c,company_name:companyNames.get(c.company_id)||'Unknown company'})
  }
  return [...byAssociation.values()]
 },[saved,assigned,sorted])
 const duplicateNumbers=useMemo(()=>duplicateContactNumbers(allContacts),[allContacts])
 const existingPhoneMatches=matchContactPhone(allContacts,phone)
 const differentNameMatches=name.trim()?existingPhoneMatches.filter(c=>contactNameKey(c.name)!==contactNameKey(name)):[]
 const needsConflictReview=differentNameMatches.length>0
 const selected=sorted.find(c=>c.id===companyId)||null
 const scopedSaved=saved.filter(r=>r.company_id===companyId)
 const scopedAssigned=assigned.filter(r=>r.company_id===companyId&&!scopedSaved.some(s=>s.supplier_id===r.supplier_id))
 const complete=isCompleteCompanyContact(name,phone)&&name.trim().length<=200
 const canonical=normalizeCompanyMobile(phone)

 useEffect(()=>{
  if(sorted.length&&(!companyId||!sorted.some(c=>c.id===companyId)))setCompanyId(sorted[0].id)
 },[sorted,companyId])

 const load=useCallback(async()=>{
  if(!canManage)return
  setLoading(true)
  try{
   const [dir,groups]=await Promise.all([
    supabase.from('proc_company_contact_directory').select('id,company_id,supplier_id,display_name,created_at').order('created_at'),
    supabase.from('proc_company_group_contacts').select('company_id,supplier_id')
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
  }catch(e){setError(e.message||String(e))}
  finally{setLoading(false)}
 },[canManage,sorted])
 useEffect(()=>{if(expanded&&active&&canManage)load()},[expanded,active,canManage,load])

 function selectCompany(id){
  if(savingLock.current)return
  setCompanyId(id);setName('');setPhone('');setStatus('');setError('');setReviewedConflict(false)
 }
 async function saveContact(e){
  e.preventDefault()
  if(!selected||!complete||savingLock.current||needsConflictReview&&!reviewedConflict)return
  savingLock.current=true
  setSaving(true);setError('');setStatus('')
  try{
   const result=await supabase.rpc('proc_company_directory_save_contact',{
    p_company_id:selected.id,p_display_name:name.trim(),p_phone:canonical
   })
   if(result.error)throw result.error
   if(!result.data?.id||result.data.company_id!==selected.id||result.data.phone!==canonical)throw new Error('The contact save was not confirmed. Check the directory before retrying.')
   await load()
   setStatus((result.data.already_saved?'Contact updated: ':'Saved to database: ')+result.data.name+' · '+result.data.phone)
   setName('');setPhone('');setReviewedConflict(false)
   flash?.('Contact saved to GH Procurement.')
   nameInput.current?.focus()
  }catch(e){setError(e.message||String(e));fail?.(e)}
  finally{savingLock.current=false;setSaving(false)}
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
   <div className="company-directory-company-list" aria-label="Company choices">
    {visible.map(c=><button type="button" key={c.id} className={'btn small '+(c.id===companyId?'company-directory-selected':'')} onClick={()=>selectCompany(c.id)} aria-pressed={c.id===companyId}>{c.name} <span className="muted">{saved.filter(r=>r.company_id===c.id).length}</span></button>)}
    {!visible.length&&<span className="muted tiny">No matching company</span>}
   </div>
   {duplicateNumbers.length>0&&<details className="notice section company-directory-duplicate-warnings">
    <summary role="alert"><strong>⚠️ {duplicateNumbers.length} repeated phone number{duplicateNumbers.length===1?'':'s'} found across the directory</strong> · Tap to review names and companies</summary>
    <div className="stack section">
     {duplicateNumbers.map(group=><div key={group.phone} className="company-directory-record">
      <strong>{group.differentNames?'⚠️ Different contact names':'Possible duplicate / shared contact'} · {group.phone}</strong>
      {group.contacts.map((c,i)=><span key={(c.company_id||'')+':'+(c.supplier_id||c.id||i)}>{c.name} — {c.company_name}</span>)}
     </div>)}
    </div>
   </details>}
   <form onSubmit={saveContact} className="company-directory-form">
    <h4>{selected?.name||'Select a company'}</h4>
    <label className="field" htmlFor="company-directory-name">Contact name</label>
    <input id="company-directory-name" ref={nameInput} className="input" type="text" maxLength={200} autoComplete="off" placeholder="Enter contact person's name" value={name} onChange={e=>{setName(e.target.value);setStatus('');setError('');setReviewedConflict(false)}}/>
    <label className="field" htmlFor="company-directory-phone">WhatsApp number</label>
    <input id="company-directory-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="076 360 9930 or +94763609930" value={phone} onChange={e=>{setPhone(e.target.value);setStatus('');setError('');setReviewedConflict(false)}}/>
    <p className="muted tiny company-directory-number-preview" aria-live="polite">{phone?'Number entered: '+phone+(canonical?' · Save as '+canonical:' · Check the number'):'The full number will appear here as you type.'}</p>
    {existingPhoneMatches.length>0&&<div className="notice section" role="alert">
     <strong>{needsConflictReview?'⚠️ Warning: this number is already saved under a different name.':'This number is already in the directory.'}</strong>
     {existingPhoneMatches.map((c,i)=><div className="muted tiny" key={(c.company_id||'')+':'+(c.supplier_id||c.id||i)}>{c.name} · {c.company_name} · {normalizeCompanyMobile(c.phone||c.whatsapp)}</div>)}
     {needsConflictReview&&<><p className="muted tiny">Review before saving. If this number belongs to the same company, saving may replace its displayed contact name. Other companies and supplier routes will be preserved.</p>
     <label className="field"><input type="checkbox" checked={reviewedConflict} onChange={e=>setReviewedConflict(e.target.checked)}/> I have checked this number and want to save this contact name.</label></>}
    </div>}
    <button type="submit" className="btn primary company-directory-save" disabled={!selected||!complete||saving||(needsConflictReview&&!reviewedConflict)}>{saving?'Saving…':'Save Contact & Add Next'}</button>
    {status&&<p className="success" role="status">{status}</p>}
    {error&&<p className="error" role="alert">{error} Your entries have been kept.</p>}
   </form>
   <div className="company-directory-existing">
    <h4>Existing contacts for {selected?.name||'this company'} <small className="muted">({scopedSaved.length} saved)</small></h4>
    {loading&&<p className="muted tiny">Loading contacts…</p>}
    {!loading&&!scopedSaved.length&&<p className="muted tiny">No directory contacts yet.</p>}
    {scopedSaved.map(c=><div className="company-directory-record" key={c.id}>
     <strong>{c.name}</strong><span>{c.phone}</span><small className="good-text">Saved</small>
    </div>)}
    {scopedAssigned.length>0&&<><h5>Already assigned to routing (not yet in directory)</h5>{scopedAssigned.map(c=><div className="company-directory-record" key={c.company_id+':'+c.supplier_id}><strong>{c.name}</strong><span>{c.phone}</span><small className="muted">{c.source}</small></div>)}</>}
   </div>
  </div>}
 </section>
}
