'use client'

import {ModernSelect} from './modern-select'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {ITEM_CATEGORIES,ITEM_UOMS,itemOptionValues,updateItemGrouping} from '@/lib/item-editor-options.mjs'

const empty={description:'',category:'GENERAL',size:'',uom:'PCS',brand:'',colour:'',variation:'',main_group:'',subgroup:'',movement:'NORMAL',max_stock:'0'}
export function QuickAddItem({can,fail,flash,onCreated=()=>{}}){
 const[open,setOpen]=useState(false),[form,setForm]=useState(empty),[busy,setBusy]=useState(false)
 const[uoms,setUoms]=useState(ITEM_UOMS)
 const[categories,setCategories]=useState(ITEM_CATEGORIES)
 const[groups,setGroups]=useState([])
 const[subgroups,setSubgroups]=useState([])
 const[addingCategory,setAddingCategory]=useState(false),[newCategory,setNewCategory]=useState(''),[categoryError,setCategoryError]=useState(''),[loadingCategories,setLoadingCategories]=useState(false)
 useEffect(()=>{
  if(!open)return
  let active=true
  setLoadingCategories(true)
  ;(async()=>{
   try{
    const [r,storedUnits]=await Promise.all([
     supabase.rpc('proc_item_filter_options_v1'),
     supabase.from('proc_items').select('uom').eq('active',true).order('uom').limit(1000)
    ])
    if(r.error)throw r.error
    if(active){
     setCategories(itemOptionValues(ITEM_CATEGORIES,r.data?.categories))
     setGroups(itemOptionValues(r.data?.main_groups))
     setUoms(itemOptionValues(ITEM_UOMS,r.data?.uoms,(storedUnits.data||[]).map(i=>i.uom)))
    }
   }catch(e){if(active)fail(e)}finally{if(active)setLoadingCategories(false)}
  })()
  return()=>{active=false}
 },[open])
 useEffect(()=>{
  if(!open||!form.category){setSubgroups([]);return}
  let active=true
  ;(async()=>{
   try{
    let query=supabase.from('proc_items').select('subgroup').eq('active',true).eq('category',form.category).not('subgroup','is',null)
    if(form.main_group)query=query.eq('main_group',form.main_group)
    const r=await query.order('subgroup').limit(1000)
    if(r.error)throw r.error
    if(active)setSubgroups(itemOptionValues((r.data||[]).map(i=>i.subgroup)))
   }catch{if(active)setSubgroups([])}
  })()
  return()=>{active=false}
 },[open,form.category,form.main_group])
 function change(field,value){setForm(f=>updateItemGrouping(f,field,value))}
 function addCategory(){
  const name=newCategory.trim().replace(/\s+/g,' ').toUpperCase()
  if(!name){setCategoryError('Enter a category name.');return}
  const existing=categories.find(c=>c.trim().toUpperCase()===name)
  const category=existing||name
  setCategories(v=>itemOptionValues(v,category))
  setForm(v=>updateItemGrouping(v,'category',category))
  setAddingCategory(false);setNewCategory('');setCategoryError('')
 }
 if(!can('items.edit'))return null
 async function save(){
  if(busy)return
  if(addingCategory)return setCategoryError('Add or cancel the new category before saving the item.')
  if(!form.description.trim()||!form.category.trim()||!form.uom.trim())return fail(new Error('Item name, category and UOM are required.'))
  if(!Number.isFinite(Number(form.max_stock))||!String(form.max_stock).trim()||Number(form.max_stock)<0)return fail(new Error('Max stock must be zero or positive.'))
  setBusy(true)
  try{
   const r=await supabase.rpc('proc_quick_add_item_v1',{p_item:{...form,max_stock:Number(form.max_stock)}})
   if(r.error)throw r.error
   flash(r.data.existing?'Existing item selected; no duplicate created.':'Item created.')
   await onCreated(r.data.item);setForm(empty);setOpen(false)
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 const pick=(field,label,values,{allowEmpty=false,customLabel=label}={})=><label className="field" key={field}>{label}
  <ModernSelect aria-label={label} disabled={busy} className="select" value={form[field]||''} allowCustom customOptionLabel={customLabel}
   onChange={e=>change(field,e.target.value)}>
   {allowEmpty&&<option value="">None</option>}
   {itemOptionValues(values,form[field]).map(v=><option key={v} value={v}>{v}</option>)}
  </ModernSelect>
 </label>
 return <div className="section"><button type="button" className="btn" onClick={()=>setOpen(v=>!v)}>+ Quick Add Item</button>
  {open&&<div className="card pad section"><h3>Quick Add Item</h3>
   <div className="formgrid">
    <label className="field">Item name<input className="input" disabled={busy} value={form.description} onChange={e=>change('description',e.target.value)}/></label>
    {pick('category','Category',categories)}
    {pick('main_group','Main group',groups,{allowEmpty:true,customLabel:'main group'})}
    {pick('subgroup','Subcategory',subgroups,{allowEmpty:true,customLabel:'subcategory'})}
    <label className="field">Size<input className="input" disabled={busy} value={form.size} onChange={e=>change('size',e.target.value)}/></label>
    {pick('uom','UOM',uoms)}
    <label className="field">Movement
     <ModernSelect className="select" aria-label="Movement" disabled={busy} value={form.movement} onChange={e=>change('movement',e.target.value)}>
      <option value="FAST">FAST</option><option value="NORMAL">NORMAL</option><option value="SLOW">SLOW</option>
     </ModernSelect>
    </label>
    <label className="field">Maximum stock<input className="input" inputMode="decimal" disabled={busy} value={form.max_stock} onChange={e=>change('max_stock',e.target.value)}/></label>
   </div>
   {loadingCategories&&<p className="muted tiny" role="status">Loading existing categories and groups…</p>}
   {addingCategory?<div className="section"><label className="field">New category name<input autoFocus className="input" maxLength={100} disabled={busy} value={newCategory} onChange={e=>{setNewCategory(e.target.value);setCategoryError('')}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCategory()}}}/></label>{categoryError&&<p role="alert">{categoryError}</p>}<div className="toolbar section"><button type="button" className="btn small primary" disabled={busy} onClick={addCategory}>Add category</button><button type="button" className="btn small" disabled={busy} onClick={()=>{setAddingCategory(false);setNewCategory('');setCategoryError('')}}>Cancel category</button></div><p className="muted tiny">The new category is saved with this item.</p></div>:<button type="button" className="btn small section" disabled={busy||loadingCategories} onClick={()=>setAddingCategory(true)}>+ New category</button>}
   <p className="muted tiny">Select existing values or add a custom category, group, subcategory or UOM. Reorder level is calculated from Movement and Maximum stock when saved.</p>
   <div className="toolbar section"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save Item'}</button><button type="button" className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div>
  </div>}
 </div>
}
