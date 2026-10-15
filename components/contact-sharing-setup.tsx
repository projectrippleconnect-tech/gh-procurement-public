'use client'
import {useEffect} from 'react'
export function ContactSharingSetup(){
 useEffect(()=>{
  if('serviceWorker' in navigator&&window.isSecureContext){
   navigator.serviceWorker.register('/gh-contact-share-sw.js',{scope:'/',updateViaCache:'none'}).catch(()=>{})
  }
 },[])
 return null
}
