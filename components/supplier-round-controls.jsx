'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
const button={padding:10,borderRadius:8,background:'#29445e',color:'white',border:'1px solid #64748b'}
export default function SupplierRoundControls({rfqId,onChange}){
 const sequence=useRef(0)
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const [limits,setLimits]=useState({po:'',daily:'',unit:'',lead:'14'}),[consent,setConsent]=useState(false),[evidence,setEvidence]=useState({}),[messageIds,setMessageIds]=useState({})
 const reload=useCallback(async()=>{
  if(!rfqId){setData(null);return}
  const requestSequence=++sequence.current
  const {data,error}=await supabase.rpc('proc_portal_review_v1',{p_rfq_id:rfqId})
  if(error)throw error;if(requestSequence===sequence.current)setData(data)
 },[rfqId])
 useEffect(()=>{setData(null);setError('');setConsent(false);reload().catch(e=>setError(e.message));return()=>{sequence.current++}},[reload])
 async function act(name,args){
  if(busy)return;setBusy(true);setError('')
  try{const {error}=await supabase.rpc(name,args);if(error)throw error;await reload();onChange?.()}
  catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section style={{border:'1px solid #526782',padding:14,borderRadius:12,marginBottom:14}}>
  <h2 style={{marginTop:0}}>Quotation round and purchase safeguards</h2>
  {error&&<p role="alert" style={{color:'#fecaca'}}>{error}</p>}
  {!data?.round?<>
   <p>Start one shared six-hour deadline for this RFQ. Eligible confirmed exact items are ranked by landed cost; orders remain pending approval. Uncovered quantities reopen for 24 hours using the same supplier links.</p>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(135px,1fr))',gap:8}}>
    {[['po','Maximum per PO (Rs.)'],['daily','Maximum daily total (Rs.)'],['unit','Maximum landed unit cost (Rs.)'],['lead','Maximum delivery days']].map(([key,label])=><label key={key}>{label}<input aria-label={label} type="number" min={key==='lead'?0:0.01} step={key==='lead'?1:'.01'} value={limits[key]} onChange={e=>setLimits({...limits,[key]:e.target.value})} style={{display:'block',width:'100%',boxSizing:'border-box',padding:9,fontSize:16}}/></label>)}
   </div>
   <p><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> I approve these limits and the current RFQ scope for this round and its residual round.</label></p>
   <button style={button} disabled={busy||!consent||!rfqId} onClick={()=>act('proc_portal_start_round_v1',{p_rfq_id:rfqId,p_max_po:Number(limits.po),p_max_daily:Number(limits.daily),p_max_unit:Number(limits.unit),p_max_lead:Number(limits.lead)})}>Approve and start six-hour round</button>
  </>:<>
   <p>Round {data.round.round_no} · {data.round.company_id?'Company Items':'General Items'} · {data.round.state} · Closes {new Date(data.round.closes_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</p>
   <p>PO limit Rs. {data.round.policy.max_po} · Daily limit Rs. {data.round.policy.max_daily}</p>
   {data.round.state==='exception'&&<><p role="alert">{data.round.result?.reason}</p><button style={button} disabled={busy} onClick={()=>act('proc_portal_retry_round_v1',{p_round_id:data.round.id})}>Retry after correcting exception</button></>}
   {data.round.state==='open'&&<button style={button} disabled={busy} onClick={()=>act('proc_portal_process_round_v1',{p_round_id:data.round.id})}>Process due round</button>}
   {data.round.result?.next_rfq_id&&<p><a style={{color:'#fbbf24'}} href={'/supplier-links?rfq='+data.round.result.next_rfq_id}>Open residual 24-hour round</a> · Existing supplier links follow the new round.</p>}
   {(data.jobs||[]).map(job=><div key={job.id} style={{borderTop:'1px solid #526782',paddingTop:8,marginTop:10}}>
    <strong>{job.document?.po?.po_no}</strong> · {job.document?.supplier?.name} · Rs. {job.document?.po?.total}<p>PO: {job.document?.po?.status} · Delivery: {job.status}</p>
    <details><summary>Review dispatch document and recipient</summary><p>{job.document?.supplier?.phone}</p>{job.document?.lines?.map(l=><p key={l.id}>{l.description} {l.size} · {l.qty} {l.uom}</p>)}</details>
    {job.status==='pending_approval'&&job.document?.po?.status==='approved'&&<button style={button} disabled={busy} onClick={()=>act('proc_portal_allow_dispatch_v1',{p_po_id:job.po_id})}>Verify recipient and authorize automatic dispatch</button>}
    {['accepted','unknown'].includes(job.status)&&job.message_id&&<div><label>Verified delivery evidence<input aria-label={'Delivery evidence for '+job.document?.po?.po_no} value={evidence[job.id]||''} onChange={e=>setEvidence({...evidence,[job.id]:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10}}/></label><button style={button} disabled={busy||(evidence[job.id]||'').trim().length<10} onClick={()=>act('proc_portal_confirm_delivery_v1',{p_po_id:job.po_id,p_message_id:job.message_id,p_evidence:evidence[job.id]})}>Confirm verified WhatsApp delivery</button></div>}
    {job.status==='unknown'&&!job.message_id&&<div><input aria-label="Verified gateway message ID" placeholder="Verified gateway message ID" value={messageIds[job.id]||''} onChange={e=>setMessageIds({...messageIds,[job.id]:e.target.value})}/><input aria-label="Reconciliation evidence" placeholder="Record how you verified this exact PO message" value={evidence[job.id]||''} onChange={e=>setEvidence({...evidence,[job.id]:e.target.value})}/><button style={button} disabled={busy||!messageIds[job.id]||(evidence[job.id]||'').length<10} onClick={()=>act('proc_portal_reconcile_unknown_v1',{p_po_id:job.po_id,p_message_id:messageIds[job.id],p_evidence:evidence[job.id]})}>Reconcile message without resending</button></div>}
    {job.last_error&&<p role="alert">{job.last_error}</p>}
   </div>)}
   {data.round.result?.unfulfilled?.length>0&&<p>{data.round.result.unfulfilled.length} uncovered item balance(s) {data.round.round_no===2?'require manual follow-up after the final round.':'moved to the next round.'}</p>}
   <details><summary>Round audit</summary>{(data.audit||[]).map(a=><p key={a.id}>{a.kind} · {new Date(a.created_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</p>)}</details>
  </>}
  <p style={{fontSize:13,color:'#cbd5e1'}}>The database timer processes due rounds only after their scope and purchasing limits are approved. Approve each generated PO in GH Orders, then verify its recipient here. Automatic dispatch requires a verified gateway; gateway acceptance is not delivery confirmation.</p>
 </section>
}
