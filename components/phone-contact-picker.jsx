'use client'
import {useEffect,useRef,useState} from 'react'
import {openWebContactPicker} from '@/lib/web-contact-picker.mjs'
import {contactPickerOutcome} from '@/lib/contact-picker-outcome.mjs'

export function PhoneContactPicker({disabled=false,onSelected}){
 const [properties,setProperties]=useState(['name','tel'])
 const [pending,setPending]=useState(false),[result,setResult]=useState(null)
 const active=useRef(false),mounted=useRef(true)
 useEffect(()=>{
  mounted.current=true
  // Cache capabilities before the user taps, without delaying their click.
  Promise.resolve().then(()=>navigator.contacts?.getProperties?.()).then(value=>{
   if(mounted.current&&Array.isArray(value))setProperties(value)
  }).catch(()=>{})
  return()=>{mounted.current=false}
 },[])
 async function pick(numberOnly=false){
  if(active.current)return
  active.current=true;setPending(true);setResult(null)
  try{
   const selection=await openWebContactPicker({navigator,window,properties,numberOnly})
   if(!mounted.current)return
   const outcome=contactPickerOutcome({selection})
   setResult(outcome)
   if(outcome.ok)onSelected(outcome.contacts)
  }catch(error){if(mounted.current)setResult(contactPickerOutcome({error}))}
  finally{active.current=false;if(mounted.current)setPending(false)}
 }
 return <div className="section" aria-label="Phone contact selection">
  <div className="toolbar" style={{flexWrap:'wrap'}}>
   <button type="button" className="btn small" disabled={disabled||pending} onClick={()=>pick()}>{pending?'Waiting for phone…':'Pick from phone'}</button>
   <button type="button" className="btn small" disabled={disabled||pending} onClick={()=>pick(true)}>Pick phone number only</button>
  </div>
  <p className="muted tiny">Choose a contact, keep Phone numbers selected, then tap Done. Review the name and number before saving.</p>
  {result&&!result.ok&&<div role="status"><p className="muted tiny">{result.message}</p></div>}
  <details className="section" open={result?.code==='empty'||result?.code==='denied'||undefined}>
   <summary>Contacts empty or picker closing?</summary>
   <ol className="muted tiny">
    <li>Open GH Procurement directly in Chrome on this Android phone.</li>
    <li>In phone Settings → Apps → Chrome → Permissions, allow Contacts if that permission is listed. If another browser opens the app, check that browser instead.</li>
    <li>Confirm the supplier appears in the phone’s Contacts app in the same personal or work profile as the browser.</li>
    <li>Return here and tap Pick phone number only. Enter the contact name if it is not shared.</li>
   </ol>
   <p className="muted tiny">The web app can receive only contacts shared by the browser. It cannot change Android permissions or read contacts the browser does not expose. Your entered details stay in this form when the picker closes. No Google account connection is required.</p>
  </details>
 </div>
}
