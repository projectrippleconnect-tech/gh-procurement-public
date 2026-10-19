'use client'

import {ModernSelect} from './modern-select'
import {uppercaseItemText} from '@/lib/item-text.mjs'
import {visibleWorkflowStages} from '@/lib/workflow-visibility.mjs'
import {useEffect,useState} from 'react'
import {createPortal} from 'react-dom'


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

export function WorkflowNavigation({view,navigate,canNavigate}){
 // Unauthorized stages must not appear as disabled buttons or in step counts.
 const stages=visibleWorkflowStages(view,canNavigate)
 if(!stages.length)return null
 const index=stages.findIndex(([,target])=>target===view)
 return <nav className="workflow-navigation workflow-step-nav" aria-label="Guided procurement navigation">
  <div className="workflow-step-heading">Step {index+1} of {stages.length} · {stages[index][0]}</div>
  <div className="workflow-step-tabs">{stages.map(([label,target,icon],i)=><button key={target} type="button" className={i===index?'active':''} aria-current={i===index?'step':undefined} aria-label={label} title={`Step ${i+1}: ${label}`} onClick={()=>navigate(target)}><span aria-hidden="true">{icon}</span><span>{label}</span></button>)}</div>
 </nav>
}

// The mobile action occupies a real header slot, never the stock rows.
export function StockSubmitAction({active=true,children}){
 const [target,setTarget]=useState(null)
 const [mobile,setMobile]=useState(false)
 useEffect(()=>{
  const media=window.matchMedia('(max-width:700px)')
  const update=()=>setMobile(media.matches)
  setTarget(document.getElementById('stock-header-action'));update()
  media.addEventListener('change',update)
  return()=>media.removeEventListener('change',update)
 },[])
 if(!active)return null
 return mobile&&target?createPortal(children,target):children
}

export function ItemLabel({item={}}){return <>{uppercaseItemText(item.description||item.item_code||'Item')}{item.size&&<span className="work-item-size"> · {uppercaseItemText(item.size)}</span>}</>}

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
