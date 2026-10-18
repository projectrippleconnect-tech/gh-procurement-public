'use client'

import {ModernSelect} from './modern-select'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'

const empty={description:'',category:'GENERAL',size:'',uom:'PCS',brand:'',colour:'',variation:'',main_group:'',subgroup:'',movement:'NORMAL',max_stock:'0'}
const DEFAULT_UOMS=['PCS','NOS','BOX','PACK','SET','PAIR','DOZEN','ROLL','BAG','BUNDLE','CARTON','SHEET','LENGTH','MTR','FT','KG','G','LTR','ML','TIN','TUBE']
export function QuickAddItem({can,fail,flash,onCreated=()=>{}}){
 const[open,setOpen]=useState(false),[form,setForm]=useState(empty),[busy,setBusy]=useState(false)
 const[uoms,setUoms]=useState(DEFAULT_UOMS)
 const[categories,setCategories]=useState(['GENERAL','BATHROOM','ELECTRICAL']),[addingCategory,setAddingCategory]=useState(false),[newCategory,setNewCategory]=useState(''),[categoryError,setCategoryError]=useState(''),[loadingCategories,setLoadingCategories]=useState(false)
 useEffect(()=>{
  if(!open)return
  let active=true
  setLoadingCategories(true)
  ;(async()=>{
   try{
    const [r,storedUnits]=await Promise.all([supabase.rpc('proc_item_filter_options_v1'),supabase.from('proc_items').select('uom').eq('active',true).order('uom').limit(1000)])
    if(r.error)throw r.error
    if(active){
     setCategories(v=>[...new Set([...v,...(r.data?.categories||[])].filter(Boolean))].sort())
     setUoms(v=>[...new Set([...v,...(r.data?.uoms||[]),...(storedUnits.data||[]).map(i=>i.uom)].filter(Boolean).map(u=>String(u).trim().toUpperCase()))].sort())
    }
   }catch(e){if(active)fail(e)}finally{if(active)setLoadingCategories(false)}
  })()
  return ()=>{active=false}
 },[open])
 function addCategory(){
  const name=newCategory.trim().replace(/\s+/g,' ').toUpperCase()
  if(!name){setCategoryError('Enter a category name.');return}
  const existing=categories.find(c=>c.trim().toUpperCase()===name)
  const category=existing||name
  setCategories(v=>existing?v:[...v,category].sort())
  setForm(v=>({...v,category}));setAddingCategory(false);setNewCategory('');setCategoryError('')
 }
 if(!can('items.edit'))return null
 async function save(){
  if(busy)return
  if(addingCategory)return setCategoryError('Add or cancel the new category before saving the item.')
  if(!form.description.trim()||!form.category.trim()||!form.uom.trim())return fail(new Error('Item name, category and UOM are required.'))
  if(!Number.isFinite(Number(form.max_stock))||Number(form.max_stock)<0)return fail(new Error('Max stock must be zero or positive.'))
  setBusy(true)
  try{
   const r=await supabase.rpc('proc_quick_add_item_v1',{p_item:{...form,max_stock:Number(form.max_stock)}})
   if(r.error)throw r.error
   flash(r.data.existing?'Existing item selected; no duplicate created.':'Item created.')
   await onCreated(r.data.item);setForm(empty);setOpen(false)
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 return <div className="section"><button type="button" className="btn" onClick={()=>setOpen(v=>!v)}>+ Quick Add Item</button>{open&&<div className="card pad section"><h3>Quick Add Item</h3><div className="formgrid">{[['description','Item name'],['category','Category'],['size','Size'],['uom','UOM']].map(([k,label])=><label className="field" key={k}>{label}{k==='category'?<ModernSelect aria-label="Category" disabled={busy} value={form.category} onChange={e=>setForm(v=>({...v,category:e.target.value}))}>{[...new Set([...categories,form.category])].map(c=><option key={c} value={c}>{c}</option>)}</ModernSelect>:k==='uom'?<ModernSelect aria-label="UOM" disabled={busy} allowCustom customOptionLabel="UOM" value={form.uom} onChange={e=>setForm(v=>({...v,uom:e.target.value}))} onCustomAdd={unit=>setUoms(v=>[...new Set([...v,unit])].sort())}>{[...new Set([...uoms,form.uom])].filter(Boolean).map(unit=><option key={unit} value={unit}>{unit}</option>)}</ModernSelect>:<input className="input" disabled={busy} value={form[k]} onChange={e=>setForm(v=>({...v,[k]:e.target.value}))}/>}</label>)}</div>{loadingCategories&&<p className="muted tiny" role="status">Loading categories…</p>}{addingCategory?<div className="section"><label className="field">New category name<input autoFocus className="input" maxLength={100} disabled={busy} value={newCategory} onChange={e=>{setNewCategory(e.target.value);setCategoryError('')}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCategory()}}}/></label>{categoryError&&<p role="alert">{categoryError}</p>}<div className="toolbar section"><button type="button" className="btn small primary" disabled={busy} onClick={addCategory}>Add category</button><button type="button" className="btn small" disabled={busy} onClick={()=>{setAddingCategory(false);setNewCategory('');setCategoryError('')}}>Cancel category</button></div><p className="muted tiny">The new category is saved with this item.</p></div>:<button type="button" className="btn small section" disabled={busy||loadingCategories} onClick={()=>setAddingCategory(true)}>+ New category</button>}<details className="section"><summary>Brand, category groups and stock settings</summary><div className="formgrid section">{[['brand','Brand'],['colour','Colour'],['variation','Variation / model'],['main_group','Main category group'],['subgroup','Subcategory'],['max_stock','Max stock']].map(([k,label])=><label className="field" key={k}>{label}<input className="input" inputMode={k==='max_stock'?'decimal':undefined} disabled={busy} value={form[k]} onChange={e=>setForm(v=>({...v,[k]:e.target.value}))}/></label>)}<label className="field">Movement<ModernSelect className="select" disabled={busy} value={form.movement} onChange={e=>setForm(v=>({...v,movement:e.target.value}))}><option>FAST</option><option>NORMAL</option><option>SLOW</option></ModernSelect></label></div></details><div className="toolbar section"><button className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save Item'}</button><button className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div></div>}</div>
}
