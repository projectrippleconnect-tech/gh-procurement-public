'use client'

import {ModernSelect} from './modern-select'
import {useState} from 'react'
import {supabase} from '@/lib/supabase'

const empty={description:'',category:'GENERAL',size:'',uom:'PCS',brand:'',main_group:'',subgroup:'',movement:'NORMAL',max_stock:'0'}
export function QuickAddItem({can,fail,flash,onCreated=()=>{}}){
 const[open,setOpen]=useState(false),[form,setForm]=useState(empty),[busy,setBusy]=useState(false)
 if(!can('items.edit'))return null
 async function save(){
  if(busy)return
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
 return <div className="section"><button type="button" className="btn" onClick={()=>setOpen(v=>!v)}>+ Quick Add Item</button>{open&&<div className="card pad section"><h3>Quick Add Item</h3><div className="formgrid">{[['description','Item name'],['category','Category'],['size','Size'],['uom','UOM']].map(([k,label])=><label className="field" key={k}>{label}<input className="input" disabled={busy} value={form[k]} onChange={e=>setForm(v=>({...v,[k]:e.target.value}))}/></label>)}</div><details className="section"><summary>Brand, category groups and stock settings</summary><div className="formgrid section">{[['brand','Brand'],['main_group','Main category group'],['subgroup','Subcategory'],['max_stock','Max stock']].map(([k,label])=><label className="field" key={k}>{label}<input className="input" inputMode={k==='max_stock'?'decimal':undefined} disabled={busy} value={form[k]} onChange={e=>setForm(v=>({...v,[k]:e.target.value}))}/></label>)}<label className="field">Movement<ModernSelect className="select" disabled={busy} value={form.movement} onChange={e=>setForm(v=>({...v,movement:e.target.value}))}><option>FAST</option><option>NORMAL</option><option>SLOW</option></ModernSelect></label></div></details><div className="toolbar section"><button className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save Item'}</button><button className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div></div>}</div>
}
