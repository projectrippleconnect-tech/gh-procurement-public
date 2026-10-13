'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'

export function CaptureSettings({flash,fail}){
 const[protectedClient,setProtectedClient]=useState(false)
 const[status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('')
 async function refresh(){try{const r=await supabase.rpc('proc_capture_status_v1');if(r.error)throw r.error;setStatus(r.data);setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{setProtectedClient(typeof window.GHProcurementAndroid?.refreshCapturePolicy==='function');refresh();const id=setInterval(refresh,10000);return()=>clearInterval(id)},[])
 async function toggle(enabled){
  setBusy(true)
  try{const r=await supabase.rpc('proc_set_capture_override_v1',{p_enabled:enabled});if(r.error)throw r.error;setStatus(r.data);setError('');window.dispatchEvent(new Event('gh-capture-policy-updated'));flash(enabled?'Screenshots temporarily allowed for your Super Admin session.':'Screenshot protection restored.')}
  catch(e){fail(e)}finally{setBusy(false)}
 }
 return <details name="gh-admin-section" className="admin-accordion"><summary>Screenshot Protection</summary><div className="card pad"><h3>Screenshot protection</h3><p>Screenshots are blocked by default in the protected Android app, including for Super Admin. Other users cannot turn protection off.</p>
  <div className="notice"><b>Browser protection needs managed devices</b><p>Ordinary Chrome, Edge and installed web apps cannot reliably prevent operating-system screenshots. For browser use, your staff devices need a managed work profile or device-level capture policy. That setup is separate from this website setting.</p></div>
  {error&&<p role="alert">{error}</p>}
  <p role="status">{status?.capture_allowed?'Temporary Super Admin protected-app override is active. It expires automatically after five minutes.':'Protected-app policy: screenshots blocked.'}</p>
  {!protectedClient&&<p>Open the updated protected Android app to use the screenshot override. This browser has no verified capture control.</p>}
  <button className="btn primary" disabled={busy||!status?.can_override||!protectedClient} onClick={()=>toggle(!status.capture_allowed)}>{busy?'Updating…':status?.capture_allowed?'Block screenshots now':'Allow my screenshots for 5 minutes'}</button>
  <p className="muted tiny">Applies only to your current protected-app session. Protection returns when the app goes to the background, the session ends, the override expires or verification fails. An updated Android app is required.</p>
 </div></details>
}

export function CaptureSession(){
 const[token,setToken]=useState('')
 useEffect(()=>{
  let alive=true
  const receive=(_event,s)=>{if(alive)setToken(s?.access_token||'')}
  const{data}=supabase.auth.onAuthStateChange(receive)
  supabase.auth.getSession().then(r=>receive('INITIAL_SESSION',r.data.session)).catch(()=>receive('ERROR',null))
  return()=>{alive=false;data.subscription.unsubscribe()}
 },[])
 useEffect(()=>{
  const refresh=()=>window.GHProcurementAndroid?.refreshCapturePolicy?.(document.hidden?'':token)
  refresh();const timer=setInterval(refresh,10000)
  window.addEventListener('gh-capture-policy-updated',refresh);document.addEventListener('visibilitychange',refresh)
  return()=>{clearInterval(timer);window.removeEventListener('gh-capture-policy-updated',refresh);document.removeEventListener('visibilitychange',refresh);window.GHProcurementAndroid?.refreshCapturePolicy?.('')}
 },[token])
 return null
}
