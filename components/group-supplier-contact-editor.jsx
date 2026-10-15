'use client'
import {useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {parseCompanyVcards,toCompanyPhone} from '@/lib/company-contacts.mjs'
import {contactPickerOutcome} from '@/lib/contact-picker-outcome.mjs'
import {planGroupSupplierSave} from '@/lib/group-supplier-contact-plan.mjs'

const empty={name:'',phone:''}

// All device contacts and imported vCards remain client-side. Only the contact
// deliberately saved by the user enters the supplier directory.
export function GroupSupplierContactEditor({suppliers=[],editingSupplier=null,onSaved,onCancel=()=>{},flash=()=>{},fail=()=>{}}){
 const [draft,setDraft]=useState(empty)
 const [imported,setImported]=useState([]),[importSearch,setImportSearch]=useState('')
 const [saving,setSaving]=useState(false),[loadingFile,setLoadingFile]=useState(false)
 const [phonePickerMessage,setPhonePickerMessage]=useState('')
 const fileRef=useRef(null)
 useEffect(()=>{
  if(editingSupplier)setDraft({name:editingSupplier.name||'',phone:editingSupplier.phone||editingSupplier.whatsapp||''})
 },[editingSupplier?.id])
 const plan=planGroupSupplierSave({name:draft.name,phone:draft.phone,editingId:editingSupplier?.id||'',suppliers})
 const existing=plan.action==='reuse'?suppliers.find(s=>s.id===plan.id):null
 const filtered=imported.filter(v=>(v.name+' '+v.phone).toLowerCase().includes(importSearch.toLowerCase())).slice(0,60)

 function setCandidate(contact){
  if(editingSupplier)onCancel()
  setDraft({name:contact.name,phone:contact.phone})
 }
 function addManually(){
  onCancel()
  setDraft(empty)
 }
 async function pickPhoneContact(){
  // Run directly from a user click; awaiting any browser check first can consume
  // the transient activation Chrome requires for its native contact picker.
  setPhonePickerMessage('')
  if(!navigator.contacts?.select){
   setPhonePickerMessage('This browser cannot display phone contacts. Use Import .vcf or enter the contact manually.')
   return
  }
  try{
   const result=contactPickerOutcome({selection:await navigator.contacts.select(['name','tel'],{multiple:false})})
   if(!result.ok){setPhonePickerMessage(result.message);return}
   if(result.contacts.length===1){setCandidate(result.contacts[0]);flash('Contact selected. Check its name and number, then tap Save contact.')}
   else{setImported(result.contacts);setImportSearch('');flash('Choose which number to save.')}
  }catch(error){
   const result=contactPickerOutcome({error})
   setPhonePickerMessage(result.message)
  }
 }
 async function importContacts(file){
  if(!file)return
  setLoadingFile(true)
  try{
   if(file.size>10*1024*1024)throw new Error('Choose a .vcf file smaller than 10 MB. You can also export a single contact.')
   if(!/\.vcf$/i.test(file.name))throw new Error('Import a .vcf contact file exported from your phone.')
   const contacts=parseCompanyVcards(await file.text(),{maxCards:10000})
   if(!contacts.length)throw new Error('The file contains no valid Sri Lankan contact numbers.')
   setImported(contacts);setImportSearch('');setPhonePickerMessage('')
   flash(contacts.length+' contact option(s) found. Pick one, edit its name and save it. The file stays on your device.')
  }catch(error){fail(error)}finally{setLoadingFile(false)}
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
   setDraft(empty);setPhonePickerMessage('')
   if(plan.action==='reuse')flash('Existing supplier linked to this group; the saved name was preserved. Edit that supplier if you need to rename it.')
   else if(plan.action==='update')flash('Supplier contact name and number updated and kept in the group.')
   else flash('Supplier contact saved and selected. Add another supplier or save the group route.')
  }catch(error){fail(error)}finally{setSaving(false)}
 }
 return <section className="section" aria-label="Add or edit group supplier contact">
  <div className="sectionhead"><strong>{editingSupplier?'Edit supplier contact':'Add supplier from phone or manually'}</strong></div>
  <div className="toolbar section" style={{flexWrap:'wrap'}}>
   <button type="button" className="btn small" disabled={saving||loadingFile} onClick={pickPhoneContact}>Pick from phone</button>
   <button type="button" className="btn small" disabled={saving||loadingFile} onClick={()=>fileRef.current?.click()}>Import .vcf</button>
   <button type="button" className="btn small" disabled={saving||loadingFile} onClick={addManually}>Enter manually</button>
   <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard" aria-label="Import supplier phone contacts" style={{display:'none'}} onChange={e=>{const file=e.target.files?.[0];e.target.value='';importContacts(file)}}/>
  </div>
  <p className="muted tiny">The phone picker is controlled by Android. If it closes while searching or says “No contacts found,” use Import .vcf below. Only contacts you explicitly select and save are stored in GH Procurement.</p>
  {phonePickerMessage&&<div role="status" className="section"><p className="muted tiny">{phonePickerMessage}</p><button type="button" className="btn small" onClick={()=>fileRef.current?.click()}>Import a saved contact (.vcf)</button></div>}
  <details className="section"><summary>Phone contacts empty? How to import reliably</summary>
   <p className="muted tiny">Open your phone’s Contacts app, select the supplier, and choose Share contact / Export contact as a vCard (.vcf). Save it to your phone's Files or Downloads. Return here, tap Import .vcf, select the saved file, search the name, then edit and save the supplier. You can also export multiple contacts as one .vcf, then search locally. No address book is uploaded.</p>
   <p className="muted tiny">If Chrome shows no contacts, check that the person is visible in your phone’s Contacts app and that Chrome has access to Contacts in Android App Permissions, where that option is available. The browser may not see contacts from every account or work profile.</p>
  </details>
  {imported.length>0&&<div className="section">
   <label className="field">Search imported contacts
    <input type="search" className="input" value={importSearch} onChange={e=>setImportSearch(e.target.value)} placeholder="Find contact by name or number…"/>
   </label>
   <div className="muted tiny">{imported.length} imported option(s) · Select one to edit and save</div>
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
   <button type="button" className="btn primary" disabled={saving||loadingFile||!plan.valid} onClick={saveContact}>{saving?'Saving…':editingSupplier?'Save contact changes':'Save contact & select'}</button>
   {editingSupplier&&<button type="button" className="btn small" disabled={saving} onClick={addManually}>Cancel edit</button>}
  </div>
 </section>
}
