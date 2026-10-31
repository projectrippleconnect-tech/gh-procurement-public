'use client'
import {useEffect} from 'react'
// Retire only our former contact-sharing worker; leave other app storage intact.
export function LegacyContactShareCleanup(){
 useEffect(()=>{
  try{localStorage.removeItem('gh_phone_contact_pending_v1')}catch{}
  if('serviceWorker' in navigator){
   navigator.serviceWorker.getRegistration('/').then(registration=>{
    const worker=registration?.active||registration?.waiting||registration?.installing
    if(worker&&new URL(worker.scriptURL).pathname==='/gh-contact-share-sw.js')registration?.update().catch(()=>{})
   }).catch(()=>{})
  }
 },[])
 return null
}
