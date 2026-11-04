'use client'
import {useCallback,useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {auditQuery,completeAuditExport} from '@/lib/audit-history.mjs'
import {downloadCsv} from '@/lib/helpers'
import {DataTable,Empty} from './ui'

const blank={area:'',action:'',record:'',user:'',from:'',to:''}
export function AuditHistory({fail,t=(k,f)=>f||k}){
 const[draft,setDraft]=useState(blank),[filters,setFilters]=useState(blank),[page,setPage]=useState(0),[rows,setRows]=useState([]),[total,setTotal]=useState(0),[busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[refresh,setRefresh]=useState(0),[opened,setOpened]=useState(false)
 const revision=useRef(0),size=50
 const load=useCallback(async()=>{
  if(!opened)return
  const current=++revision.current;setBusy(true)
  try{const r=await auditQuery(supabase,filters).range(page*size,page*size+size-1);if(current!==revision.current)return;if(r.error)throw r.error;setRows(r.data||[]);setTotal(r.count||0)}
  catch(e){if(current===revision.current){setRows([]);setTotal(0);fail(e)}}
  finally{if(current===revision.current)setBusy(false)}
 },[filters,page,refresh,opened,fail])
 useEffect(()=>{load();return()=>{revision.current++}},[load])
 async function exportHistory(){
  if(exporting)return;setExporting(true)
  try{
   const data=await completeAuditExport(({cursor,ceiling,pageSize})=>{
    let q=auditQuery(supabase,filters).limit(pageSize)
    if(ceiling)q=q.lte('id',ceiling)
    if(cursor)q=q.lt('id',cursor)
    return q
   })
   downloadCsv('GH-audit-history.csv',data.map(r=>({ID:r.id,Time:r.created_at,Area:r.table_name,Action:r.action,'Record ID':r.record_id,'User ID':r.user_id||'system','Previous values':JSON.stringify(r.old_data),'New values':JSON.stringify(r.new_data)})))
  }catch(e){fail(e)}finally{setExporting(false)}
 }
 return <details name="gh-admin-section" className="admin-accordion" onToggle={e=>setOpened(e.currentTarget.open)}><summary>{t('admin.audit','Audit Trail')}</summary><div className="card pad section">
  <div className="sectionhead"><div><h3>{t('admin.audit','Audit Trail')}</h3><p>{total} matching changes · newest first</p></div><div className="toolbar"><button className="btn small" disabled={busy} onClick={()=>setRefresh(x=>x+1)}>{t('common.refresh','Refresh')}</button><button className="btn small" disabled={busy||exporting} onClick={exportHistory}>{exporting?'Preparing export…':'Export all matches · CSV'}</button></div></div>
  <form onSubmit={e=>{e.preventDefault();setPage(0);setFilters({...draft});setRefresh(x=>x+1)}}>
   <div className="report-controls">{[['area','Area','text'],['action','Exact action','text'],['record','Record ID','text'],['user','User ID','text'],['from','From','date'],['to','To','date']].map(([key,label,type])=><label className="field" key={key}>{label}<input className="input" type={type} value={draft[key]} onChange={e=>setDraft(v=>({...v,[key]:e.target.value}))}/></label>)}</div>
   <div className="toolbar section"><button className="btn primary" disabled={busy}>Search history</button><button className="btn" type="button" onClick={()=>{setDraft(blank);setFilters(blank);setPage(0);setRefresh(x=>x+1)}}>Clear filters</button></div>
  </form>
  {busy?<Empty>Loading audit history…</Empty>:<DataTable columns={[
   {key:'created_at',label:'Time',render:r=>new Date(r.created_at).toLocaleString('en-GB',{timeZone:'Asia/Colombo'})},{key:'table_name',label:'Area'},{key:'action',label:'Action'},
   {key:'record_id',label:'Record ID'},{key:'user_id',label:'User',render:r=>r.user_id||'system'},
   {key:'changes',label:'Changes',render:r=><details><summary>View changes</summary><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxWidth:'min(100%,36rem)'}}>{JSON.stringify({before:r.old_data,after:r.new_data},null,2)}</pre></details>}
  ]} rows={rows} mobileCards/>}
  <div className="toolbar section"><button className="btn small" disabled={busy||page===0} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page+1} of {Math.max(1,Math.ceil(total/size))}</span><button className="btn small" disabled={busy||(page+1)*size>=total} onClick={()=>setPage(p=>p+1)}>Next</button></div>
 </div></details>
}
