'use client'
import {useEffect,useState} from 'react'
import {interfaceTranslator} from '@/lib/interface-copy.mjs'
import {supabase} from '@/lib/supabase'

// These tasks do not have a connected purchasing case. Purchasing documents
// remain directly accessible for roles without requirement-screen access.
export function WorkExtras({activeView,canNavigate,can=()=>false,navigate,revision=0,includePurchasing=false,language='en'}){
 const tr=interfaceTranslator(language)
 const[items,setItems]=useState([]),[error,setError]=useState(false)
 const purchasing=canNavigate('requirements'),stock=canNavigate('stock'),urgent=canNavigate('urgent_actions'),automation=urgent&&['procurement.requirements.manage','procurement.rfq.manage','procurement.orders.edit','admin.audit.view'].some(can)
 useEffect(()=>{
  if(activeView!=='dashboard')return
  let cancelled=false;setError(false)
  const definitions=[
   ...(purchasing&&canNavigate('reports')?[['Not ordered in 90 days','reports','order_recency',()=>supabase.from('proc_v_item_order_recency').select('item_id',{count:'exact',head:true}).or('last_ordered_at.is.null,days_since_order.gte.90')]]:[]),
   ...(stock?[['Count scheduled stock','stock','due',()=>supabase.from('proc_v_stock_check_due').select('item_id',{count:'exact',head:true}).eq('is_due',true)]]:[]),
   ...(urgent?[[includePurchasing?'Urgent requests':'New-item requests','urgent_actions','',()=>supabase.from('proc_v_urgent_actions').select('action_id',{count:'exact',head:true}).in('action_type',includePurchasing?['existing_item','missing_item']:['missing_item'])]]:[])
   ,...(automation?[['Sending / automation issues','urgent_actions','',()=>supabase.from('proc_automation_jobs').select('id',{count:'exact',head:true}).in('status',['needs_action','failed'])]]:[])
  ]
  Promise.all(definitions.map(async([label,view,filter,query])=>{const r=await query();return {label,view,filter,count:r.count,error:!!r.error||!Number.isInteger(r.count)}})).then(result=>{if(!cancelled){setItems(result);setError(result.some(r=>r.error))}}).catch(()=>{if(!cancelled)setError(true)})
  return()=>{cancelled=true}
 },[activeView,revision,purchasing,stock,urgent,automation,includePurchasing])
 const shown=items.filter(x=>x.error||x.count>0)
 if(!shown.length&&!error&&!includePurchasing)return null
 return <section className="section" aria-label="Other tasks">
  {error&&<p role="alert">{tr('Some additional tasks could not load. Refresh work to retry.')}</p>}
  <div className="toolbar">{shown.map(x=><button className="btn small" key={x.label} onClick={()=>navigate(x.view,x.filter)}>{tr(x.label)}{x.error?' · '+tr('Unavailable'):` · ${x.count}`}</button>)}
  {includePurchasing&&[['requirements','Review quantities'],['rfq','Quotations'],['po','Orders'],['receiving','Deliveries']].filter(([view])=>canNavigate(view)).map(([view,label])=><button key={view} className="btn" onClick={()=>navigate(view,'')}>{tr(label)}</button>)}</div>
 </section>
}
