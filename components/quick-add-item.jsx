'use client'

import {ModernSelect} from './modern-select'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {quickAddReorderLevel} from '@/lib/quick-add-reorder.mjs'
import {itemOptionValues,updateItemGrouping} from '@/lib/item-editor-options.mjs'

const EMPTY={description:'',category:'GENERAL',size:'',uom:'PCS',brand:'',colour:'',variation:'',main_group:'',subgroup:'',movement:'NORMAL',max_stock:''}
const DEFAULT_UOMS=['PCS','NOS','BOX','PACK','SET','PAIR','DOZEN','ROLL','BAG','BUNDLE','CARTON','SHEET','LENGTH','MTR','FT','KG','G','LTR','ML','TIN','TUBE']
const normalise=value=>String(value||'').trim().replace(/\s+/g,' ').toUpperCase()
export function QuickAddItem({can,fail,flash,onCreated=()=>{},mode='general',companies=[],selectedCompanyId='',onCreateCompany}){
 const isCompany=mode==='company'
 const[open,setOpen]=useState(false),[form,setForm]=useState({...EMPTY,category:isCompany?'':'GENERAL'}),[busy,setBusy]=useState(false)
 const[companyChoice,setCompanyChoice]=useState(''),[companyDraft,setCompanyDraft]=useState({name:'',code:''})
 const[uoms,setUoms]=useState(DEFAULT_UOMS)
 const[groups,setGroups]=useState([]),[subgroups,setSubgroups]=useState([])
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
     setCategories(v=>itemOptionValues(v,r.data?.categories))
     setGroups(v=>itemOptionValues(v,r.data?.main_groups))
     setUoms(v=>[...new Set([...v,...(r.data?.uoms||[]),...(storedUnits.data||[]).map(i=>i.uom)].filter(Boolean).map(normalise))].sort())
    }
   }catch(e){if(active)fail(e)}finally{if(active)setLoadingCategories(false)}
  })()
  return ()=>{active=false}
 },[open])
 useEffect(()=>{
  if(!open||!form.category){setSubgroups([]);return}
  let active=true
  ;(async()=>{
   try{
    let q=supabase.from('proc_items').select('subgroup').eq('active',true).eq('category',form.category).not('subgroup','is',null)
    if(form.main_group)q=q.eq('main_group',form.main_group)
    const r=await q.order('subgroup').limit(1000)
    if(r.error)throw r.error
    if(active)setSubgroups(itemOptionValues((r.data||[]).map(row=>row.subgroup)))
   }catch{if(active)setSubgroups([])}
  })()
  return()=>{active=false}
 },[open,form.category,form.main_group])
 useEffect(()=>{
  if(!open||!isCompany||companyChoice==='__new__')return
  if(companyChoice&&companies.some(c=>c.id===companyChoice))return
  setCompanyChoice(selectedCompanyId!=='all'&&companies.some(c=>c.id===selectedCompanyId)?selectedCompanyId:companies[0]?.id||'__new__')
 },[open,isCompany,selectedCompanyId,companies,companyChoice])
 function addCategory(){
  const name=normalise(newCategory)
  if(!name){setCategoryError('Enter a category name.');return}
  const existing=categories.find(c=>normalise(c)===name)
  const category=existing||name
  setCategories(v=>existing?v:[...v,category].sort())
  setForm(v=>updateItemGrouping(v,'category',category));setAddingCategory(false);setNewCategory('');setCategoryError('')
 }
 if(!can('items.edit')||(isCompany&&!can('company_lists.manage')))return null
 const reorder=quickAddReorderLevel(form.max_stock,form.movement,isCompany)
 async function save(){
  if(busy)return
  if(addingCategory)return setCategoryError('Add or cancel the new category before saving the item.')
  if(!form.description.trim()||!form.category.trim()||!form.uom.trim())return fail(new Error('Item name, category and UOM are required.'))
  if(form.max_stock.trim()===''||reorder===null)return fail(new Error('Enter a valid maximum stock (zero or greater).'))
  if(isCompany&&companyChoice==='__new__'&&!companyDraft.name.trim())return fail(new Error('Enter a new company name.'))
  if(isCompany&&companyChoice!=='__new__'&&!companies.some(c=>c.id===companyChoice))return fail(new Error('Choose an existing company or create a new one.'))
  setBusy(true)
  try{
   let chosenCompanyId=companyChoice
   if(isCompany&&chosenCompanyId==='__new__'){
    if(!onCreateCompany)throw new Error('Company creation is unavailable.')
    const created=await onCreateCompany({name:companyDraft.name.trim(),code:companyDraft.code.trim()})
    if(!created?.id)throw new Error('Could not create the company.')
    chosenCompanyId=created.id
    setCompanyChoice(created.id);setCompanyDraft({name:'',code:''})
   }
   // The database applies the movement-based reorder trigger for General items.
   const r=await supabase.rpc('proc_quick_add_item_v1',{p_item:{...form,uom:normalise(form.uom),movement:isCompany?'NORMAL':form.movement,max_stock:Number(form.max_stock)}})
   if(r.error)throw r.error
   if(!r.data?.item?.id)throw new Error('Item could not be confirmed in the database.')
   // For Company items, the linking step also saves the maximum and its 50% reorder rule.
   const result=await onCreated(r.data.item,{companyId:isCompany?chosenCompanyId:null,maxStock:Number(form.max_stock),existing:!!r.data.existing})
   flash(result|| (r.data.existing?'Existing item selected; no duplicate created.':isCompany?'Item saved to company list.':'Item saved to the database.'))
   setForm({...EMPTY,category:isCompany?'':'GENERAL'});setOpen(false)
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 return <div className="section">
  <button type="button" className="btn" onClick={()=>setOpen(v=>!v)}>{isCompany?'+ Quick Create Company Item':'+ Quick Add Item'}</button>
  {open&&<div className="card pad section"><h3>{isCompany?'Quick Create Company Item':'Quick Add Item'}</h3>
   {isCompany&&<div className="section">
    <label className="field">Company<ModernSelect aria-label="Company for new item" disabled={busy} value={companyChoice} onChange={e=>setCompanyChoice(e.target.value)}>
     <option value="">Choose a company…</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value="__new__">+ Create new company</option>
    </ModernSelect></label>
    {companyChoice==='__new__'&&<div className="formgrid section">
     <label className="field">New company name<input className="input" disabled={busy} value={companyDraft.name} onChange={e=>setCompanyDraft(v=>({...v,name:e.target.value}))}/></label>
     <label className="field">Company code (optional)<input className="input" disabled={busy} value={companyDraft.code} onChange={e=>setCompanyDraft(v=>({...v,code:e.target.value}))}/></label>
    </div>}
   </div>}
   <div className="formgrid">
    <label className="field">Item name<input className="input" disabled={busy} value={form.description} onChange={e=>setForm(v=>({...v,description:e.target.value}))}/></label>
    <label className="field">Category<ModernSelect aria-label="Category" disabled={busy} value={form.category} allowCustom customOptionLabel="category" onChange={e=>setForm(v=>updateItemGrouping(v,'category',e.target.value))}>
     {!form.category&&<option value="">Select category…</option>}
     {[...new Set([...categories,form.category])].filter(Boolean).map(c=><option key={c} value={c}>{c}</option>)}
    </ModernSelect></label>
    <label className="field">Main group<ModernSelect aria-label="Main group" disabled={busy} allowCustom customOptionLabel="main group" value={form.main_group} onChange={e=>setForm(v=>updateItemGrouping(v,'main_group',e.target.value))}>
     <option value="">None</option>{itemOptionValues(groups,form.main_group).map(g=><option key={g} value={g}>{g}</option>)}
    </ModernSelect></label>
    <label className="field">Subcategory<ModernSelect aria-label="Subcategory" disabled={busy} allowCustom customOptionLabel="subcategory" value={form.subgroup} onChange={e=>setForm(v=>({...v,subgroup:e.target.value}))}>
     <option value="">None</option>{itemOptionValues(subgroups,form.subgroup).map(g=><option key={g} value={g}>{g}</option>)}
    </ModernSelect></label>
    {!isCompany&&<label className="field">Movement<ModernSelect aria-label="Movement" disabled={busy} value={form.movement} onChange={e=>setForm(v=>({...v,movement:e.target.value}))}>
     <option value="FAST">FAST</option><option value="NORMAL">NORMAL</option><option value="SLOW">SLOW</option>
    </ModernSelect></label>}
    <label className="field">Maximum stock<input className="input" inputMode="decimal" type="number" min="0" step="any" disabled={busy} value={form.max_stock} onChange={e=>setForm(v=>({...v,max_stock:e.target.value}))} placeholder="Enter maximum stock"/></label>
    <label className="field">Reorder level · {isCompany?'50%':form.movement==='FAST'?'50%':form.movement==='SLOW'?'25%':'33⅓%'}
     <input className="input" readOnly aria-label="Calculated reorder level" value={reorder===null?'Enter maximum stock':String(reorder)}/>
    </label>
    <label className="field">Size<input className="input" disabled={busy} value={form.size} onChange={e=>setForm(v=>({...v,size:e.target.value}))}/></label>
    <label className="field">UOM<ModernSelect aria-label="UOM" disabled={busy} allowCustom customOptionLabel="UOM" value={form.uom} onChange={e=>setForm(v=>({...v,uom:e.target.value}))} onCustomAdd={unit=>setUoms(v=>[...new Set([...v,unit])].sort())}>
     {[...new Set([...uoms,form.uom])].filter(Boolean).map(unit=><option key={unit} value={unit}>{unit}</option>)}
    </ModernSelect></label>
   </div>
   {loadingCategories&&<p className="muted tiny" role="status">Loading categories…</p>}
   {addingCategory?<div className="section">
    <label className="field">New category name<input autoFocus className="input" maxLength={100} disabled={busy} value={newCategory} onChange={e=>{setNewCategory(e.target.value);setCategoryError('')}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();addCategory()}}}/></label>
    {categoryError&&<p role="alert">{categoryError}</p>}
    <div className="toolbar section"><button type="button" className="btn small primary" disabled={busy} onClick={addCategory}>Use category</button><button type="button" className="btn small" disabled={busy} onClick={()=>{setAddingCategory(false);setNewCategory('');setCategoryError('')}}>Cancel</button></div>
    <p className="muted tiny">This category is saved when the item is saved.</p>
   </div>:<button type="button" className="btn small section" disabled={busy||loadingCategories} onClick={()=>setAddingCategory(true)}>+ New category</button>}
   <p className="muted tiny">Select existing categories, groups and units or create custom values. Brand is not required. Reorder level is calculated automatically.</p>
   <div className="toolbar section"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':isCompany?'Save to Company List':'Save Item'}</button><button type="button" className="btn" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div>
  </div>}
 </div>
}
