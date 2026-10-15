'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useDangerConfirmation} from './danger-confirmation'
import {parseCompanyVcards,toCompanyPhone} from '@/lib/company-contacts.mjs'
import {interpretContactPickerResult,contactPickerStatusMessage} from '@/lib/device-contact-picker.mjs'
import {PhoneContactImportHelp} from './phone-contact-import-help'

export function CompanyContactManager({company,canManage=false,flash=()=>{},fail=()=>{},onChanged=()=>{}}){
 const confirmDanger=useDangerConfirmation()
 const [contacts,setContacts]=useState([]),[search,setSearch]=useState(''),[fileSearch,setFileSearch]=useState('')
 const [imported,setImported]=useState([]),[draft,setDraft]=useState({name:'',phone:''}),[editId,setEditId]=useState('')
 const [busy,setBusy]=useState(false),[open,setOpen]=useState(false)
 const [pickerStatus,setPickerStatus]=useState(''),[showPickerHelp,setShowPickerHelp]=useState(false)
 const fileRef=useRef(null)
 const load=useCallback(async()=>{
  if(!company?.id)return
  const r=await supabase.from('proc_suppliers').select('id,name,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name')
  if(r.error)throw r.error
  setContacts(r.data||[])
 },[company?.id])
 useEffect(()=>{load().catch(fail)},[load,fail])
 const current=contacts.find(s=>s.id===company?.default_supplier_id)
 const selectedPhone=toCompanyPhone(current?.phone||current?.whatsapp)
 const savedResults=search.trim()?contacts.filter(s=>(s.name+' '+(s.phone||'')+' '+(s.whatsapp||'')).toLowerCase().includes(search.trim().toLowerCase())).slice(0,15):[]
 const importedResults=imported.filter(c=>(c.name+' '+c.phone).toLowerCase().includes(fileSearch.trim().toLowerCase())).slice(0,40)
 async function perform(action){
  if(busy)return
  setBusy(true)
  try{await action()}catch(error){fail(error)}finally{setBusy(false)}
 }
 async function link(id){
  const r=await supabase.from('proc_companies').update({default_supplier_id:id||null,updated_at:new Date().toISOString()}).eq('id',company.id).select('id').single()
  if(r.error)throw r.error
  setSearch('');setDraft({name:'',phone:''});setEditId('');setImported([])
  await onChanged()
  flash(id?'Designated company contact saved.':'Company contact unlinked. Existing supplier and order history is preserved.')
 }
 function startEdit(){
  if(!current)return
  setDraft({name:current.name||'',phone:current.phone||current.whatsapp||''})
  setEditId(current.id);setOpen(true)
 }
 function selectCandidate(person){
  setDraft({name:person.name,phone:person.phone});setEditId('');setOpen(true);setImported([]);setPickerStatus('')
 }
 async function pickFromPhone(){
  if(!navigator.contacts?.select){
   setPickerStatus('unsupported');setShowPickerHelp(true)
   return
  }
  try{
   // Native Android may close its contact search without returning a contact.
   // Leave the existing company contact and any typed details untouched.
   const selected=await navigator.contacts.select(['name','tel'],{multiple:false})
   const result=interpretContactPickerResult({selected})
   if(result.status!=='selected'){setPickerStatus(result.status);setShowPickerHelp(true);return}
   if(result.choices.length===1)selectCandidate(result.choices[0])
   else{setImported(result.choices);setFileSearch('');setOpen(true);setPickerStatus('')}
  }catch(error){
   const result=interpretContactPickerResult({error})
   setPickerStatus(result.status);setShowPickerHelp(true)
  }
 }
 async function importVcf(file){
  if(!file)return
  if(file.size>5*1024*1024)throw new Error('Select a .vcf contacts file smaller than 5 MB.')
  if(!/\.vcf$/i.test(file.name))throw new Error('Only .vcf contact files are supported.')
  const parsed=parseCompanyVcards(await file.text())
  if(!parsed.length)throw new Error('The file has no valid Sri Lankan phone numbers.')
  setImported(parsed);setFileSearch('');setOpen(true);setPickerStatus('')
  flash(parsed.length+' contact number(s) available. Search and choose one to save; the file is not uploaded.')
 }
 async function saveDraft(){
  const name=draft.name.trim()
  const phone=toCompanyPhone(draft.phone)
  if(!name||!phone)throw new Error('Enter a contact name and a valid Sri Lankan phone number (+94 followed by 9 digits).')
  if(editId){
   // Edits to a shared supplier contact intentionally propagate to other company references.
   const r=await supabase.from('proc_suppliers').update({name,phone,whatsapp:phone}).eq('id',editId).eq('supplier_kind','company').select('id').single()
   if(r.error)throw r.error
   await load()
   setDraft({name:'',phone:''});setEditId('');flash('Company contact name and number updated. Any other company using this supplier sees the update.')
   return
  }
  const existing=contacts.find(c=>toCompanyPhone(c.phone||c.whatsapp)===phone)
  if(existing){await link(existing.id);flash('Existing supplier with this phone number linked. Use Edit to change its name.');return}
  const created=await supabase.from('proc_suppliers').insert({
   supplier_code:'CO-'+crypto.randomUUID().slice(0,8).toUpperCase(),
   name,phone,whatsapp:phone,supplier_kind:'company',active:true
  }).select('id').single()
  if(created.error)throw created.error
  await link(created.data.id)
  await load()
 }
 if(!company?.id)return null
 return <section className="card pad section" aria-label="Designated company contact">
  <div className="sectionhead"><div><strong>Designated company contact</strong>
   <div className="muted tiny">{current?<>{current.name} · {current.phone||current.whatsapp||'No number'}</>:'No company contact assigned'}</div>
  </div>{canManage&&<button type="button" className="btn small" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{open?'Close':'Manage contact'}</button>}</div>
  {selectedPhone&&<div className="toolbar"><a className="btn small" href={'tel:'+selectedPhone}>Call</a>{/^\+947\d{8}$/.test(selectedPhone)&&<a className="btn small" href={'https://wa.me/'+selectedPhone.slice(1)} target="_blank" rel="noopener noreferrer">WhatsApp</a>}</div>}
  {canManage&&open&&<div className="section">
   <div className="toolbar">
    <button type="button" className="btn small" disabled={busy} onClick={()=>perform(pickFromPhone)}>Pick from phone</button>
    <button type="button" className="btn small" disabled={busy} onClick={()=>fileRef.current?.click()}>Import .vcf</button>
    <input ref={fileRef} type="file" accept=".vcf,text/vcard,text/x-vcard,application/vcard" aria-label="Import phone contact file" style={{display:'none'}} onChange={e=>{const file=e.target.files?.[0];e.target.value='';perform(()=>importVcf(file))}}/>
    {current&&<><button type="button" className="btn small" disabled={busy} onClick={startEdit}>Edit current</button><button type="button" className="btn small bad" disabled={busy} onClick={()=>confirmDanger({title:'Remove designated contact',message:'Unlink '+(current?.name||'this contact')+' from '+company.name+'?',warning:'Supplier records and past orders remain untouched. Automatic company orders may need another designated contact.',confirmLabel:'Remove company link',onConfirm:()=>link(null)})}>Remove from company</button></>}
   </div>
   <p className="muted tiny">Phone contacts are selected through Android's native picker where supported. If the picker closes or shows no contacts, your company contact and typed details are kept. Import a saved .vcf or enter the number instead.</p>
   {pickerStatus&&<p className="muted tiny" role="status">{contactPickerStatusMessage(pickerStatus)}</p>}
   <button type="button" className="btn small section" onClick={()=>setShowPickerHelp(v=>!v)} aria-expanded={showPickerHelp}>{showPickerHelp?'Hide import instructions':'Picker shows no contacts? See how to import'}</button>
   <PhoneContactImportHelp visible={showPickerHelp}/>
   <label className="field">Search saved company contacts
    <input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search name or number…"/>
   </label>
   {savedResults.length>0&&<div className="section" aria-label="Saved company contact results">{savedResults.map(person=><div key={person.id} className="company-document-row"><span>{person.name} · {person.phone||person.whatsapp}</span><button type="button" className="btn small" disabled={busy} onClick={()=>perform(()=>link(person.id))}>Use for this company</button></div>)}</div>}
   {imported.length>0&&<div className="section">
    <label className="field">Search contacts from phone / .vcf
     <input className="input" type="search" value={fileSearch} onChange={e=>setFileSearch(e.target.value)} placeholder="Search imported contacts…"/>
    </label>
    <div className="muted tiny">{imported.length} option(s); choose one. Unselected contacts stay on this device.</div>
    {importedResults.map(person=><div className="company-document-row" key={person.phone}><span>{person.name} · {person.phone}</span><button type="button" className="btn small" onClick={()=>selectCandidate(person)}>Choose</button></div>)}
   </div>}
   <div className="formgrid section">
    <label className="field">Contact name<input className="input" autoComplete="off" value={draft.name} onChange={e=>setDraft(v=>({...v,name:e.target.value}))} placeholder="Company contact name"/></label>
    <label className="field">Contact number<input className="input" type="tel" inputMode="tel" autoComplete="off" value={draft.phone} onChange={e=>setDraft(v=>({...v,phone:e.target.value}))} placeholder="+94771234567"/></label>
   </div>
   {editId&&<p className="muted tiny">Editing this supplier changes its details in existing supplier references too. Removing the company link does not delete the supplier.</p>}
   <div className="toolbar">
    <button type="button" className="btn primary" disabled={busy||!draft.name.trim()||!draft.phone.trim()} onClick={()=>perform(saveDraft)}>{busy?'Saving…':editId?'Save contact changes':'Save & assign contact'}</button>
    <button type="button" className="btn small" disabled={busy} onClick={()=>{setDraft({name:'',phone:''});setEditId('');setImported([])}}>Clear</button>
   </div>
  </div>}
 </section>
}
