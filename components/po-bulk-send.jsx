'use client'

import {useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {allRows} from '@/lib/query-pages'
import {normalizeWhatsAppNumber} from '@/lib/helpers'
import {buildPurchaseOrderCaption,createPurchaseOrderPng} from '@/lib/po-share'
import {runSupplierBatch} from '@/lib/rfq-batch.mjs'
import {poSendBlock} from '@/lib/procurement-flow'

export function PoBulkSend({orderIds=[],company,selection,ready,refreshKey,otherBusy,onBusy,onRefresh}){
 const [orders,setOrders]=useState([]),[selected,setSelected]=useState(new Set()),[loading,setLoading]=useState(true),[running,setRunning]=useState(false),[results,setResults]=useState({}),[summary,setSummary]=useState('')
 const orderScope=orderIds.join(',')
 const mounted=useRef(true),sending=useRef(false),generation=useRef(0)
 async function refresh(){
  const request=++generation.current;setLoading(true)
  if(!orderScope){setOrders([]);setSelected(new Set());setLoading(false);return}
  try{
   const r=await allRows(()=>{let q=supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name,whatsapp,phone)').eq('status','approved').order('created_at').order('id');return orderScope?q.in('id',orderScope.split(',')):q})
   if(r.error)throw r.error
   if(mounted.current&&request===generation.current){setOrders(r.data||[]);setSelected(new Set((r.data||[]).map(po=>po.id)))}
  }catch(e){if(mounted.current&&request===generation.current){setOrders([]);setSummary(e.message||'Could not load approved orders.')}}
  finally{if(mounted.current&&request===generation.current)setLoading(false)}
 }
 useEffect(()=>{mounted.current=true;void refresh();return()=>{mounted.current=false;generation.current++}},[refreshKey,orderScope])
 const eligible=po=>normalizeWhatsAppNumber(po.supplier?.whatsapp||po.supplier?.phone)&&!['accepted','blocked','unknown'].includes(results[po.id]?.status)
 const chosen=orders.filter(po=>selected.has(po.id)&&eligible(po))
 function toggle(id){setSelected(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next})}
 async function sendAll(){
  if(sending.current||otherBusy||loading||!ready||!chosen.length)return
  sending.current=true;setRunning(true);onBusy(true);setSummary('Preparing '+chosen.length+' purchase orders…')
  // Key jobs by PO, so two orders for the same supplier are both sent.
  const jobs=chosen.map(po=>({supplierId:po.id,po}))
  try{
   const {data:{session}}=await supabase.auth.getSession()
   if(!session?.access_token)throw new Error('Sign in again before sending.')
   const headers={Authorization:'Bearer '+session.access_token}
   const outcomes=await runSupplierBatch(jobs,async({po})=>{
    if(mounted.current)setResults(current=>({...current,[po.id]:{status:'sending',message:'Preparing image + caption…'}}))
    const check=await fetch('/api/integrations/whatsapp/po?poId='+encodeURIComponent(po.id),{headers,signal:AbortSignal.timeout(15000)})
    const gateway=await check.json()
    if(!check.ok)throw Object.assign(new Error(gateway.error||'Could not verify WhatsApp status.'),{haltBatch:true})
    const block=poSendBlock({po,canEdit:true,ready:true,gateway})
    if(block)throw Object.assign(new Error(block),{sendStatus:gateway.dispatches?.length?'blocked':'failed',haltBatch:!gateway.connected||!gateway.sendingEnabled})
    const r=await allRows(()=>supabase.from('proc_po_lines').select('*,item:proc_items(item_code,description,size,uom)').eq('po_id',po.id).order('id'))
    if(r.error)throw r.error
    const args={po,lines:r.data,company,selection},caption=buildPurchaseOrderCaption(args),png=await createPurchaseOrderPng(args)
    if(png.blob.size>4_500_000)throw new Error('PO image is too large. Use fewer supplier document fields or PDF.')
    const pngBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(new Error('Could not read PO image.'));reader.readAsDataURL(png.blob)})
    if(!mounted.current)throw Object.assign(new Error('Sending paused; reopen Purchase Orders to continue.'),{haltBatch:true})
    let response,data
    try{
     response=await fetch('/api/integrations/whatsapp/po',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({poId:po.id,pngBase64,caption}),signal:AbortSignal.timeout(45000)})
     data=await response.json()
    }catch{throw Object.assign(new Error('Send response interrupted. Check WhatsApp before resending.'),{sendStatus:'unknown',haltBatch:true})}
    if(!response.ok)throw Object.assign(new Error(data.error||'Could not send PO.'),{sendStatus:response.status===409?'blocked':response.status>=500?'unknown':'failed',haltBatch:[401,403,429].includes(response.status)||response.status>=500})
    return data
   },{shouldStop:()=>!mounted.current,onResult:r=>{if(mounted.current)setResults(current=>({...current,[r.supplierId]:r}))}})
   if(mounted.current)setSummary(outcomes.filter(r=>r.status==='accepted').length+' / '+jobs.length+' POs accepted for sending. Check each supplier’s WhatsApp chat before confirming Sent. Uncertain sends are never retried automatically.')
  }catch(e){if(mounted.current)setSummary(e.message||'Could not start sending.')}
  finally{sending.current=false;onBusy(false);if(mounted.current)setRunning(false);await onRefresh()}
 }
 const labels={sending:'Sending…',accepted:'Accepted ✓',failed:'Not sent',blocked:'Already attempted',unknown:'Check WhatsApp',not_attempted:'Not attempted'}
 return <section className="po-bulk-send section" aria-label="Send all purchase orders">
  <button className="btn primary rfq-bulk-send-button" disabled={loading||running||otherBusy||!ready||!chosen.length} onClick={sendAll}>{loading?'Loading approved POs…':running?'Sending POs…':'Send all POs · '+chosen.length}</button>
  <p className="muted tiny">Approved orders in this batch are selected across every page. Each PO image and caption goes directly to its associated supplier through the connected WhatsApp gateway.</p>
  <details><summary>Choose POs & view sending results ({orders.length})</summary>
   <div className="toolbar section"><button className="btn small" disabled={running||otherBusy} onClick={()=>setSelected(new Set(orders.filter(eligible).map(po=>po.id)))}>Select all</button><button className="btn small" disabled={running||otherBusy} onClick={()=>setSelected(new Set())}>Clear selection</button><button className="btn small" disabled={running||otherBusy||loading} onClick={refresh}>Refresh approved POs</button></div>
   <div className="rfq-recipient-list">{orders.map(po=><div className="rfq-recipient-row" key={po.id}><label><input type="checkbox" aria-label={'Send '+po.po_no+' to '+po.supplier?.name} checked={Boolean(selected.has(po.id)&&eligible(po))} disabled={running||otherBusy||!eligible(po)} onChange={()=>toggle(po.id)}/><span><strong>{po.po_no} · {po.supplier?.name}</strong><small>{po.supplier?.whatsapp||po.supplier?.phone||'Add a supplier WhatsApp number'}</small></span></label><span className="rfq-send-result">{labels[results[po.id]?.status]||'Ready'}</span>{results[po.id]?.message&&<small className="rfq-recipient-message">{results[po.id].message}</small>}</div>)}</div>
  </details>
  {summary&&<p role="status" aria-live="polite" className="rfq-batch-summary">{summary}</p>}
 </section>
}
