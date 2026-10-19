'use client'
import {useCallback,useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {OFFLINE_CHANGED,isDisconnected,pendingStockCount,synchronizeStockSubmissions} from '@/lib/offline-stock.mjs'

// The active page drives sync. Background Sync is not reliable across Android browsers.
export function OfflineStockStatus({ownerId}){
 const[offline,setOffline]=useState(false)
 const[pending,setPending]=useState(0)
 const[busy,setBusy]=useState(false)
 const[message,setMessage]=useState('')
 const refresh=useCallback(async()=>{
  setOffline(isDisconnected())
  try{setPending(await pendingStockCount(ownerId))}catch(e){setMessage(e.message||'Offline storage unavailable')}
 },[ownerId])
 const sync=useCallback(async()=>{
  if(!ownerId||isDisconnected())return refresh()
  setBusy(true)
  try{
   const result=await synchronizeStockSubmissions(ownerId,supabase)
   setPending(result.pending)
   setMessage(result.error|| (result.completed?result.completed+' stock submission(s) synchronized.':''))
  }catch(e){setMessage(e.message||'Synchronization failed.')}
  finally{setBusy(false);refresh()}
 },[ownerId,refresh])
 useEffect(()=>{
  if(!ownerId)return
  if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{})
  navigator.storage?.persist?.().catch(()=>{})
  const onReconnect=()=>{refresh();if(!isDisconnected())sync()}
  const onVisibility=()=>{if(document.visibilityState==='visible')onReconnect()}
  window.addEventListener('online',onReconnect)
  window.addEventListener('offline',refresh)
  window.addEventListener(OFFLINE_CHANGED,refresh)
  document.addEventListener('visibilitychange',onVisibility)
  refresh().then(()=>{if(!isDisconnected())sync()})
  return()=>{
   window.removeEventListener('online',onReconnect)
   window.removeEventListener('offline',refresh)
   window.removeEventListener(OFFLINE_CHANGED,refresh)
   document.removeEventListener('visibilitychange',onVisibility)
  }
 },[ownerId,refresh,sync])
 return <div className="gh-offline-status" role="status" aria-live="polite">
  <span>{offline?'○ Offline · saved on phone':'● Online'}{pending>0?' · '+pending+' pending':''}</span>
  {pending>0&&<button type="button" className="btn small" disabled={offline||busy} onClick={sync}>{busy?'Syncing…':'Sync'}</button>}
  {message&&<small title={message}>{message}</small>}
 </div>
}
