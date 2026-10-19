'use client'
import {useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {submissionQuantity,stockSubmissionDate} from '@/lib/stock-item-history.mjs'

const PAGE_SIZE=30
export function StockItemSubmissionHistory({itemId,itemName,companyId=null,onClose}){
 const [rows,setRows]=useState([]),[loading,setLoading]=useState(true)
 const [error,setError]=useState(''),[hasMore,setHasMore]=useState(false)
 const request=useRef(0)
 useEffect(()=>{
  const onKey=e=>{if(e.key==='Escape')onClose()}
  window.addEventListener('keydown',onKey)
  return()=>window.removeEventListener('keydown',onKey)
 },[onClose])
 useEffect(()=>{
  const revision=++request.current
  setRows([]);setLoading(true);setError('')
  ;(async()=>{
   try{
    const {data,error:problem}=await supabase.rpc('proc_stock_item_submissions_v1',{
     p_item_id:itemId,p_company_id:companyId,p_limit:PAGE_SIZE,p_offset:0
    })
    if(problem)throw problem
    if(revision===request.current){setRows(data||[]);setHasMore((data||[]).length===PAGE_SIZE)}
   }catch(e){if(revision===request.current)setError('Unable to load the count history. '+(e?.message||''))}
   finally{if(revision===request.current)setLoading(false)}
  })()
  return()=>{request.current++}
 },[itemId,companyId])
 async function more(){
  if(loading)return
  setLoading(true);setError('')
  try{
   const {data,error:problem}=await supabase.rpc('proc_stock_item_submissions_v1',{
    p_item_id:itemId,p_company_id:companyId,p_limit:PAGE_SIZE,p_offset:rows.length
   })
   if(problem)throw problem
   setRows(previous=>[...previous,...(data||[])])
   setHasMore((data||[]).length===PAGE_SIZE)
  }catch(e){setError('Could not load more submissions. '+(e?.message||''))}
  finally{setLoading(false)}
 }
 return <div className="modal-backdrop stock-item-history-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
  <section className="modal card stock-item-history-modal" role="dialog" aria-modal="true" aria-label={'Submission history for '+itemName}>
   <div className="modal-head"><div><h3>Stock submission history</h3><p className="muted tiny">{itemName}</p></div><button type="button" className="btn small" aria-label="Close item history" onClick={onClose}>✕</button></div>
   <p className="muted tiny stock-item-history-note">Newest finalized recount first. Previous submissions are kept for audit. Ordering quantities are recalculated when a new count is finalized; outstanding RFQs and POs still require their normal checks.</p>
   <div className="stock-item-history-list">
    {rows.map((r,index)=><div key={r.line_id} className={'stock-item-history-record '+(index===0?'latest':'')}>
     <div className="stock-item-history-heading"><strong>{index===0?'Latest submission':'Earlier submission'}</strong><span>{stockSubmissionDate(r.submitted_at)}</span></div>
     <div className="stock-item-history-quantity">{submissionQuantity(r)}{!r.sufficient_stock&&r.current_stock!=null&&r.uom?' '+r.uom:''}</div>
     <div className="muted tiny">{r.count_no} · Submitted by {r.counted_by_name||'Staff'}</div>
    </div>)}
    {loading&&!rows.length&&<p className="muted tiny" role="status">Loading item history…</p>}
    {!loading&&!rows.length&&!error&&<p className="muted tiny">No finalized submissions found for this item.</p>}
    {error&&<p className="notice" role="alert">{error}</p>}
   </div>
   <div className="stock-item-history-actions">{hasMore&&<button type="button" className="btn small" onClick={more} disabled={loading}>{loading?'Loading…':'Load older submissions'}</button>}<button type="button" className="btn" onClick={onClose}>Close</button></div>
  </section>
 </div>
}
