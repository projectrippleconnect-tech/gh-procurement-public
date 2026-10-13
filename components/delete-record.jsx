'use client'
import {useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useDangerConfirmation} from './danger-confirmation'
import {ModernSelect} from './modern-select'

export const recordTypes={proc_suppliers:['Suppliers','supplier_code'],proc_companies:['Companies','name'],proc_rfqs:['RFQs','rfq_no'],proc_purchase_orders:['Purchase orders','po_no'],proc_requirements:['Purchase requests','requirement_no'],proc_quotes:['Supplier quotations','quote_ref'],proc_supplier_invoices:['Supplier invoices','invoice_no'],proc_grns:['Goods receipts','grn_no'],proc_stock_counts:['Stock submissions','count_no'],proc_item_requests:['Item requests','id'],proc_company_price_lists:['Company price lists','id'],proc_company_list_items:['Company items','id']}

export function DeleteRecordButton({profile,table,record,label,onDeleted,fail,disabled=false}){
 const confirm=useDangerConfirmation(),[busy,setBusy]=useState(false)
 if((profile?.role_key||profile?.role)!=='admin')return null
 async function remove(){
  setBusy(true)
  try{
   const preview=await supabase.rpc('proc_admin_record_preview_v1',{p_table:table,p_id:record.id});if(preview.error)throw preview.error
   await confirm({title:'Delete '+label,message:'Delete '+preview.data.label+' and the linked records listed below? Current stock and stock audit history remain. Removing a receipt or order line also removes its complete purchase order to avoid incomplete orders.',details:Object.entries(preview.data.counts).map(([key,n])=>key.replace(/^proc_/,'').replaceAll('_',' ')+': '+n).join(' · '),confirmation:'DELETE '+preview.data.label,requireReason:true,confirmLabel:'Delete permanently',onConfirm:async({confirmation,reason})=>{
    const result=await supabase.rpc('proc_admin_delete_record_v1',{p_table:table,p_id:record.id,p_token:preview.data.token,p_confirmation:confirmation,p_reason:reason});if(result.error)throw result.error
    await onDeleted?.()
   }})
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 return <button type="button" className="btn small bad" disabled={disabled||busy} onClick={remove}>{busy?'Reviewing…':'Delete '+label}</button>
}

export function RecordDeletion({profile,flash,fail}){
 const request=useRef(0)
 const[table,setTable]=useState('proc_rfqs'),[rows,setRows]=useState([]),[search,setSearch]=useState(''),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[page,setPage]=useState(0),[total,setTotal]=useState(0)
 async function load(targetPage=page){const serial=++request.current;setLoading(true);try{const r=await supabase.from(table).select('*',{count:'exact'}).order('created_at',{ascending:false}).order('id').range(targetPage*100,targetPage*100+99);if(serial!==request.current)return;if(r.error)throw r.error;setRows(r.data||[]);setPage(targetPage);setTotal(r.count||0);setLoaded(true)}catch(e){if(serial===request.current)fail(e)}finally{if(serial===request.current)setLoading(false)}}
 const field=recordTypes[table][1],filtered=rows.filter(r=>Object.values(r).some(v=>typeof v==='string'&&v.toLowerCase().includes(search.toLowerCase())))
 return <div className="section"><h4>Delete an individual record</h4><p className="muted tiny">Review linked records before deleting. Items, users and roles also have delete controls in their own sections. Audit history is retained.</p><div className="formgrid"><label className="field">Record type<ModernSelect className="select" value={table} onChange={e=>{request.current++;setLoading(false);setTable(e.target.value);setRows([]);setLoaded(false);setPage(0);setTotal(0);setSearch('')}}>{Object.entries(recordTypes).map(([key,v])=><option key={key} value={key}>{v[0]}</option>)}</ModernSelect></label><label className="field">Search loaded records<input className="input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Number, reference or description"/></label></div><button className="btn section" disabled={loading} onClick={()=>load()}>{loading?'Loading…':'Load records'}</button><div className="stack section">{filtered.map(r=><div className="procurement-data-row toolbar" key={r.id}><div><b>{r[field]||r.id}</b><small className="muted"> · {r.status||''} · {r.created_at?new Date(r.created_at).toLocaleString():''}</small></div><DeleteRecordButton profile={profile} table={table} record={r} label="record" fail={fail} onDeleted={async()=>{flash('Record deleted.');await load()}}/></div>)}{loaded&&!filtered.length&&<p className="muted">No matching records on this page.</p>}</div>{loaded&&<div className="toolbar section"><button className="btn small" disabled={loading||page===0} onClick={()=>load(page-1)}>Previous</button><span className="muted tiny">Page {page+1} · {total} records</span><button className="btn small" disabled={loading||(page+1)*100>=total} onClick={()=>load(page+1)}>Next</button></div>}</div>
}
