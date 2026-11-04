'use client'

import {useEffect,useState} from 'react'
import {ModernSelect} from './modern-select'
import {supabase} from '@/lib/supabase'
import {stockItemEditPatch} from '@/lib/stock-item-edit.mjs'
import {uppercaseItemText} from '@/lib/item-text.mjs'
import {stockItemLabel} from '@/lib/stock-search.mjs'
import {ITEM_CATEGORIES,ITEM_UOMS,itemOptionValues,updateItemGrouping} from '@/lib/item-editor-options.mjs'

// Keep brand in the master readback, even though it is hidden from this form:
// otherwise an existing brand would be erased by the change-only patch helper.
const selectedFields='id,description,category,main_group,subgroup,brand,size,uom,movement,max_stock,remarks'

export function StockItemEditor({item,onClose,onSaved}){
 const id=item?.item_id||item?.id
 const [original,setOriginal]=useState(null)
 const [draft,setDraft]=useState(null)
 const [options,setOptions]=useState({categories:ITEM_CATEGORIES,groups:[],uoms:ITEM_UOMS})
 const [subgroups,setSubgroups]=useState([])
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{
  let active=true
  async function load(){
   setLoading(true);setError('')
   try{
    const response=await supabase.from('proc_items').select(selectedFields).eq('id',id).single()
    if(response.error)throw response.error
    if(!active)return
    setOriginal(response.data)
    setDraft({...response.data,max_stock:String(response.data.max_stock??0)})
   }catch(e){if(active)setError(e.message||'Unable to load item details.')}
   finally{if(active)setLoading(false)}
  }
  load()
  return()=>{active=false}
 },[id])
 useEffect(()=>{
  let active=true
  ;(async()=>{
   try{
    const r=await supabase.rpc('proc_item_filter_options_v1')
    if(r.error)throw r.error
    if(active)setOptions({
     categories:itemOptionValues(ITEM_CATEGORIES,r.data?.categories),
     groups:itemOptionValues(r.data?.main_groups),
     uoms:itemOptionValues(ITEM_UOMS,r.data?.uoms)
    })
   }catch{
    // A failed suggestions lookup must never prevent an authorized item edit.
   }
  })()
  return()=>{active=false}
 },[id])
 useEffect(()=>{
  if(!draft?.category){setSubgroups([]);return}
  let active=true
  ;(async()=>{
   try{
    let query=supabase.from('proc_items').select('subgroup').eq('active',true).eq('category',draft.category).not('subgroup','is',null)
    if(draft.main_group)query=query.eq('main_group',draft.main_group)
    const r=await query.order('subgroup').limit(1000)
    if(r.error)throw r.error
    if(active)setSubgroups(itemOptionValues((r.data||[]).map(row=>row.subgroup)))
   }catch{if(active)setSubgroups([])}
  })()
  return()=>{active=false}
 },[draft?.category,draft?.main_group])
 useEffect(()=>{
  if(saving)return
  const onKey=e=>{if(e.key==='Escape'){e.preventDefault();onClose()}}
  window.addEventListener('keydown',onKey)
  return()=>window.removeEventListener('keydown',onKey)
 },[saving,onClose])
 async function save(e){
  e?.preventDefault()
  if(saving||!original||!draft)return
  let patch
  try{patch=stockItemEditPatch(original,draft)}catch(err){setError(err.message);return}
  if(Object.keys(patch).length===0){onClose();return}
  setSaving(true);setError('')
  try{
   // Existing permission-checked RPC writes only changed master fields, never counts.
   const response=await supabase.rpc('proc_update_item_master_v1',{p_item_id:id,p_patch:patch})
   if(response.error)throw response.error
   await onSaved(id,patch)
  }catch(err){setError(err.message||'Unable to save this item.')}
  finally{setSaving(false)}
 }
 function change(field,value){
  setDraft(d=>updateItemGrouping(d,field,['description','size','remarks'].includes(field)?uppercaseItemText(value):value))
 }
 function close(){if(!saving)onClose()}
 const select=(field,label,values,{allowEmpty=false,customLabel=label}={})=><label className="field" key={field}>{label}
  <ModernSelect aria-label={label} className="select" disabled={saving} allowCustom customOptionLabel={customLabel}
   value={draft[field]||''} onChange={e=>change(field,e.target.value)}>
   {allowEmpty&&<option value="">None</option>}
   {itemOptionValues(values,draft[field]).map(value=><option key={value} value={value}>{value}</option>)}
  </ModernSelect>
 </label>
 return <div className="modal-backdrop stock-quick-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
  <div className="modal card stock-quick-modal" role="dialog" aria-modal="true" aria-labelledby="stock-item-edit-title" style={{width:'min(100%,580px)',overflowY:'auto'}}>
   <div className="modal-head"><div><h3 id="stock-item-edit-title">Edit item</h3><p className="muted tiny">{stockItemLabel(item)}</p></div><button type="button" className="btn small" aria-label="Close item editor" disabled={saving} onClick={close}>✕</button></div>
   {loading?<p role="status">Loading latest item details…</p>:draft?<form onSubmit={save}>
    <div className="formgrid section">
     <label className="field">Item name<input className="input" value={uppercaseItemText(draft.description||'')} disabled={saving} onChange={e=>change('description',e.target.value)}/></label>
     {select('category','Category',options.categories)}
     {select('main_group','Main group',options.groups,{allowEmpty:true,customLabel:'main group'})}
     {select('subgroup','Subcategory',subgroups,{allowEmpty:true,customLabel:'subcategory'})}
     <label className="field">Size<input className="input" value={uppercaseItemText(draft.size||'')} disabled={saving} onChange={e=>change('size',e.target.value)}/></label>
     {select('uom','UOM',options.uoms,{customLabel:'UOM'})}
     <label className="field">Movement
      <ModernSelect aria-label="Movement" className="select" value={draft.movement||'NORMAL'} disabled={saving} onChange={e=>change('movement',e.target.value)}>
       <option value="FAST">FAST</option><option value="NORMAL">NORMAL</option><option value="SLOW">SLOW</option>
      </ModernSelect>
     </label>
     <label className="field">Maximum stock<input className="input" inputMode="decimal" value={draft.max_stock??''} disabled={saving} onChange={e=>change('max_stock',e.target.value)}/></label>
    </div>
    <details className="section"><summary>Optional notes</summary><label className="field section">Remarks<input className="input" value={uppercaseItemText(draft.remarks||'')} disabled={saving} onChange={e=>change('remarks',e.target.value)}/></label></details>
    <p className="muted tiny">Reorder level is recalculated automatically from Movement and Maximum stock. Brand values, existing stock counts, history and item identity are preserved.</p>
    {error&&<p role="alert" className="warn-text">{error}</p>}
    <div className="toolbar section"><button type="submit" className="btn primary" disabled={saving}>{saving?'Saving…':'Save changes'}</button><button type="button" className="btn" disabled={saving} onClick={close}>Cancel</button></div>
   </form>:<><p role="alert">{error||'Could not load this item.'}</p><button className="btn" type="button" onClick={close}>Close</button></>}
  </div>
 </div>
}
