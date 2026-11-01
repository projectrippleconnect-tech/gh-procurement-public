 'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {isOpenIssue,newlyArrivedNotifications,notificationDestination} from '@/lib/notification-state.mjs'
export function AdminNotifications({profile,navigate,flash}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[enabled,setEnabled]=useState(false)
 const seen=useRef(null)
 const admin=profile?.role==='admin'
 const load=useCallback(async()=>{
  const r=await supabase.from('proc_admin_notifications').select('*').order('created_at',{ascending:false}).limit(200)
  if(r.error){setStatus('Notifications unavailable. Please retry.');return}
  const next=r.data||[];const arrivals=newlyArrivedNotifications(seen.current,next);seen.current=new Set(next.map(n=>n.id));if(arrivals.length)flash(arrivals.length===1?arrivals[0].title+' · '+arrivals[0].body:arrivals.length+' new procurement updates. Open Notifications.');setRows(next)
 },[flash])
 useEffect(()=>{
  if(!admin)return
  seen.current=null;load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},20000)
  const focus=()=>load();window.addEventListener('focus',focus)
  if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration('/').then(r=>r?.pushManager.getSubscription()).then(async s=>{if(!s||Notification.permission!=='granted'){setEnabled(false);return}const saved=await supabase.from('proc_push_subscriptions').select('id').eq('endpoint',s.endpoint).maybeSingle();setEnabled(Boolean(!saved.error&&saved.data));if(saved.error)setStatus('Device registration could not be checked. Refresh or enable again.');else if(!saved.data)setStatus('This browser needs to be registered again. Tap Enable phone notifications.');}).catch(()=>setEnabled(false))
  return()=>{clearInterval(timer);window.removeEventListener('focus',focus)}
 },[admin,load,profile?.id])
 const visit=useCallback(async row=>{
  const r=await supabase.from('proc_admin_notifications').update({read_at:new Date().toISOString()}).eq('id',row.id)
  if(r.error){setStatus('Could not mark notification as read.');return}
  setRows(old=>old.map(n=>n.id===row.id?{...n,read_at:new Date().toISOString()}:n));setOpen(false)
  const target=notificationDestination(row);target.view==='supplier_access'?window.location.assign('/supplier-access'):navigate(target.view,target.filter);flash(row.body)
 },[navigate,flash])
 useEffect(()=>{
  if(!admin)return
  const id=new URLSearchParams(location.search).get('notification');if(!id)return
  supabase.from('proc_admin_notifications').select('*').eq('id',id).maybeSingle().then(r=>{if(r.data)visit(r.data)})
  const url=new URL(location.href);url.searchParams.delete('notification');history.replaceState(history.state,'',url)
 },[admin,visit])
 async function enable(){
  setBusy(true);setStatus('')
  try{
   if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))throw Error('Open this app in Chrome on Android. On iPhone, add it to your Home Screen first.')
   if(await Notification.requestPermission()!=='granted')throw Error('Allow notifications in your browser site settings, then try again.')
   const {data,error}=await supabase.functions.invoke('proc-admin-push',{body:{action:'key'}});if(error)throw error
   const reg=await navigator.serviceWorker.register('/admin-push-sw.js',{scope:'/'})
   await navigator.serviceWorker.ready
   const key=Uint8Array.from(atob(data.publicKey.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))
   let sub=await reg.pushManager.getSubscription()
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key})
   const saved=await supabase.from('proc_push_subscriptions').select('id').eq('endpoint',sub.endpoint).maybeSingle()
   if(saved.error)throw saved.error
   if(!saved.data){const r=await supabase.from('proc_push_subscriptions').insert({user_id:profile.id,endpoint:sub.endpoint,subscription:sub.toJSON()});if(r.error){await sub.unsubscribe();throw r.error}}
   setEnabled(true);setStatus('Phone notifications enabled. Delivery usually takes up to a minute.')
  }catch(e){setStatus(e.message||'Could not enable notifications.')}finally{setBusy(false)}
 }
 async function disable(){
  setBusy(true)
  try{const reg=await navigator.serviceWorker.getRegistration('/');const sub=await reg?.pushManager.getSubscription();if(sub){const r=await supabase.from('proc_push_subscriptions').delete().eq('endpoint',sub.endpoint);if(r.error)throw r.error;await sub.unsubscribe()}setEnabled(false);setStatus('Notifications disabled on this phone.')}catch(e){setStatus(e.message)}finally{setBusy(false)}
 }
 async function test(){setBusy(true);try{const reg=await navigator.serviceWorker.getRegistration('/');const sub=await reg?.pushManager.getSubscription();if(!sub)throw Error('Enable notifications on this phone first.');const r=await supabase.functions.invoke('proc-admin-push',{body:{action:'test',endpoint:sub.endpoint}});if(r.error)throw r.error;setStatus(r.data.accepted?'Push service accepted the test. Confirm that a pop-up appeared on this phone.':'Enable notifications on this phone first.')}catch(e){setStatus(e.message)}finally{setBusy(false)}}
 if(!admin)return null
 const unread=rows.filter(n=>!n.read_at&&!n.resolved_at).length
 const issues=rows.filter(n=>isOpenIssue(n))
 return <div className="admin-notifications"><button className="btn small" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>Notifications{unread?' ('+unread+')':''}</button>
 {open&&<div className="notification-panel" role="region" aria-label="Admin notifications"><div className="toolbar"><strong>Admin notifications</strong><button className="btn small" onClick={()=>setOpen(false)}>Close</button></div>
 <p className="muted tiny">Stock, orders, returned prices and exceptions. Enable and test each phone separately.</p>
 <div className="toolbar"><button className="btn small" disabled={busy} onClick={enabled?disable:enable}>{enabled?'Disable on this phone':'Enable phone notifications'}</button>{enabled&&<button className="btn small" disabled={busy} onClick={test}>Send test</button>}<button className="btn small" onClick={load}>Refresh</button></div>
 {status&&<p role="status" className="tiny">{status}</p>}
 <p className="muted tiny">{enabled?'This phone is registered.':'This phone is not registered.'} {issues.length} active issue(s). The latest 200 alerts are shown.</p>
 {issues.length>0&&<button className="btn small" onClick={()=>{setOpen(false);navigate('urgent_actions')}}>Open Exceptions / Urgent Work</button>}
 {rows.length===0&&<p className="muted tiny">New submissions will appear here.</p>}
 {rows.map(n=><div key={n.id} className="notification-item"><button className={'notification-row '+(!n.read_at&&!n.resolved_at?'unread':'')} onClick={()=>visit(n)}><strong>{n.title}{n.resolved_at?' · Resolved':''}</strong><span>{n.body}</span>{n.responsible_role&&<small>{n.severity} · {n.responsible_role}{n.due_at?' · Due '+new Date(n.due_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'}):''}</small>}<small>{n.action_label||'Open record'} · {new Date(n.created_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</small>{n.snoozed_until&&new Date(n.snoozed_until)>new Date()&&<small>Postponed until {new Date(n.snoozed_until).toLocaleString()}</small>}</button></div>)}
 </div>}</div>
}

// Same durable issues as the bell and background push, with role/due/action context.
export function AdminIssueQueue({profile,navigate,fail}){
 const [rows,setRows]=useState([]),[status,setStatus]=useState(''),[postpone,setPostpone]=useState(null),[reason,setReason]=useState(''),[busy,setBusy]=useState(false)
 const admin=profile?.role==='admin'
 const load=useCallback(async()=>{const r=await supabase.from('proc_admin_notifications').select('*').not('issue_key','is',null).is('resolved_at',null).order('created_at',{ascending:false}).limit(200);if(r.error){setStatus('Issues unavailable. Please refresh.');return}setStatus('');setRows(r.data||[])},[])
 useEffect(()=>{if(!admin)return;load();const id=setInterval(()=>{if(document.visibilityState==='visible')load()},20000);return()=>clearInterval(id)},[admin,load])
 if(!admin)return null
 async function save(){setBusy(true);try{const r=await supabase.rpc('proc_notification_postpone_v1',{p_id:postpone,p_hours:4,p_reason:reason});if(r.error)throw r.error;setPostpone(null);setReason('');await load()}catch(e){fail(e)}finally{setBusy(false)}}
 return <div className="card pad section" aria-label="Exceptions and urgent work"><div className="sectionhead"><div><h3>Exceptions / Urgent Work</h3><p>Issues clear after the source problem is fixed. Postponements are recorded; purchasing approvals still apply.</p></div><button className="btn small" onClick={load}>Refresh issues</button></div>
 {status&&<p role="status">{status}</p>}{rows.length===0&&!status&&<p>No active exceptions.</p>}
 {rows.map(n=><div className="notification-row" key={n.id}><strong>{n.title}</strong><span>{n.body}</span><small>{n.severity} · {n.responsible_role} · Due {n.due_at?new Date(n.due_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'}):'now'}</small>{!isOpenIssue(n)&&<small>Postponed until {new Date(n.snoozed_until).toLocaleString()}</small>}<div className="toolbar"><button className="btn small primary" onClick={()=>{const target=notificationDestination(n);target.view==='supplier_access'?window.location.assign('/supplier-access'):navigate(target.view,target.filter)}}>{n.action_label||'Open record'}</button><button className="btn small" onClick={()=>{setPostpone(n.id);setReason('')}}>Postpone 4 hours</button></div>{postpone===n.id&&<div><label>Reason for postponement<input className="input" maxLength={400} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="toolbar"><button className="btn small" disabled={busy||reason.trim().length<5} onClick={save}>Save postponement</button><button className="btn small" onClick={()=>setPostpone(null)}>Cancel</button></div></div>}</div>)}
 {rows.length===200&&<p className="muted tiny">Showing the latest 200 open issues. Fix source issues and refresh to see older work.</p>}
 </div>
}
