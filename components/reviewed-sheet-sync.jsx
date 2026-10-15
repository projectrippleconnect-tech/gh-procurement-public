'use client'
import {useEffect,useState} from 'react'

/** Preview/approval runs as the logged-in Super Admin, never as service_role. */
export function ReviewedSheetSync({company,api,canManage=false,flash=()=>{},fail=()=>{},onChanged=()=>{}}){
 const [busy,setBusy]=useState(false)
 const [preview,setPreview]=useState(null)
 useEffect(()=>setPreview(null),[company?.id])
 if(!canManage||(company?.sheet_id===null||company?.sheet_id===undefined))return null
 async function run(action){
  if(busy)return
  setBusy(true)
  try{
   const result=await api('reviewed-sync',{companyId:company.id,action,...(action==='apply'?{fingerprint:preview?.fingerprint}:{})})
   if(action==='apply'){
    setPreview(null)
    await onChanged()
    flash(result.message)
    if(result.errors?.length)fail(new Error(result.errors[0]))
   }else setPreview(result)
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 return <details className="section"><summary>Reviewed Google Sheet — safe naming & category sync</summary>
  <p className="muted tiny">Preview matches existing item IDs by their original source keys. Source keys that changed are held for review, never treated as new items. Maximum stock, stock counts, order history and purchase records are unchanged.</p>
  <button className="btn section" disabled={busy} onClick={()=>run('preview')}>{busy?'Checking source and app records…':'Preview reviewed catalogue'}</button>
  {preview&&<div className="card pad section">
   <p><strong>{preview.stats?.changes||0}</strong> safe changes · <strong>{preview.stats?.unmatched||0}</strong> require manual matching · <strong>{preview.stats?.noReviewedName||0}</strong> without a reviewed name.</p>
   {preview.unmatchedSample?.length>0&&<p className="muted tiny">Unmatched source records were excluded. Nothing will be created or deleted.</p>}
   {(preview.previewSample||[]).slice(0,8).map(row=><p key={row.id} className="muted tiny">{row.from} → <strong>{row.to}</strong>{row.category&&<span> · {row.category}</span>}</p>)}
   {preview.stats?.changes>0&&<button className="btn primary section" disabled={busy} onClick={()=>run('apply')}>Apply up to 25 verified changes</button>}
  </div>}
 </details>
}
