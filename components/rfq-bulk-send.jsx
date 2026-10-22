'use client'

import {useEffect,useRef,useState} from 'react'
import {normalizeWhatsAppNumber,whatsappUrl} from '@/lib/helpers'
import {DEFAULT_RFQ_CAPTION,supplierCaption,runSupplierBatch} from '@/lib/rfq-batch.mjs'

export function RfqBulkSend({rfq,captionTemplate,company,invitations,suppliers,gateway,otherBusy=false,onBusy,onSend,onRefresh,onPrepare}){
 const[selected,setSelected]=useState(new Set()),[template,setTemplate]=useState(DEFAULT_RFQ_CAPTION),[running,setRunning]=useState(false),[results,setResults]=useState({}),[summary,setSummary]=useState('')
 const seenInvitations=useRef(new Set()),sending=useRef(false),mounted=useRef(true)
 const [manual,setManual]=useState([]),[preparing,setPreparing]=useState(''),[prepared,setPrepared]=useState(null)
 const manualBusy=useRef(false)
 useEffect(()=>{mounted.current=true;try{setTemplate(localStorage.getItem('gh_rfq_whatsapp_caption_template')||DEFAULT_RFQ_CAPTION)}catch{}return()=>{mounted.current=false}},[])
 useEffect(()=>{if(captionTemplate)setTemplate(captionTemplate)},[captionTemplate])
 const rows=invitations.map(inv=>{
  const supplier=suppliers.find(s=>s.id===inv.supplier_id)
  const previous=gateway.dispatches?.find(d=>d.supplier_id===inv.supplier_id)
  const local=results[inv.supplier_id]
  const number=normalizeWhatsAppNumber(supplier?.whatsapp||supplier?.phone)
  const eligible=['pending','prepared'].includes(inv.status)&&supplier&&number&&!previous&&!['accepted','unknown','blocked'].includes(local?.status)
  return {inv,supplier,number,previous,local,eligible}
 })
 const available=rows.filter(r=>r.eligible),chosen=available.filter(r=>selected.has(r.inv.supplier_id))
 useEffect(()=>{if(!suppliers.length)return;const newcomers=invitations.filter(i=>!seenInvitations.current.has(i.id)&&['pending','prepared'].includes(i.status));invitations.forEach(i=>seenInvitations.current.add(i.id));if(newcomers.length)setSelected(current=>new Set([...current,...newcomers.map(i=>i.supplier_id)]))},[invitations,suppliers])
 function toggle(id){setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})}
 function startManual(){
  try{setManual(chosen.map(r=>({...r,caption:supplierCaption(template,rfq,r.supplier,company)})));setPrepared(null);setSummary('Prepare each supplier’s image below, then share or download it. Confirm Sent only after checking WhatsApp.')}catch(error){setSummary(error.message)}
 }
 async function prepare(row){
  if(manualBusy.current||running||otherBusy)return
  manualBusy.current=true;setPreparing(row.inv.id);setPrepared(null);onBusy(true)
  try{const out=await onPrepare(row.inv);if(mounted.current)setPrepared({...out,id:row.inv.id,caption:row.caption})}
  catch(error){if(mounted.current)setSummary(error.message)}
  finally{manualBusy.current=false;if(mounted.current)setPreparing('');onBusy(false)}
 }
 async function sharePrepared(){
  try{
   const file=new File([prepared.blob],prepared.filename,{type:'image/png'})
   await navigator.share({title:'RFQ '+rfq.rfq_no,text:prepared.caption,files:[file]})
   setSummary('Share sheet closed. Check that the correct supplier received the PNG and caption before confirming Sent.')
  }catch(error){if(error.name!=='AbortError')setSummary('Sharing is unavailable here. Download the PNG, copy the caption and attach it in the supplier chat.')}
 }
 function downloadPrepared(){
  const url=URL.createObjectURL(prepared.blob),a=document.createElement('a');a.href=url;a.download=prepared.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)
 }
 const canShare=prepared&&typeof navigator!=='undefined'&&typeof File!=='undefined'&&navigator.share&&navigator.canShare?.({files:[new File([prepared.blob],prepared.filename,{type:'image/png'})]})
 async function sendAll(){
  if(sending.current||otherBusy||!chosen.length)return
  if(!gateway.connected||!gateway.sendingEnabled){setSummary('Connect WhatsApp and enable sending before starting.');return}
  let jobs
  try{jobs=chosen.map(r=>({supplierId:r.inv.supplier_id,inv:r.inv,caption:supplierCaption(template,rfq,r.supplier,company)}))}
  catch(error){setSummary(error.message);return}
  sending.current=true;setRunning(true);onBusy(true);setSummary('Sending '+jobs.length+' supplier request(s)…')
  setResults(current=>({...current,...Object.fromEntries(jobs.map(j=>[j.supplierId,{status:'waiting',message:'Waiting to send.'}]))}))
  try{
   try{localStorage.setItem('gh_rfq_whatsapp_caption_template',template)}catch{}
   const outcomes=await runSupplierBatch(jobs,async job=>{
    if(mounted.current)setResults(current=>({...current,[job.supplierId]:{status:'sending',message:'Preparing and sending PNG + caption…'}}))
    return onSend(job.inv,job.caption)
   },{shouldStop:()=>!mounted.current,onResult:result=>{if(mounted.current)setResults(current=>({...current,[result.supplierId]:result}))}})
   const accepted=outcomes.filter(x=>x.status==='accepted').length
   if(mounted.current)setSummary(accepted+' / '+jobs.length+' requests accepted for sending. '+(accepted===jobs.length?'Check WhatsApp for delivery.':'See each supplier’s result below; uncertain sends are not retried.'))
  }finally{await onRefresh();sending.current=false;onBusy(false);if(mounted.current)setRunning(false)}
 }
 const labels={waiting:'Waiting',sending:'Sending…',accepted:'Accepted ✓',failed:'Not sent',blocked:'Already attempted',unknown:'Check WhatsApp',not_attempted:'Not attempted'}
 return <section className="rfq-bulk-send" aria-label="Send RFQ to selected suppliers">
  <div className="sectionhead"><div><h3>Send to selected suppliers</h3><p>Each checked supplier receives their own RFQ image and caption.</p></div></div>
  <div className="toolbar"><button className="btn small" disabled={running||otherBusy} onClick={()=>setSelected(new Set(available.map(r=>r.inv.supplier_id)))}>Select all pending</button><button className="btn small" disabled={running||otherBusy} onClick={()=>setSelected(new Set())}>Clear selection</button><span className="muted tiny">{gateway.connected?'WhatsApp connected':'WhatsApp disconnected'}{gateway.connected&&!gateway.sendingEnabled?' · sending disabled':''}</span><button className="btn small" disabled={running||otherBusy} onClick={onRefresh}>Refresh status</button></div>
  <div className="rfq-recipient-list">{rows.map((r,index)=>{
   const result=r.local,status=result?.status||r.previous?.status
   return <div className="rfq-recipient-row" key={r.inv.supplier_id}><label><input type="checkbox" aria-label={'Send RFQ to '+(r.supplier?.name||'Supplier')} checked={Boolean(r.eligible&&selected.has(r.inv.supplier_id))} disabled={!r.eligible||running||otherBusy} onChange={()=>toggle(r.inv.supplier_id)}/><span className="rfq-recipient-number">{index+1}</span><span><strong>{r.supplier?.name||'Supplier unavailable'}</strong><small>{r.number?'+'+r.number:'Add a valid WhatsApp number'}</small></span></label><span className={'rfq-send-result '+(status==='accepted'?'good-text':'')}>{labels[status]||status||(!r.eligible?'Unavailable':'Ready')}</span>{result?.message&&<small className="rfq-recipient-message">{result.message}</small>}</div>
  })}</div>
  <details className="section"><summary>Caption for all selected suppliers</summary><label className="field section">Message template<textarea className="input" aria-label="Bulk RFQ caption template" rows={5} maxLength={2000} disabled={running||otherBusy} value={template} onChange={e=>setTemplate(e.target.value)}/><small>Use {'{supplier_name}'}, {'{rfq_number}'} and {'{due_date}'} for each supplier.</small></label>{chosen[0]&&<pre className="rfq-caption-preview">{(()=>{try{return supplierCaption(template,rfq,chosen[0].supplier,company)}catch(error){return error.message}})()}</pre>}</details>
  <button className="btn primary rfq-bulk-send-button" disabled={running||otherBusy||!chosen.length||!gateway.connected||!gateway.sendingEnabled||!template.trim()} onClick={sendAll}>{running?'Sending selected requests…':'Send PNG + Caption to '+chosen.length+' Supplier'+(chosen.length===1?'':'s')}</button>
  {(!gateway.connected||!gateway.sendingEnabled)&&<p className="muted tiny" role="status">Automatic PNG sending is unavailable: {gateway.connected?'gateway sending is disabled.':'WhatsApp gateway is disconnected.'} You can still share each selected supplier’s PNG and caption below.</p>}
  {onPrepare&&<button className="btn section" disabled={running||otherBusy||!!preparing||!chosen.length||!template.trim()} onClick={startManual}>Prepare PNG + Caption for {chosen.length} Supplier{chosen.length===1?'':'s'} · Manual sharing</button>}
  {manual.length>0&&<section className="section" aria-label="Manual supplier sharing"><p className="muted tiny">Share separately with each named supplier. On supported phones, choose WhatsApp and the correct recipient in the share sheet. Otherwise download the image and paste its caption in the supplier chat.</p>{manual.map(row=><div className="section" key={row.inv.id}>
   <strong>{row.supplier.name} · +{row.number}</strong>
   <div className="toolbar section"><button className="btn small" disabled={running||otherBusy||!!preparing} onClick={()=>prepare(row)}>{preparing===row.inv.id?'Preparing PNG…':'Prepare PNG · '+row.supplier.name}</button><a className="btn small" href={'/supplier-links?rfq='+encodeURIComponent(rfq.id)+'&supplier='+encodeURIComponent(row.inv.supplier_id)}>Private quote link · {row.supplier.name}</a></div>
   {prepared?.id===row.inv.id&&<><div className="toolbar section">{canShare&&<button className="btn small primary" disabled={running||otherBusy} onClick={sharePrepared}>Share PNG + Caption · {row.supplier.name}</button>}<button className="btn small" onClick={downloadPrepared}>Download PNG</button><button className="btn small" onClick={async()=>{try{await navigator.clipboard.writeText(prepared.caption);setSummary('Caption copied for '+row.supplier.name+'. Attach the downloaded PNG and paste this caption in their chat.')}catch{setSummary('Copy unavailable. Select and copy the caption below.')}}}>Copy caption</button><a className="btn small" href={whatsappUrl(row.number,'')} target="_blank" rel="noopener noreferrer">Open {row.supplier.name} chat</a></div><textarea className="input section" aria-label={'PNG caption for '+row.supplier.name} readOnly rows={4} value={prepared.caption}/></>}
  </div>)}</section>}
  {summary&&<p className="rfq-batch-summary" role="status" aria-live="polite">{summary}</p>}
 </section>
}
