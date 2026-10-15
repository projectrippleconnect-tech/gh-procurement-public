'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'

/** All changes require the live Super Admin JWT. No background or service-role writes. */
export function ReviewedCompanyHierarchy({companyId,onChanged=()=>{},flash=()=>{},fail=()=>{}}){
 const [busy,setBusy]=useState(false)
 const [preview,setPreview]=useState(null)
 const [confirm,setConfirm]=useState(false)
 useEffect(()=>{setPreview(null);setConfirm(false)},[companyId])
 async function run(isPreview){
  if(busy)return
  setBusy(true)
  try{
   const {data,error}=await supabase.rpc('proc_apply_reviewed_company_hierarchy_v1',{p_preview:isPreview})
   if(error)throw error
   if(!data?.ok)throw new Error('Company grouping operation did not complete.')
   if(isPreview){setPreview(data);setConfirm(false)}
   else{
    flash(data.items_moved+' existing items moved into '+data.sections_created+' new grouping sections across '+data.company_lists+' companies. Stock values and histories preserved.')
    setPreview(null);setConfirm(false)
    await onChanged()
   }
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 return <details className="section">
  <summary>Reviewed product grouping — all company lists</summary>
  <p className="muted tiny">Group existing products into colored, collapsible company → category → subcategory sections. Reuses existing sections, including Panel Sheets ceiling branches and Kelvin/Orange ranges, and preserves item IDs, maximum stock, current stock drafts, source keys and history.</p>
  <button type="button" className="btn section" disabled={busy} onClick={()=>run(true)}>
   {busy?'Checking hierarchy…':'Preview reviewed groupings'}
  </button>
  {preview&&<div className="card pad section">
    <p><strong>{preview.planned_items}</strong> active records reviewed across <strong>{preview.company_lists}</strong> company lists. Others already have appropriate grouping and stay unchanged.</p>
    <div className="muted tiny">
     {(preview.company_examples||[]).map(c=><p key={c.company_name}>{c.company_name}: {c.items} items, {c.group_paths} destination paths</p>)}
    </div>
    <label className="checkline section"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>Apply reviewed product sections. Do not change product identities, maximum stocks, or transaction history.</label>
    <button type="button" className="btn primary section" disabled={!confirm||busy} onClick={()=>run(false)}>
      Apply reviewed sections to all company lists
    </button>
  </div>}
 </details>
}
