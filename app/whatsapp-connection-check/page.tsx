'use client'

import {useCallback,useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'

type Result={status:string;detail:string;connected:boolean;checkedAt:string}
const issueText:Record<string,string>={
 WAHA_BASE_URL_MISSING:'The server does not have a gateway URL. Check WAHA_BASE_URL in Netlify production Functions.',
 WAHA_API_KEY_MISSING:'The server cannot read WAHA_API_KEY. Confirm the secret is scoped to production Functions and redeploy.',
 WAHA_SESSION_INVALID:'WAHA_SESSION is invalid. Use default.',
 WAHA_BASE_URL_INVALID:'The gateway URL is malformed. Use https://gh-procurement-waha.hostless.app without a path or query.',
 WAHA_ALLOWED_HOST_MISMATCH:'WAHA_ALLOWED_HOST does not match the gateway URL hostname.',
 WAHA_BASE_URL_NOT_ALLOWED:'The gateway URL failed the HTTPS and hostname safety checks.'
}

export default function WhatsAppConnectionCheck(){
 const[result,setResult]=useState<Result|null>(null)
 const[busy,setBusy]=useState(false)
 const check=useCallback(async()=>{
  setBusy(true)
  try{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session?.access_token){
    setResult({status:'SIGN_IN_REQUIRED',detail:'Sign in to GH Procurement as an administrator in this browser, then return here.',connected:false,checkedAt:new Date().toLocaleTimeString()})
    return
   }
   const response=await fetch('/api/integrations/whatsapp/pair',{
    headers:{Authorization:'Bearer '+session.access_token},cache:'no-store',signal:AbortSignal.timeout(15000)
   })
   const data=await response.json().catch(()=>({}))
   const reason=String(data.reason||data.error||'')
   setResult({
    status:String(data.status||('HTTP '+response.status)),
    detail:issueText[reason]||reason||(response.ok?'Netlify reached the configured WhatsApp session.':'Gateway status request failed.'),
    connected:data.connected===true,
    checkedAt:new Date().toLocaleTimeString()
   })
  }catch{
   setResult({status:'REQUEST_FAILED',detail:'Could not reach the Netlify connection check. Check your network, then retry.',connected:false,checkedAt:new Date().toLocaleTimeString()})
  }finally{setBusy(false)}
 },[])
 useEffect(()=>{void check()},[check])
 return <main style={{maxWidth:640,margin:'0 auto',padding:'28px 20px',fontFamily:'system-ui,sans-serif'}}>
  <h1>GH Procurement · WhatsApp Connection Check</h1>
  <p>Administrator-only, read-only check. This page never starts a session or sends a message.</p>
  <p><a href="/">Return to GH Procurement</a></p>
  <button type="button" disabled={busy} onClick={()=>void check()} style={{padding:'12px 18px',fontWeight:700}}>{busy?'Checking…':'Refresh connection status'}</button>
  {result&&<section aria-live="polite" style={{marginTop:20,padding:16,border:'1px solid #888',borderRadius:10}}>
   <strong>Session: {result.status}</strong>
   <p>{result.detail}</p>
   <p>Connected: {result.connected?'Yes':'Not confirmed'}</p>
   <small>Checked at {result.checkedAt}. Supplier messaging remains controlled by server-side safety switches.</small>
  </section>}
 </main>
}
