'use client'
import {useRef,useState} from 'react'
import {parsePastedContact} from '@/lib/pasted-contact.mjs'

export function PasteContact({disabled=false,onApply}){
 const [text,setText]=useState(''),[choices,setChoices]=useState([]),[message,setMessage]=useState(''),[reading,setReading]=useState(false)
 const input=useRef(null),active=useRef(false)
 function apply(contact){
  onApply(contact);setChoices([])
  setMessage(contact.name?'Name and number filled. Review them below, then save.':'Number filled. Enter or check the name below, then save.')
 }
 function extract(value){
  if(value.length<=4000)setText(value)
  const result=parsePastedContact(value)
  if(!result.ok){setChoices([]);setMessage(result.message);return}
  if(result.contacts.length===1)apply(result.contacts[0])
  else{setChoices(result.contacts);setMessage('Choose the number to use.')}
 }
 async function paste(){
  if(active.current||disabled)return
  active.current=true;setReading(true)
  try{
   if(typeof navigator.clipboard?.readText!=='function')throw Error('unavailable')
   extract(await navigator.clipboard.readText())
  }catch{
   setMessage('Press and hold in the box below, then choose Paste. Your contact fields are unchanged.')
   requestAnimationFrame(()=>input.current?.focus())
  }finally{active.current=false;setReading(false)}
 }
 return <div className="section" aria-label="Paste contact">
  <label className="field">Paste contact text
   <textarea aria-label="Paste contact text" ref={input} className="input" rows={2} maxLength={4000} disabled={disabled||reading} value={text} placeholder="Contact name and number, or just the number" onChange={e=>{setText(e.target.value);setChoices([]);setMessage('')}} onPaste={e=>{
    const value=e.clipboardData.getData('text/plain');e.preventDefault();extract(value)
   }}/>
  </label>
  <div className="toolbar section" style={{flexWrap:'wrap'}}>
   <button type="button" className="btn small" disabled={disabled||reading} onClick={paste}>{reading?'Pasting…':'Paste contact'}</button>
   {text.trim()&&<button type="button" className="btn small" disabled={disabled||reading} onClick={()=>extract(text)}>Fill from text</button>}
  </div>
  {message&&<p className="muted tiny" role="status">{message}</p>}
  {choices.length>0&&<div className="section">{choices.map(contact=><button type="button" key={contact.phone} className="btn small" disabled={disabled} onClick={()=>apply(contact)}>Use {contact.phone}</button>)}</div>}
 </div>
}
