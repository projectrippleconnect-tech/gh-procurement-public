'use client'

import {ModernSelect} from './modern-select'
import {useEffect,useRef,useState} from 'react'
import {extractDocumentTextFile} from '@/lib/price-list-extract'
import {receiptRows,reviewedReceipt} from '@/lib/document-review.mjs'
import {itemTitle} from '@/lib/helpers'

export function ReceiptOcr({poId,lines,disabled,onApply,fail}){
 const[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(null)
 const revision=useRef(0)
 useEffect(()=>{revision.current++;setRows([]);setProgress(null);setBusy(false);return()=>{revision.current++}},[poId])
 async function read(e){
  const file=e.target.files?.[0];e.target.value='';if(!file)return
  const run=++revision.current;setBusy(true);setRows([])
  try{const result=await extractDocumentTextFile(file,p=>{if(run===revision.current)setProgress(p)});if(run!==revision.current)return;const draft=receiptRows(result.pages.map(p=>p.text).join('\n'),lines);setRows(draft);if(!draft.length)throw new Error('No receipt rows detected. Try a clearer photo or enter quantities manually.')}catch(err){if(run===revision.current)fail(err)}finally{if(run===revision.current)setBusy(false)}
 }
 function update(id,patch){setRows(v=>v.map(r=>r.id===id?{...r,...patch}:r))}
 async function apply(){try{if(await onApply(reviewedReceipt(rows,lines))!==false)setRows([])}catch(e){fail(e)}}
 return <details className="section"><summary>Scan GRN / delivery note (OCR)</summary><p className="muted tiny">Upload a photo or PDF. Check each PO item and received quantity, then select the rows to apply. Accepted and rejected quantities require your inspection.</p><label className="field">GRN / delivery document<input type="file" accept="image/*,application/pdf" disabled={disabled||busy} onChange={read}/></label>{busy&&<p role="status">{progress?.stage||'Reading document'} · {Math.round(Number(progress?.progress||0)*100)}%</p>}{rows.length>0&&<><div className="stack section">{rows.map(r=><div className="procurement-data-row" key={r.id}><div className="toolbar"><label><input type="checkbox" checked={r.selected} disabled={disabled} onChange={e=>update(r.id,{selected:e.target.checked})}/> Use</label><button className="btn small bad" disabled={disabled} onClick={()=>setRows(v=>v.filter(x=>x.id!==r.id))}>Remove row</button></div><p className="muted tiny">{r.raw}</p><div className="formgrid"><label className="field">PO item<ModernSelect className="select" disabled={disabled} value={r.lineId} onChange={e=>update(r.id,{lineId:e.target.value})}><option value="">Choose item…</option>{lines.map(l=><option key={l.id} value={l.id}>{itemTitle(l.item||{})} · {l.item?.item_code}</option>)}</ModernSelect></label><label className="field">Received quantity<input className="input" inputMode="decimal" disabled={disabled} value={r.qty} onChange={e=>update(r.id,{qty:e.target.value})}/></label></div></div>)}</div><button className="btn primary section" disabled={disabled||busy} onClick={apply}>Apply Reviewed GRN Rows</button></>}</details>
}
