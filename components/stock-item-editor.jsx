'use client'

import {useEffect,useState} from 'react'
import {ModernSelect} from './modern-select'
import {supabase} from '@/lib/supabase'
import {stockItemEditPatch} from '@/lib/stock-item-edit.mjs'
import {stockItemLabel} from '@/lib/stock-search.mjs'

const selectedFields='id,description,category,main_group,subgroup,brand,size,uom,movement,max_stock,remarks'
const textFields=[
 ['description','Item name'],['category','Category'],['main_group','Main group'],
 ['subgroup','Subcategory'],['brand','Brand'],['size','Size'],['uom','UOM'],
 ['max_stock','Maximum stock'],['remarks','Remarks']
]
const suggestedUnits=['PCS','NOS','ROLL','BOX','PACK','BAG','KG','G','L','M','FT','SET','PAIR','SHEET','BUNDLE','DOZEN']

export function StockItemEditor({item,onClose,onSaved}){
 const id=item?.item_id||item?.id
 const [original,setOriginal]=useState(null)
 const [draft,setDraft]=useState(null)
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
   // The existing permission-checking RPC writes only master fields; stock counts stay untouched.
   const response=await supabase.rpc('proc_update_item_master_v1',{p_item_id:id,p_patch:patch})
   if(response.error)throw response.error
   await onSaved(id,patch)
  }catch(err){setError(err.message||'Unable to save this item.')}
  finally{setSaving(false)}
 }
 function close(){if(!saving)onClose()}
 return <div className="modal-backdrop stock-quick-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
  <div className="modal card stock-quick-modal" role="dialog" aria-modal="true" aria-labelledby="stock-item-edit-title" style={{width:'min(100%,580px)',overflowY:'auto'}}>
   <div className="modal-head"><div><h3 id="stock-item-edit-title">Edit item</h3><p className="muted tiny">{stockItemLabel(item)}</p></div><button type="button" className="btn small" aria-label="Close item editor" disabled={saving} onClick={close}>✕</button></div>
   {loading?<p role="status">Loading latest item details…</p>:draft?<form onSubmit={save}>
    <div className="formgrid section">
     {textFields.map(([key,label])=><label className="field" key={key}>{label}
      <input className="input" value={draft[key]??''} disabled={saving}
       inputMode={key==='max_stock'?'decimal':undefined}
       list={key==='uom'?'stock-item-edit-uoms':undefined}
       onChange={e=>setDraft(d=>({...d,[key]:e.target.value}))}/>
     </label>)}
     <label className="field">Movement
      <ModernSelect className="select" value={draft.movement||'NORMAL'} disabled={saving} onChange={e=>setDraft(d=>({...d,movement:e.target.value}))}>
       <option value="FAST">FAST</option><option value="NORMAL">NORMAL</option><option value="SLOW">SLOW</option>
      </ModernSelect>
     </label>
    </div>
    <datalist id="stock-item-edit-uoms">{suggestedUnits.map(u=><option key={u} value={u}/>)}</datalist>
    <p className="muted tiny">Reorder level is calculated automatically from movement and maximum stock. Existing stock counts, history and item identity are preserved.</p>
    {error&&<p role="alert" className="warn-text">{error}</p>}
    <div className="toolbar section"><button type="submit" className="btn primary" disabled={saving}>{saving?'Saving…':'Save changes'}</button><button type="button" className="btn" disabled={saving} onClick={close}>Cancel</button></div>
   </form>:<><p role="alert">{error||'Could not load this item.'}</p><button className="btn" type="button" onClick={close}>Close</button></>}
  </div>
 </div>
}
