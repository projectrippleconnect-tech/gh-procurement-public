'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {defaultSupplierTemplate} from '@/lib/supplier-template.mjs'

export default function SupplierPortalSettings(){
 const [templates,setTemplates]=useState({po:defaultSupplierTemplate('po'),rfq:defaultSupplierTemplate('rfq')})
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const [status,setStatus]=useState(null)
 useEffect(()=>{let live=true;supabase.rpc('proc_supplier_document_settings_v1').then(({data,error})=>{if(!live)return;if(error){setMessage('Shared document settings need setup or RFQ management permission.');return}setTemplates(t=>({po:{...t.po,...data?.po},rfq:{...t.rfq,...data?.rfq}}));setReady(true)});return()=>{live=false}},[])
 async function save(){
  setBusy(true);setMessage('')
  try{const {error}=await supabase.rpc('proc_supplier_document_settings_v1',{p_templates:templates});if(error)throw error;setMessage('Shared templates saved. Changed automatic PO documents require dispatch review again.')}catch{setMessage('Could not save shared templates. Please check your permission and connection.')}finally{setBusy(false)}
 }
 async function checkGateway(){
  setBusy(true);setMessage('')
  try{const {data}=await supabase.auth.getSession();const r=await fetch('/api/supplier/status',{headers:{Authorization:'Bearer '+(data.session?.access_token||'')},cache:'no-store'});const result=await r.json();if(!r.ok)throw Error(result.error);setStatus(result)}catch(e){setMessage(e.message||'Could not check connectivity.')}finally{setBusy(false)}
 }
 return <details style={{border:'1px solid #40546b',borderRadius:12,padding:12,marginBottom:12}}><summary>Admin · supplier access and shared image headers</summary>
  <p>Supplier access requires the registered WhatsApp mobile number and a one-time code. Codes expire after 5 minutes, allow 5 attempts, and are limited to 5 requests per hour. Sessions expire within 2 hours or when the quotation closes. Replacing or revoking a link ends access.</p>
  <p>Supplier numbers are maintained in Suppliers. Verify each number before issuing an invitation. Company category routes retain their own saved document templates.</p>
  <button type="button" disabled={busy||!ready} onClick={checkGateway}>Check WhatsApp and OTP connectivity</button>
  {status&&<p role="status">Gateway: {status.connected?'connected':status.configured?'offline':'not configured'} · OTP: {status.otpEnabled?'enabled':'unavailable'} · Automatic PO dispatch: {status.dispatchEnabled?'enabled':'disabled'} · Delivery test: {status.deliveryVerified?'verified':'pending'}{status.networkMismatch?' · Netlify cannot reach a Railway private address.':''}</p>}
  {['rfq','po'].map(kind=><fieldset key={kind} disabled={!ready||busy} style={{border:'1px solid #40546b',margin:'12px 0',borderRadius:8}}><legend>{kind.toUpperCase()} shared template</legend>
   {[['name','Business header, e.g. G-E-N',80],['title','Document heading',60],['note','Image footer / instructions',300],['caption','WhatsApp caption',2000]].map(([key,label,max])=><label key={key} style={{display:'block',margin:'10px 0'}}>{label}<textarea aria-label={kind.toUpperCase()+' '+label} maxLength={max} rows={key==='caption'?3:2} value={templates[kind][key]||''} onChange={e=>setTemplates(t=>({...t,[kind]:{...t[kind],[key]:e.target.value}}))} style={{display:'block',width:'100%',boxSizing:'border-box',background:'#0d1829',color:'white',padding:8,border:'1px solid #64748b',borderRadius:6}}/></label>)}
  </fieldset>)}
  <p style={{fontSize:12}}>Caption fields: {'{company_name}, {supplier_name}, {rfq_number}, {po_number}, {due_date}'}. Shared templates apply as defaults for staff images; personal document edits override them. Background quoted POs use the saved shared PO template.</p>
  <button type="button" disabled={!ready||busy} onClick={save}>{busy?'Saving…':'Save shared templates'}</button>
  {message&&<p role="status">{message}</p>}
 </details>
}
