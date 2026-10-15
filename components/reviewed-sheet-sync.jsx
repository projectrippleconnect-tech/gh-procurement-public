'use client'
import {useEffect,useState} from 'react'

/** Preview/approval runs as the logged-in Super Admin, never as service_role. */
export function ReviewedSheetSync({company,api,canManage=false,connectionStatus=null,flash=()=>{},fail=()=>{},onChanged=()=>{}}){
 const [busy,setBusy]=useState(false)
 const [preview,setPreview]=useState(null)
 const [ackLegacy,setAckLegacy]=useState(false)
 useEffect(()=>{setPreview(null);setAckLegacy(false)},[company?.id])
 if(!canManage||(company?.sheet_id===null||company?.sheet_id===undefined))return null
 async function run(action){
  if(busy)return
  setBusy(true)
  try{
   const result=await api('reviewed-sync',{companyId:company.id,action,...(action==='apply'?{fingerprint:preview?.fingerprint,ackLegacy}:{})})
   if(action==='apply'){
    setPreview(null)
    await onChanged()
    flash(result.message)
    if(result.errors?.length)fail(new Error(result.errors[0]))
   }else {setPreview(result);setAckLegacy(false)}
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 return <details className="section"><summary>Reviewed Google Sheet — safe naming & category sync</summary>
  <p className="muted tiny">Preview matches existing item IDs by source keys, or by verified legacy ordering plus stock and item attributes. Uncertain matches are excluded. Maximum stock, stock counts, order history and purchase records are unchanged.</p>
  {connectionStatus?.configured===false&&<p className="muted tiny" role="status">Google Sheets is not connected. Complete the service-account setup under Google Sheets connection above, then refresh its connection status. Your existing company items and stock remain available.</p>}
  <button className="btn section" disabled={busy||connectionStatus?.configured!==true} onClick={()=>run('preview')}>{busy?'Checking source and app records…':connectionStatus?.configured===false?'Connect Google Sheets to preview':'Preview reviewed catalogue'}</button>
  {preview&&<div className="card pad section">
   <p><strong>{preview.stats?.changes||0}</strong> proposed changes · <strong>{preview.stats?.sourceKeyMatches||0}</strong> original-key matches · <strong>{preview.stats?.verifiedLegacyMatches||0}</strong> verified legacy matches · <strong>{preview.stats?.unmatched||0}</strong> manual review.</p>
   {preview.unmatchedSample?.length>0&&<p className="muted tiny">Unmatched source records were excluded. Nothing will be created or deleted.</p>}
   {(preview.previewSample||[]).slice(0,8).map(row=><p key={row.id} className="muted tiny">{row.from} → <strong>{row.to}</strong>{row.category&&<span> · {row.category}</span>}{row.matchMethod==='verified_legacy'&&<span> · Verified legacy identity</span>}</p>)}
   {preview.stats?.verifiedLegacyMatches>0&&<label className="checkline section"><input type="checkbox" checked={ackLegacy} onChange={e=>setAckLegacy(e.target.checked)}/>I have checked the proposed legacy matches and their existing item identities.</label>}
   {preview.stats?.changes>0&&<button className="btn primary section" disabled={busy||(preview.stats?.verifiedLegacyMatches>0&&!ackLegacy)} onClick={()=>run('apply')}>Apply up to 25 verified changes</button>}
  </div>}
 </details>
}
