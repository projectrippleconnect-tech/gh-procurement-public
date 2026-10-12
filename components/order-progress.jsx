'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {orderProgress,sriLankaTimestamp} from '@/lib/procurement-journey.mjs'

export function OrderProgress({rfq,items=[],invitations=[],pricedCount=0,refreshKey=''}){
 const[orders,setOrders]=useState([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(false)
 const itemIds=items.map(x=>x.id).sort().join(',')
 useEffect(()=>{let live=true;setLoaded(false);setError(false);setOrders([]);if(!rfq?.id)return;(async()=>{try{
  if(!itemIds){if(live)setLoaded(true);return}
  const quotes=await supabase.from('proc_quote_lines').select('id').in('rfq_item_id',itemIds.split(','));if(quotes.error)throw quotes.error
  const ids=(quotes.data||[]).map(x=>x.id)
  const result=ids.length?await supabase.from('proc_po_lines').select('po:proc_purchase_orders(id,status)').in('source_quote_line_id',ids):{data:[]};if(result.error)throw result.error
  if(live){setOrders([...new Map((result.data||[]).filter(x=>x.po).map(x=>[x.po.id,x.po])).values()]);setLoaded(true)}
 }catch{if(live)setError(true)}})();return()=>{live=false}},[rfq?.id,rfq?.status,itemIds,refreshKey])
 const p=orderProgress({prepared:true,invitations,itemCount:items.length,pricedCount,orders})
 return <div className="order-progress section" role="status"><div><strong>{rfq.rfq_no}</strong><b>{loaded?p.percent+'% complete':error?'Progress unavailable':'Loading progress…'}</b></div><progress aria-label="Order preparation and sending progress" max="100" value={p.percent}/><small>RFQs sent {p.sent}/{p.suppliers} · Items priced {pricedCount}/{items.length} · POs confirmed sent {p.confirmed}/{p.orders}</small>{p.complete&&<p>PO preparation and sending complete. Delivery is tracked separately.</p>}</div>
}

export function StockSubmissionDetails({requirements=[]}){
 const[rows,setRows]=useState([]),[state,setState]=useState('loading')
 const ids=[...new Set(requirements.map(x=>x?.source_count_line_id).filter(Boolean))].sort().join(',')
 useEffect(()=>{let live=true;setRows([]);setState('loading');(async()=>{try{
  if(!ids){if(live)setState('manual');return}
  const lines=await supabase.from('proc_stock_count_lines').select('count_id').in('id',ids.split(','));if(lines.error)throw lines.error
  const counts=[...new Set((lines.data||[]).map(x=>x.count_id))];if(!counts.length){if(live)setState('unavailable');return}
  const result=await supabase.from('proc_stock_counts').select('id,count_no,submitted_at,counted_by').in('id',counts).order('submitted_at',{ascending:false});if(result.error)throw result.error
  const staff=[...new Set((result.data||[]).map(x=>x.counted_by).filter(Boolean))]
  const names=staff.length?await supabase.from('proc_profiles').select('id,display_name').in('id',staff):{data:[]}
  if(live){setRows((result.data||[]).map(x=>({...x,name:names.data?.find(p=>p.id===x.counted_by)?.display_name||'Staff'})));setState('ready')}
 }catch{if(live)setState('unavailable')}})();return()=>{live=false}},[ids])
 return <details className="section stock-source"><summary>Stock submission · {rows.length?sriLankaTimestamp(rows[0].submitted_at):state==='manual'?'Manual purchase request':state==='loading'?'Loading…':'Unavailable'}</summary>{rows.map(x=><p className="muted tiny" key={x.id}>{x.count_no} · {sriLankaTimestamp(x.submitted_at)} · {x.name} · Sri Lanka time</p>)}</details>
}
