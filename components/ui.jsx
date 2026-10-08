'use client'

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

export const Badge=({children})=><span className={'badge '+statusClass(children)}>{String(children||'—').replaceAll('_',' ')}</span>
export const Err=({v})=>v?<div className="error section">{v}</div>:null
export const Empty=({children='Nothing to show.'})=><div className="empty">{children}</div>

export function ProcurementPath({active=4,counts={},t=(k,f)=>f||k}){
 const steps=[
  [4,t('journey.review','Review')],
  [5,t('journey.rfq','Send RFQ')],
  [6,t('journey.quotes','Quotes')],
  [7,t('journey.order','Order')]
 ]
 return <div className="procurement-journey" aria-label={t('journey.label','Procurement progress')}>
  <div className="procurement-completed-strip">
   <b><span>✓</span>1 · {t('journey.enter_stock','Enter stock')}</b>
   <i>→</i>
   <b><span>✓</span>2 · {t('journey.submit_stock','Submit stock')}</b>
   <i>→</i>
   <b><span>✓</span>3 · {t('journey.stock_done','Done')}</b>
  </div>
  <div className="procurement-stepbar procurement-stepbar-numbered">
   {steps.map(([n,label])=>{
    const state=n<active?'done':n===active?'active':'upcoming'
    const count=n===4?counts.review:n===5?counts.rfq:n===6?counts.quotes:n===7?counts.orders:null
    return <div className={state} key={n}><span>{n<active?'✓':n}</span><b>{label}</b>{count!==null&&count!==undefined&&<small>{count}</small>}</div>
   })}
  </div>
 </div>
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
  {mobileCards&&<div className="mobile-card-list">{rows.map((r,i)=><div className="mobile-data-card" key={r[rowKey]||i}>{columns.map(c=><div className="mobile-data-row" key={c.key}><span>{c.label}</span><div>{c.render?c.render(r):c.key==='status'?<Badge>{r[c.key]}</Badge>:String(r[c.key]??'—')}</div></div>)}</div>)}</div>}
 </>
}

export function Toggle({checked,onChange,label,disabled=false}){
 return <label className={'toggle-row '+(disabled?'disabled':'')}><span>{label}</span><input type="checkbox" checked={!!checked} disabled={disabled} onChange={e=>onChange(e.target.checked)}/><i/></label>
}

export function Modal({open,title,onClose,children,wide=false}){
 if(!open)return null
 return <div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose?.()}><div className={'modal card '+(wide?'wide':'')}><div className="modal-head"><h3>{title}</h3><button className="btn small" onClick={onClose}>Close</button></div>{children}</div></div>
}
