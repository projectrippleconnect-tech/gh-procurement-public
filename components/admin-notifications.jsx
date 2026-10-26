 'use client'
import {useCallback,useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
export function AdminNotifications({profile,navigate,flash}){
 const [open,setOpen]=useState(false),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[status,setStatus]=useState(''),[enabled,setEnabled]=useState(false)
 const admin=profile?.role==='admin'
 const load=useCallback(async()=>{
  const r=await supabase.from('proc_admin_notifications').select('*').order('created_at',{ascending:false}).limit(50)
  if(r.error){setStatus('Notifications unavailable. Please retry.');return}
  setRows(r.data||[])
 },[])
 useEffect(()=>{
  if(!admin)return
  load();const timer=setInterval(()=>{if(document.visibilityState==='visible')load()},20000)
  const focus=()=>load();window.addEventListener('focus',focus)
  if('serviceWorker' in navigator)navigator.serviceWorker.getRegistration('/').then(r=>r?.pushManager.getSubscription()).then(s=>setEnabled(Boolean(s))).catch(()=>{})
  return()=>{clearInterval(timer);window.removeEventListener('focus',focus)}
 },[admin,load])
 const visit=useCallback(async row=>{
  const r=await supabase.from('proc_admin_notifications').update({read_at:new Date().toISOString()}).eq('id',row.id)
  if(r.error){setStatus('Could not mark notification as read.');return}
  setRows(old=>old.map(n=>n.id===row.id?{...n,read_at:new Date().toISOString()}:n));setOpen(false)
  navigate(row.target_view);flash(row.body)
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
 async function test(){setBusy(true);try{const r=await supabase.functions.invoke('proc-admin-push',{body:{action:'test'}});if(r.error)throw r.error;setStatus(r.data.accepted?'Test sent. Check your phone notifications.':'Enable notifications on this phone first.')}catch(e){setStatus(e.message)}finally{setBusy(false)}}
 if(!admin)return null
 const unread=rows.filter(n=>!n.read_at).length
 return <div className="admin-notifications"><button className="btn small" onClick={()=>setOpen(v=>!v)} aria-expanded={open}>Notifications{unread?' ('+unread+')':''}</button>
 {open&&<div className="notification-panel" role="region" aria-label="Admin notifications"><div className="toolbar"><strong>Admin notifications</strong><button className="btn small" onClick={()=>setOpen(false)}>Close</button></div>
 <p className="muted tiny">Stock submissions and supply orders from General and Company Items.</p>
 <div className="toolbar"><button className="btn small" disabled={busy} onClick={enabled?disable:enable}>{enabled?'Disable on this phone':'Enable phone notifications'}</button>{enabled&&<button className="btn small" disabled={busy} onClick={test}>Send test</button>}<button className="btn small" onClick={load}>Refresh</button></div>
 {status&&<p role="status" className="tiny">{status}</p>}
 {rows.length===0&&<p className="muted tiny">New submissions will appear here.</p>}
 {rows.map(n=><button key={n.id} className={'notification-row '+(!n.read_at?'unread':'')} onClick={()=>visit(n)}><strong>{n.title}</strong><span>{n.body}</span><small>{new Date(n.created_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</small></button>)}
 </div>}</div>
}
