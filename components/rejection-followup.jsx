'use client'
import {useEffect,useRef,useState} from 'react'
import {rejectionActions,rejectionNextAction} from '@/lib/receiving-guidance.mjs'
import {itemTitle,qty} from '@/lib/helpers'

export function RejectionFollowup({record,onClose,onSave}){
 const dialog=useRef(null),lock=useRef(false)
 const[action,setAction]=useState(()=>rejectionNextAction(record.status)),[due,setDue]=useState(record.due_date||''),[reference,setReference]=useState(''),[notes,setNotes]=useState(''),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 useEffect(()=>{const node=dialog.current;node.showModal();return()=>node.close()},[])
 const selected=rejectionActions.find(([key])=>key===action)
 const needsDue=['replacement_requested','credit_note_requested'].includes(action)
 async function submit(e){
  e.preventDefault();if(lock.current)return
  if(action==='credit_note_received'&&!reference.trim()){setError('Enter the credit note number.');return}
  if(['accept_loss','close_other'].includes(action)&&notes.trim().length<5){setError('Enter a settlement reason (at least five characters).');return}
  setError('');if(!review){setReview(true);return}
  lock.current=true;setBusy(true)
  try{await onSave({p_case_id:record.id,p_action:action,p_notes:notes.trim()||null,p_reference_no:reference.trim()||null,p_due_date:needsDue?due||null:null});onClose()}
  catch(e){setError((e.message||'Could not save.')+' Refresh the case before retrying if the result is uncertain.')}
  finally{lock.current=false;setBusy(false)}
 }
 return <dialog ref={dialog} className="modal card receiving-followup-dialog" aria-labelledby="followup-title" onCancel={e=>{e.preventDefault();if(!lock.current)onClose()}}>
  <form onSubmit={submit}>
   <div className="modal-head"><h3 id="followup-title">{review?'2. Review follow-up':'1. Settle rejected goods'}</h3><button type="button" className="btn small" disabled={busy} onClick={onClose}>Cancel</button></div>
   <p><strong>{itemTitle(record)}</strong><br/>{qty(record.rejected_qty)} rejected · {record.po_no}</p>
   {!review?<div className="stack section">
    <label className="field">What happens next?<select aria-label="What happens next?" className="select" value={action} onChange={e=>{setAction(e.target.value);setError('')}}>{rejectionActions.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    <p className="muted">{selected[2]}</p>
    {needsDue&&<label className="field">Follow-up date (optional)<input className="input" type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>}
    <label className="field">{action==='credit_note_received'?'Credit note number':'Reference (optional)'}<input className="input" maxLength={200} value={reference} onChange={e=>setReference(e.target.value)}/></label>
    <label className="field">{['accept_loss','close_other'].includes(action)?'Settlement reason':'Notes (optional)'}<textarea className="input" maxLength={1000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   </div>:<div className="notice section"><strong>{selected[1]}</strong><p>{selected[2]}</p>{due&&needsDue&&<p>Follow up: {due}</p>}{reference&&<p>Reference: {reference}</p>}{notes&&<p>{notes}</p>}</div>}
   {error&&<p role="alert" className="error section">{error}</p>}
   <div className="toolbar section">{review&&<button className="btn" type="button" disabled={busy} onClick={()=>setReview(false)}>Back</button>}<button className="btn primary" disabled={busy} type="submit">{busy?'Saving…':review?'Save follow-up':'Review →'}</button></div>
  </form>
 </dialog>
}
