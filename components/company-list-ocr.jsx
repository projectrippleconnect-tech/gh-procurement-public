'use client'
import {useEffect,useRef,useState} from 'react'
import {extractDocumentTextFile,parsePriceListText} from '@/lib/price-list-extract'
import {supabase} from '@/lib/supabase'

export function CompanyListOcr({companyId,can,profile,fail,flash,onImported}){
 const[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[category,setCategory]=useState('GENERAL'),[subgroup,setSubgroup]=useState('')
 const revision=useRef(0)
 useEffect(()=>{revision.current++;setRows([]);setBusy(false);return()=>{revision.current++}},[companyId])
 if(!can('items.edit'))return null
 const mayLink=(profile.role_key||profile.role)==='admin'&&can('company_lists.manage')
 async function read(e){
  const file=e.target.files?.[0];e.target.value='';if(!file)return
  const run=++revision.current;setBusy(true);setRows([])
  try{
   const result=await extractDocumentTextFile(file,p=>{if(run===revision.current)setProgress(p)})
   if(run!==revision.current)return
   const detected=result.pages.flatMap(p=>{
    return p.text.split(/\r?\n/).map(s=>s.trim()).filter(s=>/[a-z]/i.test(s)&&! /^(?:page|description|item code|price list|company|telephone|email|total)\b/i.test(s)).map(description=>parsePriceListText(description)[0]||{description})
   })
   if(!detected.length)throw new Error('No item rows found. Try a clearer photo or PDF.')
   setRows(detected.map((r,i)=>({...r,id:String(i),selected:false,category,subgroup,max_stock:'0',movement:'NORMAL',uom:r.uom||'PCS',description:r.description||'',size:r.size||'',brand:''})))
  }catch(err){if(run===revision.current)fail(err)}finally{if(run===revision.current)setBusy(false)}
 }
 function update(id,patch){setRows(v=>v.map(r=>r.id===id?{...r,...patch}:r))}
 async function save(){
  const chosen=rows.filter(r=>r.selected)
  if(!chosen.length)return fail(new Error('Select reviewed items before importing.'))
  if(chosen.some(r=>!r.description.trim()||!r.category.trim()||!r.uom.trim()||!Number.isFinite(Number(r.max_stock))||Number(r.max_stock)<0))return fail(new Error('Each selected row needs a name, category, UOM and non-negative target stock.'))
  setBusy(true)
  const run=revision.current
  try{
   const r=await supabase.rpc('proc_import_company_items_v1',{p_rows:chosen.map(row=>({...row,item_code:row.external_code||'',max_stock:Number(row.max_stock)})),p_company_id:companyId,p_add_to_company_list:mayLink})
   if(r.error)throw r.error
   if(run!==revision.current)return
   setRows(v=>v.map(row=>row.selected?{...row,selected:false,status:'Imported / matched'}:row))
   flash((r.data.created||0)+' new items; '+(r.data.existing||0)+' existing matches.'+(mayLink?' Selected items linked to company list.':''));await onImported()
  }catch(e){if(run===revision.current)fail(e)}finally{if(run===revision.current)setBusy(false)}
 }
 return <details className="card pad section"><summary>Import Company List with OCR</summary><p className="muted tiny">Review names, sizes, categories and subcategories before creating items. Existing item matches are retained.{mayLink?' Reviewed items are linked to this company list.':' Items are created in Item Master; an admin can link them to the company list.'}</p><label className="field">Company list photo / PDF<input type="file" accept="image/*,application/pdf" disabled={busy||!companyId} onChange={read}/></label>{busy&&<p role="status">{progress?.stage||'Processing'} · {Math.round(Number(progress?.progress||0)*100)}%</p>}{rows.length>0&&<><div className="formgrid section"><label className="field">Category<input className="input" disabled={busy} value={category} onChange={e=>setCategory(e.target.value)}/></label><label className="field">Subcategory<input className="input" disabled={busy} value={subgroup} onChange={e=>setSubgroup(e.target.value)}/></label></div><div className="toolbar section"><button className="btn small" disabled={busy} onClick={()=>setRows(v=>v.map(r=>({...r,selected:true})))}>Select all</button><button className="btn small" disabled={busy} onClick={()=>setRows(v=>v.map(r=>r.selected?{...r,category,subgroup}:r))}>Apply category to selected</button></div><div className="stack section">{rows.map(r=><details className="procurement-data-row" key={r.id}><summary>{r.description||'Unnamed item'} · {r.size} {r.status&&'· '+r.status}</summary><div className="toolbar section"><label><input type="checkbox" disabled={busy} checked={r.selected} onChange={e=>update(r.id,{selected:e.target.checked})}/>Import</label><button className="btn small bad" disabled={busy} onClick={()=>setRows(v=>v.filter(x=>x.id!==r.id))}>Remove row</button></div><div className="formgrid">{[['description','Item name'],['size','Size'],['brand','Brand'],['category','Category'],['main_group','Main category group'],['subgroup','Subcategory'],['uom','UOM'],['max_stock','Target stock']].map(([k,label])=><label className="field" key={k}>{label}<input className="input" disabled={busy} inputMode={k==='max_stock'?'decimal':undefined} value={r[k]||''} onChange={e=>update(r.id,{[k]:e.target.value})}/></label>)}</div></details>)}</div><button className="btn primary section" disabled={busy||!rows.some(r=>r.selected)} onClick={save}>{busy?'Importing…':mayLink?'Create / Match & Link Reviewed Items':'Create / Match Reviewed Items'}</button></>}</details>
}
