'use client'
import {useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {interfaceTranslator} from '@/lib/interface-copy.mjs'
import {qty} from '@/lib/helpers'
import {purchasingCase,WORK_VIEWS,ORDER_STATES} from '@/lib/work-cases.mjs'
import {ItemListSelector} from './purchasing-workspace'

const actionLabels={'Prepare supplier request':'RFQ','Review quantity':'Review','Approve quantity':'Approve','Approve order':'Approve','Compare prices':'Compare','Record delivery':'Receive','Follow up prices':'Follow up'}

function CaseDetails({purchase,canNavigate,navigate,language='en'}){
 const tr=interfaceTranslator(language)
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
  <summary aria-label="Details & history">{tr('Details')}{purchase.attention&&<span className="warn-text" aria-label={tr('Needs attention')}> · !</span>}</summary>
  {open&&<>
   <p className="muted tiny">{purchase.row.requirement_no} · {data?.source_count_no||purchase.row.source_count_no||tr('Manual requirement')}</p>
   {purchase.attention&&<p className="warn-text tiny">{tr(purchase.attention)}</p>}
   {purchase.reserved>0&&<p>{tr('Reserved in unsent orders:')} {qty(purchase.reserved)} {purchase.row.uom}. {tr('Check approval and sending status.')}</p>}
   <div className="toolbar">{purchase.actions.filter(a=>a!==purchase.primaryAction&&a!==purchase.secondaryAction).map(a=><button className="btn small" key={a.view+a.filter+a.label} onClick={()=>navigate(a.view,a.filter,a.step)}>{tr(a.label)}</button>)}</div>
   {state==='loading'&&<p role="status">{tr('Loading documents…')}</p>}
   {state==='error'&&<p role="alert">{tr('Documents could not load.')} <button className="btn small" onClick={()=>setRetry(n=>n+1)}>{tr('Retry')}</button></p>}
   {canNavigate('requirements')&&<button className="btn small" onClick={()=>navigate('requirements','requirement:'+id)}>Stock count &amp; requirement</button>}
   {(documents.rfqs||[]).filter(()=>canNavigate('rfq')).map(q=><button className="btn small" key={q.id} onClick={()=>navigate('rfq',q.id)}>{q.number} · {q.status.replaceAll('_',' ')}</button>)}
   {(documents.orders||[]).filter((p,i,a)=>canNavigate('po')&&a.findIndex(x=>x.id===p.id)===i).map(p=><button className="btn small" key={p.id} onClick={()=>navigate('po',p.id)}>{p.number} · {tr(ORDER_STATES[p.status]||p.status)}{p.quantity_only?' · '+tr('quantity only; price unconfirmed'):''}</button>)}
   {(documents.receipts||[]).map((r,i)=><p className="tiny" key={r.id+'-'+i}>{r.number} · {r.status} · {tr('Accepted:')} {qty(r.accepted)} {purchase.row.uom}</p>)}
  </>}
 </details>
}

export function WorkCases({activeView,can,canNavigate,navigate,revision=0,language='en'}){
 const tr=interfaceTranslator(language)
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
  <div className="work-list-controls"><ItemListSelector value={scope} t={(k,f)=>tr(f)} onChange={value=>{setScope(value);setPage(0)}} allowAll/>
   <label className="work-view-filter"><span>{tr('View')}</span><select className="select" aria-label="Work view" value={tab} onChange={e=>{setTab(e.target.value);setPage(0)}}>{WORK_VIEWS.map(name=><option key={name} value={name}>{tr(name)}{state==='ready'?` · ${counts[name]||0}`:''}</option>)}</select></label>
  </div>
  {state==='loading'?<p role="status">{tr('Loading purchases…')}</p>:state==='error'?<p role="alert">{tr('Work could not load. Refresh work to retry.')}</p>:<>
   {!cases.length&&<p role="status">{tr(tab==='Needs me'?'Nothing needs your action in this view.':'No purchases in this view.')}</p>}
   {cases.map(c=><article key={c.id} className="work-case compact-work-case" aria-labelledby={'case-'+c.id}>
    <div className="work-case-heading"><h3 id={'case-'+c.id}>{c.row.description}{c.row.size?' · '+c.row.size:''}</h3><span className="muted tiny">{tr(c.row.proc_requirement_is_company?'Company':'General')}</span></div>
    <p className="work-case-status"><span>{tr(c.statusLabel)}</span>{!c.history&&c.stillBuy>0&&<strong>{tr('Buy')} {qty(c.stillBuy)} {c.row.uom}</strong>}{!c.history&&c.stillReceive>0&&<strong>{tr('Receive')} {qty(c.stillReceive)} {c.row.uom}</strong>}</p>
    <div className="toolbar work-case-actions">{[c.primaryAction,c.secondaryAction].map((action,i)=>action&&<button key={action.view+action.filter} className={'btn small '+(i===0?'primary':'')} aria-label={tr(action.label)} onClick={()=>navigate(action.view,action.filter,action.step)}>{tr(actionLabels[action.label]||action.label)}</button>)}</div>
    <CaseDetails key={c.id+':'+revision} language={language} purchase={c} canNavigate={canNavigate} navigate={navigate}/>
   </article>)}
   {total>25&&<div className="toolbar"><button className="btn" disabled={page===0} onClick={()=>setPage(p=>p-1)}>{tr('Previous')}</button><span>{tr('Page')} {page+1} {tr('of')} {Math.ceil(total/25)}</span><button className="btn" disabled={(page+1)*25>=total} onClick={()=>setPage(p=>p+1)}>{tr('Next')}</button></div>}
  </>}
 </section>
}
