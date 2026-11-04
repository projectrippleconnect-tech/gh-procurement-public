'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {money} from '@/lib/helpers'

export function BusinessOverview(){
 const[open,setOpen]=useState(false),[revision,setRevision]=useState(0),[data,setData]=useState(null),[state,setState]=useState('idle')
 useEffect(()=>{
  if(!open)return
  let cancelled=false;setState('loading')
  supabase.from('proc_v_dashboard').select('*').single().then(r=>{if(!cancelled){setData(r.data);setState(r.error?'error':'ready')}}).catch(()=>{if(!cancelled)setState('error')})
  return()=>{cancelled=true}
 },[open,revision])
 return <details className="section" onToggle={e=>setOpen(e.currentTarget.open)}><summary>Business totals</summary>
  {state==='loading'?<p role="status">Loading totals…</p>:state==='error'?<p role="alert">Totals unavailable. <button className="btn small" onClick={()=>setRevision(n=>n+1)}>Retry</button></p>:state==='ready'&&<dl className="business-totals">{[['Active items',data?.active_items],['Open requirements',data?.open_requirements],['Still to order',data?.still_to_order],['Awaiting receipt',data?.awaiting_receipt],['Open orders',data?.open_pos],['Order value',money(data?.po_value)],['Invoice variances',data?.invoice_variances]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value??'—'}</dd></div>)}</dl>}
 </details>
}
