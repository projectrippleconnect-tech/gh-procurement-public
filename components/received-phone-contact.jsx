'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {pendingPhoneContact,PHONE_SHARE_PENDING} from '@/lib/pending-phone-contact.mjs'

export function ReceivedPhoneContact({onSelected,disabled=false}){
 const [pending,setPending]=useState(null)
 useEffect(()=>{
  let mounted=true
  async function refresh(){
   try{
    const {data}=await supabase.auth.getSession()
    const value=pendingPhoneContact(JSON.parse(localStorage.getItem(PHONE_SHARE_PENDING)||'null'),data.session?.user?.id)
    if(mounted)setPending(value)
   }catch{if(mounted)setPending(null)}
  }
  refresh()
  const events=['storage','focus','gh-phone-contact-shared']
  for(const event of events)window.addEventListener(event,refresh)
  const timer=setInterval(refresh,30000)
  return()=>{mounted=false;clearInterval(timer);for(const event of events)window.removeEventListener(event,refresh)}
 },[])
 function clear(){
  try{const value=JSON.parse(localStorage.getItem(PHONE_SHARE_PENDING)||'null');if(value?.id===pending.id)localStorage.removeItem(PHONE_SHARE_PENDING)}catch{}
  setPending(null);window.dispatchEvent(new Event('gh-phone-contact-shared'))
 }
 async function choose(){
  try{
   const {data}=await supabase.auth.getSession()
   const value=pendingPhoneContact(JSON.parse(localStorage.getItem(PHONE_SHARE_PENDING)||'null'),data.session?.user?.id)
   if(!value||value.id!==pending.id){setPending(null);return}
   onSelected([{name:value.name,phone:value.phone}]);clear()
  }catch{setPending(null)}
 }
 return <div className="section" aria-label="Contact shared from phone">
  <a className="btn small" href="/share/contact" target="_blank" rel="noopener noreferrer">Receive from Contacts app</a>
  {pending&&<div className="section">
   <p>{pending.name} · {pending.phone}</p>
   <p className="muted tiny">Shared from your phone. Choose this contact for the current form, then save to assign it.</p>
   <div className="toolbar" style={{flexWrap:'wrap'}}>
    <button type="button" className="btn small" disabled={disabled} onClick={choose}>Use shared contact here</button>
    <button type="button" className="btn small" disabled={disabled} onClick={clear}>Discard shared contact</button>
   </div>
  </div>}
 </div>
}
