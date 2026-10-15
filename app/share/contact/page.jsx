'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {parseSharedPhoneContact} from '@/lib/shared-phone-contact.mjs'
import {PHONE_SHARE_CACHE,PHONE_SHARE_PREFIX,PHONE_SHARE_PENDING,PHONE_SHARE_TTL} from '@/lib/pending-phone-contact.mjs'

const errors={'too-large':'The shared contact is too large. Share one contact at a time.','too-many':'Share one contact at a time.','empty':'No supported contact was shared.','unavailable':'The contact could not be received. Try sharing it again.','not-ready':'Open the installed web app once, then share the contact again.'}
export default function SharedContactPage(){
 const [people,setPeople]=useState([]),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[userId,setUserId]=useState(''),[shareId,setShareId]=useState(''),[selected,setSelected]=useState(null)
 useEffect(()=>{
  let mounted=true
  const params=new URLSearchParams(location.search),id=params.get('share')||''
  async function auth(){const {data}=await supabase.auth.getSession();if(mounted)setUserId(data.session?.user?.id||'')}
  auth().catch(()=>{})
  window.addEventListener('focus',auth)
  async function load(){
   if(params.has('error'))setMessage(errors[params.get('error')]||'Contact could not be received.')
   if(!/^[a-f0-9]{32}$/.test(id))return
   setShareId(id)
   const cache=await caches.open(PHONE_SHARE_CACHE),key=new URL(PHONE_SHARE_PREFIX+id,location.origin).href
   const stored=await cache.match(key)
   if(!stored){setMessage('This shared contact is no longer available. Share it again from Contacts.');return}
   const payload=await stored.json()
   if(!Number.isFinite(payload.createdAt)||Date.now()-payload.createdAt>PHONE_SHARE_TTL){await cache.delete(key);setMessage('The shared contact has expired. Share it again.');return}
   const parsed=parseSharedPhoneContact(payload)
   if(!mounted)return
   setPeople(parsed)
   if(!parsed.length)setMessage('No valid Sri Lankan phone number was received. Share a contact containing a local phone number.')
  }
  load().catch(()=>{if(mounted)setMessage('This browser could not read the shared contact. Open the installed web app and try again.')})
  navigator.serviceWorker?.ready.then(()=>{if(mounted)setReady(true)}).catch(()=>{})
  return()=>{mounted=false;window.removeEventListener('focus',auth)}
 },[])
 async function useContact(){
  if(!selected||!userId)return
  try{
   const {data}=await supabase.auth.getSession()
   if(data.session?.user?.id!==userId){setMessage('Sign in to GH Procurement, then return here.');return}
   const cache=await caches.open(PHONE_SHARE_CACHE),key=new URL(PHONE_SHARE_PREFIX+shareId,location.origin).href
   const stored=await cache.match(key),payload=stored&&await stored.json()
   if(!payload||Date.now()-payload.createdAt>PHONE_SHARE_TTL){setMessage('The contact has expired. Share it again.');setPeople([]);return}
   localStorage.setItem(PHONE_SHARE_PENDING,JSON.stringify({...selected,id:shareId,userId,createdAt:Date.now()}))
   await cache.delete(key)
   location.assign('/?phoneContactShared=1')
  }catch{setMessage('The browser could not keep this contact. Please share it again.')}
 }
 async function discard(){
  if(shareId){const cache=await caches.open(PHONE_SHARE_CACHE);await cache.delete(new URL(PHONE_SHARE_PREFIX+shareId,location.origin).href)}
  setPeople([]);setSelected(null);setMessage('Shared contact discarded.')
 }
 return <main className="content" style={{maxWidth:680,margin:'0 auto',paddingTop:32}}>
  <section className="card pad">
   <h1>Receive a phone contact</h1>
   <p>Choose the supplier in your phone’s Contacts app and share it to the installed GH Procurement web app.</p>
   {message&&<p role="status">{message}</p>}
   {people.length>0?<>
    <h2>Review shared contact</h2>
    <p className="muted">Choose the number to use. Nothing is saved to your supplier directory yet.</p>
    {people.map(person=><label className="checkline section" key={person.phone} style={{overflowWrap:'anywhere'}}><input type="radio" name="shared-contact" checked={selected?.phone===person.phone} onChange={()=>setSelected(person)}/><span>{person.name} · {person.phone}</span></label>)}
    {!userId&&<p>Sign in to <a href="/" target="_blank" rel="noopener noreferrer">GH Procurement</a>, then return to this page.</p>}
    <div className="toolbar section" style={{flexWrap:'wrap'}}>
     <button type="button" className="btn primary" disabled={!selected||!userId} onClick={useContact}>Continue with this contact</button>
     <button type="button" className="btn small" onClick={()=>discard().catch(()=>setMessage('Could not discard; the contact will expire automatically.'))}>Discard</button>
    </div>
    <p className="muted tiny">Next: open the company or group contact form, tap Use shared contact here, review and save.</p>
   </>:<>
    <ol>
     <li>In Chrome, open GH Procurement and use ⋮ → Add to home screen → Install. This feature needs the installed web app.</li>
     <li>Open the installed app once. {ready?'The contact receiver is ready in this browser.':'Preparing the contact receiver…'}</li>
     <li>Open your phone’s Contacts app, select the supplier, tap Share contact, and choose GH Procurement.</li>
     <li>Review the received name and number, then return to your company or group contact form.</li>
    </ol>
    <p className="muted tiny">If GH Procurement is missing from the share menu, an old home-screen shortcut may need to be replaced by installing this updated web app.</p>
   </>}
   <p className="muted tiny">Shared contacts expire after 5 minutes. Only the contact you explicitly save is added to the supplier directory.</p>
   <a href="/">Open GH Procurement</a>
  </section>
 </main>
}
