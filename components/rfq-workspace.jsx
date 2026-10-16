'use client'
import {useCallback,useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {Rfqs} from './modules-buying'

export function RfqWorkspace(props){
 const [tab,setTab]=useState('general'),[focusedId,setFocusedId]=useState('')
 useEffect(()=>{if(props.initialFilter&&props.initialFilter!=='overdue'){setFocusedId(props.initialFilter);setTab('general')}},[props.initialFilter])
 return <section aria-label="RFQ workspace">
  <div className="rfq-workspace-tabs section" role="tablist" aria-label="RFQ type">
   <button className={'btn '+(tab==='general'?'primary':'')} type="button" role="tab" aria-selected={tab==='general'} onClick={()=>setTab('general')}>General RFQs</button>
   <button className={'btn '+(tab==='company'?'primary':'')} type="button" role="tab" aria-selected={tab==='company'} onClick={()=>setTab('company')}>Company RFQs</button>
  </div>
  {tab==='general'?<Rfqs {...props} initialFilter={focusedId||props.initialFilter}/>:
   <CompanyRfqHistory active={props.activeView==='rfq'} onOpen={id=>{setFocusedId(id);setTab('general')}}/>}
 </section>
}

function CompanyRfqHistory({active,onOpen}){
 const [records,setRecords]=useState([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const load=useCallback(async()=>{
  setBusy(true);setError('')
  try{
   const {data,error}=await supabase.rpc('proc_company_rfq_history',{p_limit:150})
   if(error)throw error
   setRecords(data||[])
  }catch(e){setError(e.message||'Could not load company RFQ history.')}finally{setBusy(false)}
 },[])
 useEffect(()=>{if(active)load()},[active,load])
 const filtered=records.filter(r=>(String(r.rfq_no||'')+' '+String(r.company_name||'')+' '+String(r.rfq_status||'')).toLowerCase().includes(query.trim().toLowerCase()))
 return <div className="card pad section" aria-label="Company RFQ history">
  <div className="sectionhead"><div><h3>Company RFQ History</h3><p className="muted tiny">RFQs prepared for company-list shortages, grouped by company. Sending and quotation progress are kept in the existing RFQ records.</p></div><button type="button" className="btn small" onClick={load} disabled={busy}>{busy?'Refreshing…':'Refresh'}</button></div>
  <input type="search" className="input section" aria-label="Search company RFQs" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find company or RFQ number"/>
  {error&&<p className="error section" role="alert">{error}</p>}
  {!busy&&!filtered.length&&!error&&<p className="muted section">No company RFQs found. When a company stock submission generates an RFQ, it will appear here.</p>}
  <div className="company-rfq-history-rows">{filtered.map(r=><div className="company-rfq-history-row" key={r.rfq_id+':'+r.company_id}>
   <div><strong>{r.company_name}</strong><div className="muted tiny">{r.rfq_no} · {new Date(r.created_at).toLocaleString('en-LK')} · {r.item_count} item(s)</div>
    <div className="muted tiny">Status: {String(r.rfq_status||'').replaceAll('_',' ')} · Suppliers: {r.supplier_count} · WhatsApp accepted: {r.sent_count}{Number(r.failed_count)>0?' · Needs attention: '+r.failed_count:''}</div>
   </div>
   <button type="button" className="btn small" onClick={()=>onOpen(r.rfq_id)}>Open RFQ</button>
  </div>)}</div>
 </div>
}
