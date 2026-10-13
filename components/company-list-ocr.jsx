'use client'
import {useEffect,useRef,useState} from 'react'
import {extractDocumentTextFile} from '@/lib/price-list-extract'
import {COMPANY_REVIEW_FIELDS,companyReviewRow,parseCompanyBillPages,parseCompanySpreadsheet,companyReviewPayload} from '@/lib/company-bill-review.mjs'
import {normalizeQuantityInput} from '@/lib/quantity-input.mjs'
import {supabase} from '@/lib/supabase'

export function CompanyListOcr({companyId,can,profile,fail,flash,onImported}){
 const[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[category,setCategory]=useState('GENERAL'),[subgroup,setSubgroup]=useState(''),[paste,setPaste]=useState(''),[rawText,setRawText]=useState(''),[extra,setExtra]=useState(false),[source,setSource]=useState(null)
 const revision=useRef(0),sequence=useRef(0),sourceUrl=useRef(null)
 function revokeSource(){if(sourceUrl.current)URL.revokeObjectURL(sourceUrl.current);sourceUrl.current=null}
 useEffect(()=>{revision.current++;setRows([]);setBusy(false);setProgress(null);setRawText('');setPaste('');setSource(null);revokeSource();return()=>{revision.current++;revokeSource()}},[companyId])
 if(!can('items.edit'))return null
 const mayLink=(profile.role_key||profile.role)==='admin'&&can('company_lists.manage')
 const defaults={category,subgroup}
 const pending=rows.filter(r=>r.selected&&!r.status).length
 const fields=extra?COMPANY_REVIEW_FIELDS:COMPANY_REVIEW_FIELDS.slice(0,6)
 function append(values){setRows(v=>[...v,...values.map(row=>({...row,id:String(++sequence.current)}))])}
 async function read(e){
  const file=e.target.files?.[0];e.target.value='';if(!file)return
  const run=++revision.current;setBusy(true);setProgress({stage:'Preparing bill for OCR',progress:0})
  revokeSource();const url=URL.createObjectURL(file);sourceUrl.current=url;setSource({url,name:file.name})
  try{
   const result=await extractDocumentTextFile(file,p=>{if(run===revision.current)setProgress(p)})
   if(run!==revision.current)return
   setRawText(result.rawText)
   const detected=parseCompanyBillPages(result.pages,defaults)
   if(!detected.length)throw new Error('No item rows found. Enter rows manually or paste from Excel below; try a clearer bill photo for OCR.')
   append(detected);flash(detected.length+' rows extracted. Check spellings and select the corrected items to add.')
  }catch(err){if(run===revision.current)fail(err)}finally{if(run===revision.current)setBusy(false)}
 }
 function update(id,patch){setRows(v=>v.map(r=>r.id===id?{...r,...patch}:r))}
 function pasteRows(){try{const values=parseCompanySpreadsheet(paste,defaults);if(!values.length)throw new Error('Paste at least one item row.');append(values);setPaste('')}catch(e){fail(e)}}
 async function save(){
  let payload
  try{payload=companyReviewPayload(rows)}catch(e){return fail(e)}
  setBusy(true);setProgress(null)
  const run=revision.current,selectedIds=new Set(rows.filter(r=>r.selected&&!r.status).map(r=>r.id))
  try{
   const r=await supabase.rpc('proc_import_company_items_v1',{p_rows:payload,p_company_id:companyId,p_add_to_company_list:mayLink})
   if(r.error)throw r.error
   if(run!==revision.current)return
   setRows(v=>v.map(row=>selectedIds.has(row.id)?{...row,selected:false,status:'Imported / matched'}:row))
   flash((r.data.created||0)+' new items; '+(r.data.existing||0)+' existing matches.'+(mayLink?' Selected items linked to company list.':''));await onImported()
  }catch(e){if(run===revision.current)fail(e)}finally{if(run===revision.current)setBusy(false)}
 }
 return <details className="card pad section"><summary>Import Company List with OCR</summary>
  <p className="muted tiny">Upload a company bill or list, correct OCR spellings in the sheet, add missing rows, then select the reviewed items and click Add. Existing matches are reused.{mayLink?' Reviewed items are linked to this company list.':' Items are created in Item Master; an admin can link them to the company list.'}</p>
  <label className="field">Company list photo / PDF<input type="file" accept="image/*,application/pdf" disabled={busy||!companyId} onChange={read}/></label>
  {source&&<p className="tiny"><a href={source.url} target="_blank" rel="noopener noreferrer">View original bill: {source.name}</a></p>}
  {busy&&<p role="status">{progress?progress.stage+' · '+Math.round(Number(progress.progress||0)*100)+'%':'Adding reviewed items…'}</p>}
  <div className="formgrid section"><label className="field">Category<input className="input" disabled={busy} value={category} onChange={e=>setCategory(e.target.value)}/></label><label className="field">Subcategory<input className="input" disabled={busy} value={subgroup} onChange={e=>setSubgroup(e.target.value)}/></label></div>
  <div className="toolbar section"><button className="btn small" disabled={busy} onClick={()=>append([companyReviewRow({},defaults)])}>Add blank row</button><button className="btn small" disabled={busy||!rows.length} onClick={()=>setRows(v=>v.map(r=>({...r,selected:!r.status})))}>Select all</button><button className="btn small" disabled={busy||!rows.length} onClick={()=>setRows(v=>v.map(r=>({...r,selected:false})))}>Deselect all</button><button className="btn small" disabled={busy||!pending} onClick={()=>setRows(v=>v.map(r=>r.selected&&!r.status?{...r,category,subgroup}:r))}>Apply category to selected</button></div>
  <details className="section"><summary>Paste rows from Excel</summary><p className="muted tiny">Copy cells and paste below. Column order: Item name, Size, UOM, Category, Subcategory, Target stock, Brand, Item code, Movement, Main category group. You can also include these headings to use a different column order. Missing columns use the category above, PCS, NORMAL and target stock 0.</p><label className="field">Spreadsheet rows<textarea className="textarea" rows={5} disabled={busy} value={paste} onChange={e=>setPaste(e.target.value)} placeholder={'PVC elbow\t20 mm\tPCS\tGENERAL\tPVC fittings\t10'}/></label><button className="btn small section" disabled={busy||!paste.trim()} onClick={pasteRows}>Add pasted rows to review</button></details>
  {rawText&&<details className="section"><summary>View extracted bill text</summary><pre className="company-bill-raw">{rawText}</pre></details>}
  {rows.length>0&&<><div className="toolbar section"><strong>{rows.length} rows · {pending} selected to add</strong><label><input type="checkbox" checked={extra} disabled={busy} onChange={e=>setExtra(e.target.checked)}/> Show brand, code and movement</label></div><p className="muted tiny">Edit cells directly. On phones, swipe the sheet sideways to see more columns. OCR rows start unselected so you can check them first.</p>
   <div className="tablewrap company-review-sheet" role="region" aria-label="Company item review sheet" tabIndex={0}><table className="table"><thead><tr><th>Add</th><th>No.</th>{fields.map(([k,label])=><th key={k}>{label}</th>)}<th>Source / status</th><th>Remove</th></tr></thead><tbody>{rows.map((r,i)=><tr key={r.id}><td><input type="checkbox" aria-label={'Select row '+(i+1)} disabled={busy||!!r.status} checked={r.selected} onChange={e=>update(r.id,{selected:e.target.checked})}/></td><td>{i+1}</td>{fields.map(([k,label])=><td key={k}>{k==='movement'?<select className="select" aria-label={label+' row '+(i+1)} disabled={busy||!!r.status} value={r[k]} onChange={e=>update(r.id,{[k]:e.target.value})}>{['FAST','NORMAL','SLOW'].map(m=><option key={m}>{m}</option>)}</select>:<input className="input" aria-label={label+' row '+(i+1)} disabled={busy||!!r.status} inputMode={k==='max_stock'?'decimal':undefined} value={r[k]??''} onChange={e=>update(r.id,{[k]:e.target.value})} onBlur={k==='max_stock'?()=>update(r.id,{max_stock:normalizeQuantityInput(r.max_stock)??r.max_stock}):undefined}/>}</td>)}<td><span className="tiny">{r.status|| (r.source_page?'Page '+r.source_page+(r.extraction_confidence==null?'':' · OCR '+Math.round(r.extraction_confidence)+'%'):'Manual row')}</span>{r.raw_line&&<details><summary className="tiny">Original text</summary><p className="tiny company-bill-source">{r.raw_line}</p></details>}</td><td><button className="btn small bad" aria-label={'Remove row '+(i+1)} disabled={busy} onClick={()=>setRows(v=>v.filter(x=>x.id!==r.id))}>×</button></td></tr>)}</tbody></table></div>
   <button className="btn primary section" disabled={busy||!pending} onClick={save}>{busy?'Adding…':mayLink?'Add Reviewed Items to Company List':'Add Reviewed Items to Item Master'}</button>
  </>}
 </details>
}
