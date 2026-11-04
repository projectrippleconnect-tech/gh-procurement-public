'use client'
import {useEffect,useState} from 'react'

export function ApprovedCompanyNames({api,companyId,flash=()=>{},fail=()=>{},onChanged=()=>{}}){
 const [busy,setBusy]=useState(false),[data,setData]=useState(null)
 useEffect(()=>{setData(null)},[companyId])
 async function refresh(){
  setBusy(true)
  try{setData(await api('approved-sync',{action:'preview'}))}
  catch(e){fail(e)}finally{setBusy(false)}
 }
 async function applyAll(){
  if(busy||!data?.remaining)return
  setBusy(true)
  try{
   let applied=0,last=Number(data.remaining)
   for(let i=0;i<20&&last>0;i++){
    const result=await api('approved-sync',{action:'apply'})
    if(!result.ok)throw new Error(result.error||'Approved-name sync failed.')
    applied+=Number(result.applied)||0
    last=Number(result.remaining)||0
    if(!Number(result.applied))break
   }
   const current=await api('approved-sync',{action:'preview'})
   setData(current)
   if(applied)await onChanged()
   flash(applied+' approved names applied. '+current.remaining+' need further processing or review.')
  }catch(e){fail(e)}
  finally{setBusy(false)}
 }
 return <details className="section">
  <summary>Approved company item names — ready to apply</summary>
  <p className="muted tiny">Your approved names and categories are matched to existing company item IDs. The original maximum stocks, stock-count history, item codes and source keys will not be changed. This action uses your signed-in Super Admin permissions.</p>
  <button className="btn section" disabled={busy} onClick={refresh}>{busy?'Processing…':'Check approved changes'}</button>
  {data&&<div className="section">
   <p className="muted tiny"><strong>{data.remaining}</strong> still to apply · <strong>{data.completed}</strong> completed · <strong>{data.total}</strong> approved names in this batch.</p>
   {(data.sample||[]).slice(0,5).map((x,i)=><p key={i} className="muted tiny">{x.expected_description} → <strong>{x.reviewed_description}</strong></p>)}
   <button type="button" className="btn primary section" disabled={busy||!data.remaining} onClick={applyAll}>Apply all approved names</button>
  </div>}
 </details>
}
