'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {allRows} from '@/lib/query-pages'
import {qty} from '@/lib/helpers'
import {purchasingCase,WORK_VIEWS,ORDER_STATES} from '@/lib/work-cases.mjs'
import {scopePurchasingQuery} from '@/lib/purchasing-workspace.mjs'
import {ItemListSelector,AttentionBadge} from './purchasing-workspace'

export function WorkCases({activeView,can,canNavigate,navigate}){
 const[scope,setScope]=useState('all'),[tab,setTab]=useState('Needs me'),[rows,setRows]=useState([]),[state,setState]=useState('loading'),[revision,setRevision]=useState(0),[page,setPage]=useState(0)
 const serial=useRef(0)
 useEffect(()=>{
  if(activeView!=='dashboard')return
  const request=++serial.current
  setState('loading')
  allRows(()=>scopePurchasingQuery(supabase.from('proc_v_requirements').select('*,proc_requirement_is_company,proc_work_documents'),scope,'proc_requirement_is_company').order('created_at',{ascending:false}).order('id')).then(result=>{
   if(request!==serial.current)return
   if(result.error){setRows([]);setState('error');return}
   setRows(result.data||[]);setState('ready')
  }).catch(()=>{if(request===serial.current){setRows([]);setState('error')}})
  return()=>{serial.current++}
 },[scope,revision,activeView])
 const cases=useMemo(()=>rows.map(row=>purchasingCase(row,{can,canNavigate})),[rows,can,canNavigate])
 const filtered=cases.filter(c=>c.tab===tab)
 useEffect(()=>setPage(0),[scope,tab,revision])
 return <section className="card pad section" aria-label="Work">
  <div className="sectionhead"><h3>Work</h3><button className="btn small" onClick={()=>setRevision(v=>v+1)}>Refresh work</button></div>
  <ItemListSelector value={scope} onChange={setScope} allowAll/>
  <p className="muted tiny">All items is the default. Stock and document filters do not hide your work.</p>
  <div className="toolbar" aria-label="Work views">{WORK_VIEWS.map(name=><button key={name} type="button" className={'btn '+(tab===name?'primary':'')} aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}{state==='ready'?` · ${cases.filter(c=>c.tab===name).length}`:''}</button>)}</div>
  {state==='loading'?<p role="status">Loading connected purchases…</p>:state==='error'?<p role="alert">Work could not load. Refresh work to retry.</p>:<>
   {!filtered.length&&<p role="status">No purchases in this view.</p>}
   {filtered.slice(page*25,(page+1)*25).map(c=><article key={c.id} className="section work-case" aria-labelledby={'case-'+c.id}>
    <h4 id={'case-'+c.id}>{c.row.requirement_no} · {c.row.description}</h4>
    <p className="muted tiny">{c.row.proc_requirement_is_company?'Company':'General'} · {c.row.source_count_no||'Manual requirement'} · {c.row.status}</p>
    {!c.history&&<p><strong>Still to buy: {qty(c.stillBuy)} {c.row.uom}</strong> · <strong>Still to receive: {qty(c.stillReceive)} {c.row.uom}</strong>{c.reserved>0&&<span> · Reserved in unsent orders: {qty(c.reserved)} {c.row.uom}</span>}</p>}
    <AttentionBadge reason={c.row.approval_status==='held'?c.row.hold_reason||'Review the hold before purchasing.':''}/>
    <div className="toolbar">{c.actions.map(a=><button className="btn" key={a.view+a.filter+a.label} onClick={()=>navigate(a.view,a.filter)}>{a.label}</button>)}{!c.actions.length&&!c.history&&<span className="muted">Waiting for the next permitted action</span>}</div>
    <details className="section"><summary>Connected record · {c.rfqs.length} quotations · {new Set(c.orders.map(p=>p.id)).size} orders · {new Set(c.receipts.map(r=>r.id)).size} receipts</summary>
     <p className="tiny">Case reference: {c.id}</p>
     {canNavigate('requirements')&&<button className="btn small" onClick={()=>navigate('requirements','requirement:'+c.id)}>Stock count &amp; requirement</button>}
     {c.rfqs.map(q=><button className="btn small" key={q.id} disabled={!canNavigate('rfq')} onClick={()=>navigate('rfq',q.id)}>{q.number} · {q.status}</button>)}
     {c.orders.filter((p,i,a)=>a.findIndex(x=>x.id===p.id)===i).map(p=><button className="btn small" key={p.id} disabled={!canNavigate('po')} onClick={()=>navigate('po',p.id)}>{p.number} · {ORDER_STATES[p.status]||p.status}{p.quantity_only?' · quantity approval only; price unconfirmed':''}</button>)}
     {c.receipts.map((r,i)=><p className="tiny" key={r.id+'-'+i}>{r.number} · {r.status} · Accepted: {qty(r.accepted)} {c.row.uom}</p>)}
    </details>
   </article>)}
   {filtered.length>25&&<div className="toolbar"><button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {Math.ceil(filtered.length/25)}</span><button className="btn" disabled={(page+1)*25>=filtered.length} onClick={()=>setPage(p=>p+1)}>Next</button></div>}
  </>}
  <details className="section"><summary>Browse purchasing documents</summary><div className="toolbar">{[['requirements','Requirements'],['rfq','Quotations'],['po','Orders']].filter(([view])=>canNavigate(view)).map(([view,label])=><button key={view} className="btn" onClick={()=>navigate(view,'')}>{label}</button>)}</div></details>
 </section>
}
