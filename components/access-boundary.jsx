'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {accessMessage,currentPosition} from '@/lib/access-restrictions.mjs'
import {withStartupDeadline} from '@/lib/workspace-startup.mjs'

// Mount the workspace only after server authorization, before its initial queries.
export function AccessBoundary({children}){
 const[recoveryMode,setRecoveryMode]=useState(false)
 const[session,setSession]=useState(undefined),[status,setStatus]=useState({allowed:false,reason:'checking'}),[busy,setBusy]=useState(false)
 const generation=useRef(0),checking=useRef(false),locationGranted=useRef(false),deadline=useRef(null)
 const lastServerApproval=useRef(null)
 useEffect(()=>{
  let alive=true
  setRecoveryMode(new URLSearchParams(window.location.search).get('recovery')==='1')
  const receive=(_event,s)=>{if(!alive)return;setSession(s)}
  const{data}=supabase.auth.onAuthStateChange(receive)
  withStartupDeadline(supabase.auth.getSession()).then(r=>{if(r.error)throw r.error;if(alive)setSession(r.data.session)}).catch(()=>{if(alive)setStatus({allowed:false,reason:'connection_error'})})
  return()=>{alive=false;generation.current++;data.subscription.unsubscribe();clearTimeout(deadline.current)}
 },[])
 const commit=useCallback((next)=>{
  clearTimeout(deadline.current)
  if(document.hidden&&!next.exempt){setStatus({...next,allowed:false,reason:'checking'});return}
  setStatus(next)
  if(next.allowed)lastServerApproval.current={at:Date.now(),until:next.valid_until?Date.parse(next.valid_until):null,status:next}
  else lastServerApproval.current=null
  if(next.allowed&&next.valid_until){
   const ms=Date.parse(next.valid_until)-Date.parse(next.server_now)
   deadline.current=setTimeout(()=>setStatus(s=>({...s,allowed:false,reason:s.policy?.location_enabled?'location_required':'outside_hours'})),Math.max(0,ms))
  }
 },[])
 const verify=useCallback(async(requestLocation=false)=>{
  if(!session||checking.current)return
  checking.current=true;setBusy(true);const version=generation.current
  try{
   let r=await withStartupDeadline(supabase.rpc('proc_access_status_v1'));if(r.error)throw r.error
   let next=r.data
   if(!next.exempt&&next.reason!=='outside_hours'&&next.reason!=='disabled'&&next.policy?.location_enabled&&(requestLocation||locationGranted.current)){
    const pos=await currentPosition();locationGranted.current=true
    r=await withStartupDeadline(supabase.rpc('proc_verify_location_v1',{p_latitude:pos.coords.latitude,p_longitude:pos.coords.longitude,p_accuracy:pos.coords.accuracy}))
    if(r.error)throw r.error;next=r.data
   }
   if(version===generation.current)commit(next)
  }catch(e){
   if(version===generation.current){
    const approval=lastServerApproval.current
    const stillValid=approval&&Date.now()-approval.at<30*60*1000&&(!Number.isFinite(approval.until)||Date.now()<approval.until)
    // Do not bypass a denied or unverified session. Only an already verified,
    // still-valid device receives a short offline grace period.
    if(navigator.onLine===false&&stillValid)setStatus({...approval.status,offlineGrace:true})
    else commit({allowed:false,reason:e.code===1?'permission_denied':e.code===2||e.code===3?'location_unavailable':'connection_error',policy:status.policy})
   }
  }finally{checking.current=false;if(version===generation.current)setBusy(false)}
 },[session,commit,status.policy])
 const verifyRef=useRef(verify);verifyRef.current=verify
 async function retryAccess(){
  if(session!==undefined){verify(true);return}
  setBusy(true)
  try{const r=await withStartupDeadline(supabase.auth.getSession());if(r.error)throw r.error;setSession(r.data.session)}
  catch{commit({allowed:false,reason:'connection_error'})}finally{setBusy(false)}
 }
 useEffect(()=>{
  generation.current++;locationGranted.current=false;lastServerApproval.current=null;clearTimeout(deadline.current)
  if(!session||recoveryMode){setStatus({allowed:false,reason:'checking'});return}
  setStatus({allowed:false,reason:'checking'});verifyRef.current()
  const timer=setInterval(()=>verifyRef.current(),30000)
  const visibility=()=>{
   if(document.hidden){clearTimeout(deadline.current);setStatus(s=>s.exempt?s:{...s,allowed:false,reason:'checking'})}
   else verifyRef.current()
  }
  document.addEventListener('visibilitychange',visibility)
  return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',visibility)}
 },[session?.user?.id,recoveryMode])
 if(session===null||recoveryMode)return children
 if(status.allowed)return children
 const p=status.policy
 return <div className="login-shell"><div className="card login" role="status"><div className="logo">GH</div><h1>GH Procurement</h1><h2>Access restrictions</h2><p>{accessMessage(status.reason)}</p>
  {p&&<div className="notice"><p>{p.time_enabled?`${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].filter((_,i)=>p.days.includes(i)).join(', ')} · ${p.start_time.slice(0,5)}–${p.end_time.slice(0,5)} (Sri Lanka time)`:'No working-hours restriction'}</p>{p.location_enabled&&<p>{p.location_name} · within {p.radius_m} metres</p>}</div>}
  <div className="row"><button className="btn primary" disabled={busy} onClick={retryAccess}>{busy?'Checking…':'Verify location / Retry'}</button><button className="btn" onClick={()=>supabase.auth.signOut()}>Sign out</button></div>
 </div></div>
}
