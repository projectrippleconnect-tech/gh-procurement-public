'use client'
import {useMemo,useState} from 'react'
import {ModernSelect} from './modern-select'
import {supplierListRows} from '@/lib/supplier-list.mjs'

// One A-Z checklist replaces the duplicate suggested-supplier pills and supplier chips.
export function SupplierChecklist({suppliers=[],suggested=[],selected,onChange,kind,onKindChange,t=(k,f)=>f||k}){
 const[search,setSearch]=useState('')
 const matches=useMemo(()=>new Map(suggested.map(s=>[s.supplier_id,s])),[suggested])
 const visible=useMemo(()=>supplierListRows(suppliers,kind,search),[suppliers,kind,search])
 const setOne=(id,checked)=>onChange(prev=>{const next=new Set(prev);checked?next.add(id):next.delete(id);return next})
 const selectShown=()=>onChange(prev=>new Set([...prev,...visible.map(s=>s.id)]))
 const clearSelected=()=>onChange(new Set())
 return <div className="section">
  <div className="toolbar" style={{justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
   <b>{t('requirements.supplier_contacts','Supplier contacts')}</b>
   <span className="muted tiny" aria-live="polite">{selected.size} selected · A–Z</span>
  </div>
  <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(118px,38%)',gap:8,marginTop:8}}>
   <input className="input" type="search" value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search suppliers" placeholder="Search suppliers…" style={{minWidth:0}}/>
   <ModernSelect className="select" aria-label="Supplier type" value={kind} onChange={e=>onKindChange(e.target.value)}>
    <option value="general">General</option><option value="company">Company</option><option value="all">All suppliers</option>
   </ModernSelect>
  </div>
  <div className="toolbar" style={{gap:8,margin:'8px 0'}}>
   <button type="button" className="btn small" disabled={!visible.length} onClick={selectShown}>Select all shown</button>
   <button type="button" className="btn small" disabled={!selected.size} onClick={clearSelected}>Clear selected</button>
   <span className="muted tiny">{visible.length} shown</span>
  </div>
  <div role="group" aria-label="Supplier checklist sorted alphabetically" tabIndex={0} style={{maxHeight:320,overflowY:'auto',overscrollBehavior:'contain',border:'1px solid var(--line)',borderRadius:12,background:'var(--panel)',scrollbarGutter:'stable'}}>
   {visible.map(s=>{
    const match=matches.get(s.id)
    const checked=selected.has(s.id)
    return <label key={s.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,minHeight:54,padding:'8px 12px',borderBottom:'1px solid var(--line)',background:checked?'rgba(255,176,0,.09)':'transparent',cursor:'pointer'}}>
     <span style={{display:'grid',gap:2,minWidth:0,flex:1}}>
      <strong style={{fontSize:14,overflowWrap:'anywhere',lineHeight:1.3}}>{s.name}</strong>
      <span className="muted tiny">{match?`${match.matched_items}/${match.selected_items} items covered${match.unrestricted?' · general':''}`:'Other supplier · override required'}</span>
     </span>
     <input type="checkbox" checked={checked} onChange={e=>setOne(s.id,e.target.checked)} style={{width:20,height:20,flexShrink:0,accentColor:'var(--brand)'}}/>
    </label>
   })}
   {!visible.length&&<div className="muted tiny" style={{padding:14}}>No suppliers match this search.</div>}
  </div>
  <p className="muted tiny" style={{margin:'8px 0 0'}}>Tick suppliers for this RFQ. Non-matching suppliers need a coverage override reason below.</p>
 </div>
}
