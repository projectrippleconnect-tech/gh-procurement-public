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
 const steps=[[1,'Stock'],[2,'Review & buy'],[3,'Orders'],[4,'Receive']]
 const current=active<=3?1:active<=6?2:active===7?3:4
 return <div className="procurement-journey" aria-label="Procurement progress"><div className="procurement-stepbar procurement-stepbar-numbered">{steps.map(([n,label])=><div key={n} className={n===current?'active':'upcoming'}><span>{n}</span><b>{label}</b></div>)}</div><p className="muted tiny">Stock → supplier prices → approved orders → accepted deliveries. Open balances stay outstanding.</p></div>
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
