'use client'
import {useMemo,useState,useEffect} from 'react'
import {supabase} from '@/lib/supabase'
import {sectionPaths,validSectionParent} from '@/lib/company-section-tree.mjs'

const formDefault={name:'',parent_id:'',color:'',sort_order:0}
export function CompanySectionManager({company,sections=[],rows=[],onChanged,flash,fail}){
 const[form,setForm]=useState(formDefault),[editId,setEditId]=useState(''),[selected,setSelected]=useState({}),[target,setTarget]=useState(''),[search,setSearch]=useState(''),[busy,setBusy]=useState(false)
 useEffect(()=>{setForm(formDefault);setEditId('');setSelected({});setTarget('');setSearch('')},[company?.id])
 const paths=useMemo(()=>sectionPaths(sections),[sections])
 const ordered=useMemo(()=>[...sections].filter(s=>s.active!==false).sort((a,b)=>(paths.get(a.id)||'').localeCompare(paths.get(b.id)||'',undefined,{numeric:true})),[sections,paths])
 const matching=useMemo(()=>rows.filter(r=>[r.item?.description,r.item?.size,r.item?.item_code].join(' ').toLowerCase().includes(search.toLowerCase())).slice(0,300),[rows,search])
 const count=Object.values(selected).filter(Boolean).length
 const startEdit=s=>{setEditId(s.id);setForm({name:s.name,parent_id:s.parent_id||'',sort_order:s.sort_order||0,color:s.color||''})}
 const run=async (task)=>{
  if(busy)return
  setBusy(true)
  try{await task();await onChanged()}catch(e){fail(e)}finally{setBusy(false)}
 }
 async function saveSection(){
  if(!company?.id||!form.name.trim())throw new Error('Enter a section name.')
  if(editId&&!validSectionParent(sections,editId,form.parent_id))throw new Error('Cannot move a section inside itself or its descendants.')
  const changes={name:form.name.trim().slice(0,120),parent_id:form.parent_id||null,sort_order:Number(form.sort_order)||0,color:form.color||null}
  const r=editId
   ?await supabase.from('proc_company_sections').update(changes).eq('id',editId).eq('company_id',company.id)
   :await supabase.from('proc_company_sections').insert({...changes,company_id:company.id})
  if(r.error)throw r.error
  setForm(formDefault);setEditId('')
  flash(editId?'Section updated.':'Nested section created.')
 }
 async function archiveSection(){
  const inSection=rows.some(r=>r.section_id===editId)
  const child=sections.some(s=>s.parent_id===editId&&s.active!==false)
  if(inSection||child)throw new Error('Move the items and child sections elsewhere before archiving this section.')
  const r=await supabase.from('proc_company_sections').update({active:false}).eq('id',editId).eq('company_id',company.id)
  if(r.error)throw r.error
  setForm(formDefault);setEditId('')
  flash('Empty section archived.')
 }
 async function moveSelected(){
  const ids=Object.entries(selected).filter(([,v])=>v).map(([id])=>id)
  if(!ids.length||!target)throw new Error('Select one or more items and a destination section.')
  const r=await supabase.from('proc_company_list_items').update({section_id:target}).eq('company_id',company.id).in('id',ids)
  if(r.error)throw r.error
  setSelected({})
  flash(ids.length+' company-list item(s) moved. Stock values remain unchanged.')
 }
 return <details className="company-section-manager section">
  <summary>Manage sections & nested categories</summary>
  <p className="muted tiny">Sections belong only to {company?.name||'the selected company'}. Add unlimited subsections, move whole branches, color headers, and move selected stock rows without changing shared item names or historical counts.</p>
  <div className="company-section-editor">
   <h4>{editId?'Edit section':'Create a section / subsection'}</h4>
   <div className="company-layout-controls">
    <label className="field">Section title<input className="input" value={form.name} maxLength={120} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="e.g. GI Channel"/></label>
    <label className="field">Parent section<select className="select" aria-label="Section parent" value={form.parent_id} onChange={e=>setForm(v=>({...v,parent_id:e.target.value}))}><option value="">Top level</option>{ordered.filter(s=>!editId||validSectionParent(sections,editId,s.id)).map(s=><option value={s.id} key={s.id}>{paths.get(s.id)}</option>)}</select></label>
    <label className="field">Order within parent<input className="input" type="number" value={form.sort_order} onChange={e=>setForm(v=>({...v,sort_order:e.target.value}))}/></label>
    <label className="field">Header color override (optional)<input aria-label="Section color" type="color" value={form.color||'#295b89'} onChange={e=>setForm(v=>({...v,color:e.target.value}))}/><label className="checkline"><input type="checkbox" checked={!form.color} onChange={e=>setForm(v=>({...v,color:e.target.checked?'':'#295b89'}))}/>Use global level color</label></label>
   </div>
   <div className="toolbar section"><button className="btn primary" disabled={busy||!form.name.trim()} onClick={()=>run(saveSection)}>{editId?'Save section':'Add section'}</button>{editId&&<><button className="btn" onClick={()=>{setEditId('');setForm(formDefault)}}>Cancel edit</button><button className="btn bad" disabled={busy} onClick={()=>run(archiveSection)}>Archive empty section</button></>}</div>
  </div>
  <h4 className="section">Existing sections ({ordered.length})</h4>
  <div className="company-section-directory">{ordered.map(s=><div key={s.id} className="company-section-directory-row"><span title={paths.get(s.id)}>{paths.get(s.id)}</span><button type="button" className="btn small" onClick={()=>startEdit(s)}>Edit / Move</button></div>)}</div>
  <h4 className="section">Move items between sections</h4>
  <p className="muted tiny">Select items in this company only. Their descriptions, prices, stock balances, and Google Sheets source references will not change.</p>
  <div className="company-layout-controls">
   <label className="field">Find items<input className="input" aria-label="Find company items to move" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search description / size"/></label>
   <label className="field">Destination<select className="select" aria-label="Move items to section" value={target} onChange={e=>setTarget(e.target.value)}><option value="">Choose destination</option>{ordered.map(s=><option key={s.id} value={s.id}>{paths.get(s.id)}</option>)}</select></label>
  </div>
  <div className="company-section-pick-items">{matching.map(r=><label className="checkline" key={r.id}><input type="checkbox" checked={!!selected[r.id]} onChange={e=>setSelected(v=>({...v,[r.id]:e.target.checked}))}/>{r.item?.description} {r.item?.size}</label>)}</div>
  <button className="btn primary section" disabled={busy||!count||!target} onClick={()=>run(moveSelected)}>Move {count} selected item(s)</button>
 </details>
}
