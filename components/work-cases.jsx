'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {qty} from '@/lib/helpers'
import {purchasingCase,WORK_VIEWS,ORDER_STATES} from '@/lib/work-cases.mjs'
import {ItemListSelector,AttentionBadge} from './purchasing-workspace'

function CaseDetails({purchase,canNavigate,navigate}){
 const[data,setData]=useState(null),[state,setState]=useState('idle'),[open,setOpen]=useState(false),[retry,setRetry]=useState(0)
 const id=purchase.id
 useEffect(()=>{
  if(!open)return
  let cancelled=false;setState('loading')
  supabase.from('proc_v_requirements').select('id,source_count_no,proc_work_documents').eq('id',id).single().then(r=>{
   if(cancelled)return
   if(r.error){setState('error');return}
   setData(r.data);setState('ready')
  }).catch(()=>{if(!cancelled)setState('error')})
  return()=>{cancelled=true}
 },[open,id,retry])
 const documents=data?.proc_work_documents||{}
 return <details className="work-case-details" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Details &amp; history</summary>
  {open&&<>
   <p className="muted tiny">{purchase.row.requirement_no} · {data?.source_count_no||purchase.row.source_count_no||'Manual requirement'}</p>
   {purchase.reserved>0&&<p>Reserved in unsent orders: {qty(purchase.reserved)} {purchase.row.uom}. Check approval and sending status.</p>}
   <div className="toolbar">{purchase.actions.filter(a=>a!==purchase.primaryAction&&a!==purchase.secondaryAction).map(a=><button className="btn small" key={a.view+a.filter+a.label} onClick={()=>navigate(a.view,a.filter)}>{a.label}</button>)}</div>
   {state==='loading'&&<p role="status">Loading documents…</p>}
   {state==='error'&&<p role="alert">Documents could not load. <button className="btn small" onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
   {canNavigate('requirements')&&<button className="btn small" onClick={()=>navigate('requirements','requirement:'+id)}>Stock count &amp; requirement</button>}
   {(documents.rfqs||[]).filter(()=>canNavigate('rfq')).map(q=><button className="btn small" key={q.id} onClick={()=>navigate('rfq',q.id)}>{q.number} · {q.status.replaceAll('_',' ')}</button>)}
   {(documents.orders||[]).filter((p,i,a)=>canNavigate('po')&&a.findIndex(x=>x.id===p.id)===i).map(p=><button className="btn small" key={p.id} onClick={()=>navigate('po',p.id)}>{p.number} · {ORDER_STATES[p.status]||p.status}{p.quantity_only?' · quantity only; price unconfirmed':''}</button>)}
   {(documents.receipts||[]).map((r,i)=><p className="tiny" key={r.id+'-'+i}>{r.number} · {r.status} · Accepted: {qty(r.accepted)} {purchase.row.uom}</p>)}
  </>}
 </details>
}

export function WorkCases({activeView,can,canNavigate,navigate,revision=0}){
 const[scope,setScope]=useState('all'),[tab,setTab]=useState('Needs me'),[rows,setRows]=useState([]),[counts,setCounts]=useState({}),[state,setState]=useState('loading'),[page,setPage]=useState(0)
 const serial=useRef(0)
 const views=['requirements','rfq','po','receiving'].filter(canNavigate).join(',')
 useEffect(()=>{
  if(activeView!=='dashboard')return
  const request=++serial.current;setState('loading')
  supabase.rpc('proc_work_page_v1',{p_scope:scope,p_tab:tab,p_page:page,p_views:views.split(',').filter(Boolean)}).then(result=>{
   if(request!==serial.current)return
   if(result.error){setRows([]);setCounts({});setState('error');return}
   const nextCounts=result.data?.counts||{},total=Number(nextCounts[tab]||0)
   if(page>0&&page*25>=total){setPage(Math.max(0,Math.ceil(total/25)-1));return}
   setRows(result.data?.rows||[]);setCounts(nextCounts);setState('ready')
  }).catch(()=>{if(request===serial.current){setRows([]);setCounts({});setState('error')}})
  return()=>{serial.current++}
 },[scope,tab,page,revision,activeView,views])
 const cases=useMemo(()=>rows.map(row=>purchasingCase(row,{can,canNavigate})),[rows,can,canNavigate])
 const total=Number(counts[tab]||0)
 return <section className="work-list" aria-label="Connected purchases" aria-busy={state==='loading'}>
  <div className="work-list-controls"><ItemListSelector value={scope} onChange={value=>{setScope(value);setPage(0)}} allowAll/>
   <div className="toolbar" aria-label="Work views">{WORK_VIEWS.map(name=><button key={name} type="button" className={'btn '+(tab===name?'primary':'')} aria-pressed={tab===name} onClick={()=>{setTab(name);setPage(0)}}>{name}{state==='ready'?` · ${counts[name]||0}`:''}</button>)}</div>
  </div>
  {state==='loading'?<p role="status">Loading purchases…</p>:state==='error'?<p role="alert">Work could not load. Refresh work to retry.</p>:<>
   {!cases.length&&<p role="status">{tab==='Needs me'?'Nothing needs your action in this view.':'No purchases in this view.'}</p>}
   {cases.map(c=><article key={c.id} className="work-case compact-work-case" aria-labelledby={'case-'+c.id}>
    <div className="work-case-heading"><h3 id={'case-'+c.id}>{c.row.description}{c.row.size?' · '+c.row.size:''}</h3><span className="muted tiny">{c.row.proc_requirement_is_company?'Company':'General'}</span></div>
    <p className="work-case-status">{c.statusLabel}</p>
    {!c.history&&(c.stillBuy>0||c.stillReceive>0)&&<p className="work-case-balances">{c.stillBuy>0&&<strong>Buy {qty(c.stillBuy)} {c.row.uom}</strong>}{c.stillReceive>0&&<strong>Receive {qty(c.stillReceive)} {c.row.uom}</strong>}</p>}
    <AttentionBadge reason={c.attention}/>
    <div className="toolbar">{c.primaryAction&&<button className="btn primary" onClick={()=>navigate(c.primaryAction.view,c.primaryAction.filter)}>{c.primaryAction.label}</button>}{c.secondaryAction&&<button className="btn small" onClick={()=>navigate(c.secondaryAction.view,c.secondaryAction.filter)}>{c.secondaryAction.label}</button>}</div>
    <CaseDetails key={c.id+':'+revision} purchase={c} canNavigate={canNavigate} navigate={navigate}/>
   </article>)}
   {total>25&&<div className="toolbar"><button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {Math.ceil(total/25)}</span><button className="btn" disabled={(page+1)*25>=total} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
  </>}
 </section>
}
