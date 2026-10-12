'use client'

import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react'
import {Err} from './ui'

const ConfirmationContext=createContext(null)
export function useDangerConfirmation(){
 const confirm=useContext(ConfirmationContext)
 if(!confirm)throw new Error('Confirmation provider is missing.')
 return confirm
}

export function useActionConfirmation(){
 const confirm=useDangerConfirmation()
 return useCallback((message,options={})=>confirm({tone:'action',title:'Review and continue',message:String(message).replaceAll('\\n','\n'),confirmLabel:'Continue',...options}),[confirm])
}

export function DangerConfirmationProvider({children}){
 const[request,setRequest]=useState(null),[confirmation,setConfirmation]=useState(''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const pending=useRef(null),busyRef=useRef(false),dialog=useRef(null),cancelButton=useRef(null),mounted=useRef(true)
 const confirm=useCallback(options=>{
  if(pending.current)return Promise.resolve(false)
  setConfirmation('');setReason('');setError('');setRequest(options)
  return new Promise(resolve=>{pending.current={resolve,options}})
 },[])
 const close=useCallback(result=>{
  const previous=pending.current;pending.current=null
  if(mounted.current)setRequest(null)
  previous?.resolve(result)
 },[])
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;pending.current?.resolve(false);pending.current=null}},[])
 useEffect(()=>{
  if(!request)return
  const previous=document.activeElement
  cancelButton.current?.focus()
  const keydown=e=>{
   if(e.key==='Escape'){e.preventDefault();if(!busyRef.current)close(false)}
   if(e.key==='Tab'){
    const buttons=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')]
    if(!buttons.length){e.preventDefault();return}
    const first=buttons[0],last=buttons.at(-1)
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
   }
  }
  document.addEventListener('keydown',keydown)
  const overflow=document.body.style.overflow;document.body.style.overflow='hidden'
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()}
 },[request,close])
 async function execute(){
  if(busyRef.current||!pending.current)return
  const current=pending.current
  if(current.options.confirmation&&confirmation!==current.options.confirmation)return
  if(current.options.requireReason&&reason.trim().length<5)return
  busyRef.current=true;setBusy(true);setError('')
  try{await current.options.onConfirm?.({confirmation,reason:reason.trim()});close(true)}
  catch(e){if(mounted.current)setError(e?.message||'The operation could not be completed. Try again.')}
  finally{busyRef.current=false;if(mounted.current)setBusy(false)}
 }
 return <ConfirmationContext.Provider value={confirm}><div inert={request?true:undefined}>{children}</div>{request&&<div className="modal-backdrop"><div ref={dialog} className={"modal card danger-dialog "+(request.tone==='action'?'action-dialog':'')} role={request.tone==='action'?'dialog':'alertdialog'} aria-modal="true" aria-labelledby="danger-confirm-title" aria-describedby="danger-confirm-description" aria-busy={busy}>
  <div className="danger-heading"><span className="danger-icon" aria-hidden="true">{request.tone==='action'?'✓':'⚠'}</span><div><small>{request.tone==='action'?'Ready for the next step':'Warning · confirmation required'}</small><h3 id="danger-confirm-title">{request.title}</h3></div></div>
  <div id="danger-confirm-description"><p>{request.message}</p>{(request.warning||request.tone!=='action')&&<p className="danger-warning">{request.warning||'This cannot be undone in the app. Check carefully before confirming.'}</p>}</div>
  {request.details&&<div className="danger-details">{request.details}</div>}
  {request.confirmation&&<label className="field section">Type <b>{request.confirmation}</b> to confirm<input className="input" aria-label="Warning confirmation" autoComplete="off" disabled={busy} value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>}
  {request.requireReason&&<label className="field section">Reason<input className="input" aria-label="Warning reason" disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/><small>At least five characters.</small></label>}
  <Err v={error}/><div className="danger-actions section"><button ref={cancelButton} className="btn" disabled={busy} onClick={()=>close(false)}>{request.cancelLabel||'Cancel'}</button><button className={request.tone==='action'?'btn primary':'btn bad'} disabled={busy||(request.confirmation&&confirmation!==request.confirmation)||(request.requireReason&&reason.trim().length<5)} onClick={execute}>{busy?'Working…':request.confirmLabel||'Confirm'}</button></div>
 </div></div>}</ConfirmationContext.Provider>
}
