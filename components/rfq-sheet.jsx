'use client'
import {useMemo,useState} from 'react'
import {money,qty,itemTitle} from '@/lib/helpers'
import {matchesRfqItem,quoteSheetRows,supplierRequestItems} from '@/lib/rfq-sheet'

export function SupplierRequestSelection({items,invitation,scopes,onSave,disabled=false}){
 const initial=supplierRequestItems(items,invitation,scopes)
 const[selected,setSelected]=useState(()=>new Set(initial.map(x=>x.id)))
 const[search,setSearch]=useState(''),[category,setCategory]=useState('')
 const visible=items.filter(i=>matchesRfqItem(i,search,category))
 const categories=[...new Set(items.map(i=>i.requirement?.item?.category).filter(Boolean))].sort()
 function toggle(id,on){setSelected(current=>{const next=new Set(current);on?next.add(id):next.delete(id);return next})}
 function bulk(on){setSelected(current=>{const next=new Set(current);visible.forEach(i=>on?next.add(i.id):next.delete(i.id));return next})}
 return <details className="section"><summary>Choose request items · {initial.length} of {items.length} saved</summary>
  <p className="muted tiny">Choose the items this supplier should receive. The master RFQ and other suppliers stay intact. Save before exporting or sending.</p>
  <div className="formgrid"><input aria-label="Search request items" className="input" placeholder="Search item, size or code" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Request category" className="select" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>
  <div className="toolbar section"><button type="button" className="btn small" disabled={disabled} onClick={()=>setSelected(new Set(visible.map(i=>i.id)))}>Use Visible Items Only</button><button type="button" className="btn small" disabled={disabled} onClick={()=>bulk(true)}>Add visible items</button><button type="button" className="btn small" disabled={disabled} onClick={()=>bulk(false)}>Clear visible items</button><span className="muted tiny">{selected.size} selected</span></div>
  <div className="rfq-request-list">{visible.map(i=><label key={i.id}><input type="checkbox" disabled={disabled} checked={selected.has(i.id)} onChange={e=>toggle(i.id,e.target.checked)}/><span>{itemTitle(i.requirement?.item||{})} · {qty(i.requested_qty)}</span></label>)}</div>
  <button type="button" className="btn primary section" disabled={disabled||!selected.size} onClick={()=>onSave([...selected])}>Save Request Items</button>
 </details>
}

export function RfqComparisonSheet({items,comparison,invitations,supplierName,canEdit,busy,onReview,onOrderSelection,onBackToEntry}){
 const[search,setSearch]=useState(''),[filter,setFilter]=useState('all')
 const rows=useMemo(()=>quoteSheetRows(items,comparison,search,filter),[items,comparison,search,filter])
 const supplierIds=[...new Set([...invitations.map(x=>x.supplier_id),...comparison.map(x=>x.supplier_id)])]
 const priced=new Set(comparison.map(x=>x.rfq_item_id))
 return <section className="section" aria-label="Supplier price comparison">
  <div className="sectionhead"><h3>Supplier Price Comparison</h3><button type="button" className="btn small" onClick={onBackToEntry}>Back to Price Entry</button></div>
  <p className="muted tiny">{items.length} items · {priced.size} priced · {items.length-priced.size} missing. Swipe sideways for suppliers; scroll down for items. Green marks every lowest unit price, including ties. Only saved, valid quotes appear.</p>
  <div className="formgrid"><input aria-label="Search comparison items" className="input" placeholder="Search comparison items" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="Comparison filter" className="select" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All items</option><option value="missing">Missing all prices</option><option value="priced">Priced items</option></select></div>
  <div className="tablewrap rfq-price-sheet section" tabIndex={0} role="region" aria-label="Scrollable supplier prices"><table className="table"><thead><tr><th className="rfq-sheet-item">Item / size · Order?</th><th>Qty</th>{supplierIds.map(id=><th key={id}>{supplierName(id)}<div className="muted tiny">{comparison.filter(q=>q.supplier_id===id).length} priced</div></th>)}<th>Lowest · supplier</th></tr></thead><tbody>{rows.map(({row,quotes,lowest})=><tr key={row.id}>
   <th className="rfq-sheet-item" scope="row"><label><input type="checkbox" disabled={!canEdit||busy} checked={row.selected_for_po!==false} onChange={e=>onOrderSelection(row,e.target.checked)}/><span>{itemTitle(row.requirement?.item||{})}</span></label></th><td>{qty(row.requested_qty)}</td>
   {supplierIds.map(id=>{const q=quotes.find(x=>x.supplier_id===id),best=q&&Number(q.unit_price)===lowest;return <td key={id} className={best?'rfq-best-price':''}>{q?<><strong>{money(q.unit_price)}</strong>{best&&<div className="tiny">Lowest</div>}</>:<span className="muted tiny">No price</span>}</td>})}
   <td>{lowest===null?<span className="rfq-missing-price">Missing price</span>:<><strong>{money(lowest)}</strong><div className="tiny">{quotes.filter(q=>Number(q.unit_price)===lowest).map(q=>q.supplier_name||supplierName(q.supplier_id)).join(' / ')}</div></>}</td>
  </tr>)}</tbody></table>{!rows.length&&<p className="muted">No matching items.</p>}</div>
  {canEdit&&<button type="button" className="btn good section" disabled={busy||!priced.size} onClick={onReview}>Review & Create Supplier Orders</button>}
  <p className="muted tiny">One valid quote is enough. Review quantities and supplier totals before final confirmation. Items without a price remain outstanding. The order review also considers delivery and existing commercial terms.</p>
 </section>
}
