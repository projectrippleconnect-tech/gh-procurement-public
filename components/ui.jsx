'use client'

import {PROCUREMENT_STEPS} from '@/lib/workflow-guide.mjs'

export const NAV=[
 ['dashboard','⌂','Home'],['stock','✓','Stock Entry'],['urgent_actions','!','Exceptions'],['requirements','≡','Review'],
 ['company_lists','CL','Company Lists'],['suppliers','♢','Suppliers'],['price_lists','₨','Price Lists'],['rfq','Q','RFQs & Quotes'],['po','PO','Orders'],
 ['invoices','▤','Invoices'],['receiving','⇩','Receive Goods'],['items','□','Items'],
 ['reports','↗','Reports'],['admin','⚙','Admin']
]

export const statusClass=s=>{
 const v=String(s||'').toLowerCase()
 if(v.includes('received')||['approved','matched','posted','active','quoted','sent'].includes(v))return'good'
 if(v.includes('cancel')||['rejected','variance','inactive','overdue'].includes(v))return'bad'
 if(v.includes('pending')||v.includes('partial')||['open','draft','quoting'].includes(v))return'warn'
 return'info'
}

export const Badge=({children})=><span className={'badge '+statusClass(children)}>{typeof children==='string'?children.replaceAll('_',' '):children??'—'}</span>
export const Err=({v})=>v?<div className="error section" role="alert">{v}</div>:null
export const Empty=({children='Nothing to show.'})=><div className="empty">{children}</div>

export function WorkflowNavigation({view,step=1,onStep,canStep,navigate,canNavigate,t=(k,f)=>f||k}){
 if(!['stock','requirements','rfq','po','receiving'].includes(view))return null
 const current=view==='receiving'?{title:'Receive delivery',hint:'Choose the purchase order and enter the quantities actually received.'}:PROCUREMENT_STEPS.find(s=>s.id===step)||PROCUREMENT_STEPS[0]
 const available=PROCUREMENT_STEPS.filter(s=>canStep(s.id))
 const previous=[...available].reverse().find(s=>s.id<step),next=available.find(s=>s.id>step)
 return <nav className="workflow-navigation guided-navigation" aria-label="Guided procurement navigation">
  <div className="guide-title"><div><small>{view==='receiving'?'DELIVERY · AFTER STEP 6':'STEP '+step+' OF 6'}</small><strong>{view==='receiving'?current.title:t('guide.step'+step,current.title)}</strong></div><span className="guide-progress" aria-label={'Step '+step+' of 6'}>{PROCUREMENT_STEPS.map(s=><i key={s.id} className={s.id===step?'current':''}/>)}</span></div>
  <p>{view==='receiving'?current.hint:t('guide.hint'+step,current.hint)}</p>
  <div className="guide-controls"><button className="btn" aria-label="Previous procurement step" disabled={!previous} onClick={()=>onStep(previous.id)}>← Back</button><label className="guide-section"><span className="sr-only">Go to procurement section</span><select className="select" aria-label="Go to procurement section" value={step} onChange={e=>onStep(Number(e.target.value))}>{available.map(s=><option key={s.id} value={s.id}>{s.id} · {s.title}</option>)}</select></label><button className="btn primary" aria-label="Next procurement step" disabled={!next} onClick={()=>onStep(next.id)}>Next →</button></div>
  {step===6&&<div className="guide-order-links">{canNavigate('po')&&<button className="btn small" onClick={()=>navigate('po')}>Open purchase orders →</button>}{canNavigate('receiving')&&<button className="btn small" onClick={()=>navigate('receiving')}>Receive delivery →</button>}</div>}
 </nav>
}

export function fieldEnabled(fields,module,key){
 const x=fields?.find(f=>f.module_key===module&&f.field_key===key)
 return x?x.enabled:true
}
export function fieldLabel(fields,module,key,fallback){
 return fields?.find(f=>f.module_key===module&&f.field_key===key)?.label||fallback||key.replaceAll('_',' ')
}
export function configuredColumns(fields,module,defaults){
 return defaults
  .filter(c=>fieldEnabled(fields,module,c.key))
  .map(c=>({...c,label:fieldLabel(fields,module,c.key,c.label)}))
}

export function DataTable({columns,rows,rowKey='id',mobileCards=false}){
 if(!rows?.length)return <Empty/>
 return <>
  <div className={'tablewrap '+(mobileCards?'desktop-table':'')}>
   <table className="table"><thead><tr>{columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead>
    <tbody>{rows.map((r,i)=><tr key={r[rowKey]||i}>{columns.map(c=><td key={c.key}>{c.render?c.render(r):c.key==='status'?<Badge>{r[c.key]}</Badge>:String(r[c.key]??'—')}</td>)}</tr>)}</tbody>
   </table>
  </div>
  {mobileCards&&<div className="mobile-card-list">{rows.map((r,i)=>{
   const visible=columns.filter(c=>!c.mobileHidden)
   const headline=visible.slice(0,2)
   const actions=visible.filter(c=>/^(actions?|manage|select)$/i.test(c.key)&&!headline.includes(c))
   const more=visible.filter(c=>!headline.includes(c)&&!actions.includes(c))
   const value=c=>c.render?c.render(r):c.key==='status'?<Badge>{r[c.key]}</Badge>:String(r[c.key]??'—')
   return <div key={r[rowKey]||i} style={{padding:'9px 2px',borderBottom:'1px solid var(--border, #334155)',minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,minWidth:0}}>
     <div style={{flex:'1 1 auto',minWidth:0}}>
      {headline.map((c,j)=><div key={c.key} style={{fontSize:j===0?14:12,overflowWrap:'anywhere'}}>{j===0?<strong>{value(c)}</strong>:<span className="muted">{c.label}: {value(c)}</span>}</div>)}
     </div>
     {actions.map(c=><div key={c.key} style={{flex:'0 0 auto'}}>{value(c)}</div>)}
    </div>
    {more.length>0&&<details style={{marginTop:3}}><summary className="muted tiny" style={{cursor:'pointer',padding:'4px 0'}}>More details</summary>
     {more.map(c=><div className="mobile-data-row" key={c.key} style={{padding:'6px 0'}}><span>{c.label}</span><div>{value(c)}</div></div>)}
    </details>}
   </div>
  })}</div>}
 </>
}

export function Toggle({checked,onChange,label,disabled=false}){
 return <label className={'toggle-row '+(disabled?'disabled':'')}><span>{label}</span><input type="checkbox" checked={!!checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><i/></label>
}

export function Modal({open,title,onClose,children,wide=false}){
 if(!open)return null
 return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose?.()}><div className={'modal card '+(wide?'wide':'')}><div className="modal-head"><h3>{title}</h3><button className="btn small" onClick={onClose}>Close</button></div>{children}</div></div>
}

export function ListPages({total,page,onChange,pageSize=50,label='Results'}){
 if(total<=pageSize)return null
 const last=Math.max(0,Math.ceil(total/pageSize)-1)
 const current=Math.min(page,last)
 return <nav className="toolbar section" aria-label={label+' pages'}>
  <button className="btn small" disabled={current===0} onClick={()=>onChange(current-1)}>Previous</button>
  <span className="muted tiny" role="status">{label}: {current*pageSize+1}–{Math.min((current+1)*pageSize,total)} of {total}</span>
  <button className="btn small" disabled={current===last} onClick={()=>onChange(current+1)}>Next</button>
 </nav>
}
