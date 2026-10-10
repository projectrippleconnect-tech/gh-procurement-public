'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {allRows} from '@/lib/query-pages'
import {itemTitle,money,qty} from '@/lib/helpers'
import {nextRequirementAction} from '@/lib/procurement-flow'
import {Badge,Modal} from './ui'

export function ItemActivity({row,onClose,can,navigate}){
 const[data,setData]=useState(null),[error,setError]=useState('')
 useEffect(()=>{let cancelled=false;(async()=>{try{
  const tasks={}
  if(can('procurement.orders.view'))tasks.orders=allRows(()=>supabase.from('proc_po_lines').select('*,po:proc_purchase_orders(po_no,status,supplier_id,expected_date,supplier:proc_suppliers(name)),grn:proc_grn_lines(accepted_qty,rejected_qty,receipt:proc_grns(grn_no,status,received_date))').eq('requirement_id',row.id).order('id'))
  if(can('procurement.rfq.view'))tasks.requests=allRows(()=>supabase.from('proc_rfq_items').select('*,rfq:proc_rfqs(rfq_no,status,due_date),quotes:proc_quote_lines(unit_price,available_qty,lead_days,quote:proc_quotes(status,valid_until,supplier:proc_suppliers(name)))').eq('requirement_id',row.id).order('id'))
  if(can('receiving.view'))tasks.rejections=allRows(()=>supabase.from('proc_v_rejection_cases').select('*').eq('item_id',row.item_id).neq('status','resolved').order('created_at',{ascending:false}))
  const entries=await Promise.all(Object.entries(tasks).map(async([key,task])=>{const r=await task;if(r.error)throw r.error;return[key,r.data||[]]}))
  if(!cancelled)setData(Object.fromEntries(entries))
 }catch(e){if(!cancelled)setError(e.message)}})();return()=>{cancelled=true}},[row.id,row.item_id,can])
 return <Modal open title={itemTitle(row)} onClose={onClose} wide><p>{row.requirement_no} · {row.category} · {row.uom}</p><div className="stock-mobile-grid"><div><span>Current stock</span><b>{qty(row.current_stock)}</b></div><div><span>Approved need</span><b>{qty(row.adjusted_qty)}</b></div><div><span>Still to order</span><b>{qty(row.remaining_to_order)}</b></div><div><span>Awaiting delivery</span><b>{qty(row.ordered_not_received)}</b></div></div><p><strong>Next: {nextRequirementAction(row)}</strong></p><p className="muted tiny">Last count: {row.last_counted_at?new Date(row.last_counted_at).toLocaleString():'Not recorded'} · Stock submission: {row.source_count_no||'Manual request'}</p>{row.hold_reason&&<p>Hold: {row.hold_reason}</p>}{error&&<div role="alert" className="error">{error}</div>}{!data&&!error&&<p role="status">Loading item history…</p>}
 {data?.requests&&<><h4>Supplier prices / requests</h4>{data.requests.length===0?<p>No RFQ yet.</p>:data.requests.map(r=><div className="mobile-data-card" key={r.id}><strong>{r.rfq?.rfq_no}</strong> <Badge>{r.rfq?.status}</Badge>{(r.quotes||[]).map((q,i)=><p key={i}>{q.quote?.supplier?.name} · {money(q.unit_price)} / {row.uom} · {q.available_qty==null?'Availability unconfirmed':qty(q.available_qty)+' available'} · Valid until {q.quote?.valid_until||'not specified'}</p>)}{!(r.quotes||[]).length&&<p>Awaiting prices</p>}</div>)}</>}
 {data?.orders&&<><h4>Orders and deliveries</h4>{data.orders.length===0?<p>No PO yet.</p>:data.orders.map(l=><div className="mobile-data-card" key={l.id}><strong>{l.po?.po_no} · {l.po?.supplier?.name}</strong> <Badge>{l.po?.status}</Badge><p>Ordered {qty(l.qty)} · Cancelled {qty(l.cancelled_qty)} · Expected {l.po?.expected_date||'not specified'}</p>{(l.grn||[]).filter(g=>g.receipt?.status==='posted').map((g,i)=><p key={i}>{g.receipt?.grn_no} · {g.receipt?.received_date} · Accepted {qty(g.accepted_qty)} · Rejected {qty(g.rejected_qty)}</p>)}<div className="toolbar">{can('procurement.orders.view')&&<button className="btn small" onClick={()=>navigate('po',l.po_id)}>Open order</button>}{can('receiving.view')&&['sent','partially_received'].includes(l.po?.status)&&<button className="btn small primary" onClick={()=>navigate('receiving',l.po_id)}>Receive delivery</button>}</div></div>)}</>}
 {data?.rejections?.length>0&&<><h4>Open rejected-goods cases for this item</h4>{data.rejections.map(c=><p key={c.id}>{c.po_no} · {qty(c.rejected_qty)} · {c.rejection_reason} · <Badge>{c.status}</Badge></p>)}</>}
 </Modal>
}
