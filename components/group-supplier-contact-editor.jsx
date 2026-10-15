'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {PhoneContactPicker} from './phone-contact-picker'
import {planGroupSupplierSave} from '@/lib/group-supplier-contact-plan.mjs'

const empty={name:'',phone:''}

// Shared phone contacts remain client-side. Only the contact
// deliberately saved by the user enters the supplier directory.
export function GroupSupplierContactEditor({suppliers=[],editingSupplier=null,onSaved,onCancel=()=>{},flash=()=>{},fail=()=>{}}){
 const [draft,setDraft]=useState(empty)
 const [imported,setImported]=useState([]),[importSearch,setImportSearch]=useState('')
 const [saving,setSaving]=useState(false)
 useEffect(()=>{
  if(editingSupplier)setDraft({name:editingSupplier.name||'',phone:editingSupplier.phone||editingSupplier.whatsapp||''})
 },[editingSupplier?.id])
 const plan=planGroupSupplierSave({name:draft.name,phone:draft.phone,editingId:editingSupplier?.id||'',suppliers})
 const existing=plan.action==='reuse'?suppliers.find(s=>s.id===plan.id):null
 const filtered=imported.filter(v=>(v.name+' '+v.phone).toLowerCase().includes(importSearch.toLowerCase())).slice(0,60)

 function setCandidate(contact){
  if(editingSupplier)onCancel()
  setDraft({name:contact.name,phone:contact.phone});setImported([])
 }
 function addManually(){
  onCancel()
  setDraft(empty)
 }
 async function saveContact(){
  if(saving)return
  if(!plan.valid){fail(new Error(plan.error));return}
  setSaving(true)
  try{
   let id=plan.id
   if(plan.action==='create'){
    const r=await supabase.from('proc_suppliers').insert({
     supplier_code:'CO-'+crypto.randomUUID().slice(0,8).toUpperCase(),
     name:plan.name,phone:plan.phone,whatsapp:plan.phone,supplier_kind:'company',active:true
    }).select('id').single()
    if(r.error)throw r.error
    id=r.data.id
   }else if(plan.action==='update'){
    // Supplier identity is unchanged; associated POs/RFQs and group links remain intact.
    const r=await supabase.from('proc_suppliers').update({
     name:plan.name,phone:plan.phone,whatsapp:plan.phone
    }).eq('id',plan.id).eq('supplier_kind','company').select('id').single()
    if(r.error)throw r.error
   }
   await onSaved(id,plan.action)
   setDraft(empty)
   if(plan.action==='reuse')flash('Existing supplier linked to this group; the saved name was preserved. Edit that supplier if you need to rename it.')
   else if(plan.action==='update')flash('Supplier contact name and number updated and kept in the group.')
   else flash('Supplier contact saved and selected. Add another supplier or save the group route.')
  }catch(error){fail(error)}finally{setSaving(false)}
 }
 return <section className="section" aria-label="Add or edit group supplier contact">
  <div className="sectionhead"><strong>{editingSupplier?'Edit supplier contact':'Add supplier from phone or manually'}</strong></div>
  <div className="toolbar section" style={{flexWrap:'wrap'}}>
   <button type="button" className="btn small" disabled={saving} onClick={addManually}>Enter manually</button>
  </div>
  <PhoneContactPicker disabled={saving} onSelected={people=>{
   if(people.length===1){setCandidate(people[0]);flash('Contact selected. Review the name and number, then save.')}
   else{setImported(people);setImportSearch('')}
  }}/>
  {imported.length>0&&<div className="section">
   <label className="field">Choose a shared phone number
    <input type="search" className="input" value={importSearch} onChange={e=>setImportSearch(e.target.value)} placeholder="Find contact by name or number…"/>
   </label>
   <div className="muted tiny">{imported.length} shared number(s) · Select one to edit and save</div>
   <div style={{maxHeight:230,overflowY:'auto'}} aria-label="Imported supplier contacts">
    {filtered.map(v=><div key={v.phone} className="company-document-row"><span>{v.name} · {v.phone}</span>
     <button type="button" className="btn small" disabled={saving} onClick={()=>setCandidate(v)}>Choose</button></div>)}
   </div>
  </div>}
  <div className="formgrid section">
   <label className="field">Supplier / contact name
    <input className="input" autoComplete="off" maxLength={160} value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} placeholder="Supplier contact name"/>
   </label>
   <label className="field">Phone / WhatsApp
    <input className="input" type="tel" inputMode="tel" autoComplete="off" value={draft.phone} onChange={e=>setDraft(v=>({...v,phone:e.target.value}))} placeholder="+94771234567"/>
   </label>
  </div>
  {editingSupplier&&<p className="muted tiny">Editing this saved supplier updates its name and number wherever it is already assigned. Existing order history and supplier IDs are preserved.</p>}
  {existing&&<p className="muted tiny">This number is already saved as <strong>{existing.name}</strong>. Saving will select that supplier without renaming it. To change the saved name, choose Edit beside the selected supplier.</p>}
  {!plan.valid&&draft.name.trim()&&draft.phone.trim()&&<p className="muted tiny" role="status">{plan.error}</p>}
  <div className="toolbar section">
   <button type="button" className="btn primary" disabled={saving||!plan.valid} onClick={saveContact}>{saving?'Saving…':editingSupplier?'Save contact changes':'Save contact & select'}</button>
   {editingSupplier&&<button type="button" className="btn small" disabled={saving} onClick={addManually}>Cancel edit</button>}
  </div>
 </section>
}
