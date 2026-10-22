'use client'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import SupplierRoundControls from '@/components/supplier-round-controls'

const field={background:'#0d1829',border:'1px solid #40546b',borderRadius:9,padding:10,color:'white',minWidth:0,fontSize:15}
const box={border:'1px solid #344861',background:'#132136',padding:14,borderRadius:14,marginBottom:12}
const btn={padding:'10px 12px',borderRadius:9,border:'1px solid #43566e',background:'#243850',color:'white',cursor:'pointer'}
const lower=s=>String(s||'').toLowerCase()
async function secureToken(){
 const bytes=crypto.getRandomValues(new Uint8Array(32))
 const token=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('')
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))
 return {token,hash:Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('')}
}
export default function SupplierLinks(){
 const loadSequence=useRef(0),currentRfq=useRef('')
 const [requests,setRequests]=useState([])
 const [workflow,setWorkflow]=useState('general')
 const [selected,setSelected]=useState('')
 currentRfq.current=selected
 const [invitations,setInvitations]=useState([])
 const [responses,setResponses]=useState([])
 const [items,setItems]=useState([])
 const [hours,setHours]=useState('6')
 const [busy,setBusy]=useState('')
 const [error,setError]=useState('')
 const [lastLink,setLastLink]=useState(null)
 const [query,setQuery]=useState('')
 const [message,setMessage]=useState('')
 const [supplierFilter,setSupplierFilter]=useState('')
 const [portalReady,setPortalReady]=useState(true)
 const refresh=useCallback(async()=>{
  const {data,error}=await supabase.from('proc_rfqs').select('id,rfq_no,status,created_at,items:proc_rfq_items(requirement:proc_requirements(company_id))').order('created_at',{ascending:false}).limit(150)
  if(error)throw error
  setRequests(data||[])
  const params=new URLSearchParams(window.location.search)
  const requested=params.get('rfq')||''
  setSupplierFilter(params.get('supplier')||'')
  const wanted=(data||[]).find(r=>r.id===requested)
  const kind=wanted?(wanted.items?.some(i=>i.requirement?.company_id)?'company':'general'):(params.get('workflow')==='company'?'company':'general')
  setWorkflow(kind)
  const matching=(data||[]).filter(r=>(r.items?.some(i=>i.requirement?.company_id)?'company':'general')===kind)
  setSelected(s=>s||(wanted?.id||matching[0]?.id||''))
 },[])
 useEffect(()=>{refresh().catch(e=>setError(e.message))},[refresh])
 const load=useCallback(async id=>{
  if(!id)return
  const sequence=++loadSequence.current
  setError('')
  const [invs,quotes,lines]=await Promise.all([
   supabase.from('proc_rfq_suppliers').select('id,supplier_id,status,supplier:proc_suppliers(name,whatsapp,phone)').eq('rfq_id',id),
   supabase.rpc('proc_portal_staff_responses_v1',{p_rfq_id:id}),
   supabase.from('proc_rfq_items').select('id,requested_qty,requirement:proc_requirements(item:proc_items(description,size,uom))').eq('rfq_id',id)
  ])
  for(const result of [invs,lines])if(result.error)throw result.error
  const unavailable=quotes.error&&['PGRST202','42883'].includes(quotes.error.code)
  if(quotes.error&&!unavailable)throw quotes.error
  if(sequence!==loadSequence.current||id!==currentRfq.current)return
  setPortalReady(!unavailable);setInvitations(invs.data||[]);setResponses(quotes.data||[]);setItems(lines.data||[])
 },[])
 useEffect(()=>{if(selected)load(selected).catch(e=>setError(e.message));return()=>{loadSequence.current++}},[selected,load])
 const identified=useMemo(()=>new Map(responses.map(r=>[r.rfq_supplier_id,r])),[responses])
 const priceSummary=useMemo(()=>{
  const byItem=new Map()
  for(const r of responses.filter(x=>['confirmed','imported'].includes(x.status))){
   for(const line of r.response||[]){
    if(line.status!=='in_stock')continue
    const price=Number(line.price),qty=Number(line.quantity)
    if(!Number.isFinite(price)||price<0||!Number.isFinite(qty)||qty<=0)continue
    const best=byItem.get(line.id)
    if(!best||price<best.price)byItem.set(line.id,{price,supplier:r.supplier_name,qty})
   }
  }
  return byItem
 },[responses])
 async function issue(inv){
  if(busy||!portalReady)return
  if(identified.get(inv.id)&&!window.confirm('Generate a new link? Any previously shared link for this supplier will stop working. Saved responses remain.'))return
  setBusy(inv.id);setError('');setMessage('')
  try{
   const {token,hash}=await secureToken()
   const {data,error}=await supabase.rpc('proc_portal_issue_link_v1',{p_rfq_supplier_id:inv.id,p_token_hash:hash,p_hours:Number(hours)})
   if(error)throw error
   const url=new URL('/supplier/quote',window.location.origin);url.hash=new URLSearchParams({token}).toString()
   setLastLink({id:inv.id,url:String(url),name:inv.supplier?.name||'Supplier',phone:inv.supplier?.whatsapp||inv.supplier?.phone||'',due:data.closes_at})
   await load(selected)
  }catch(e){setError(e.message)}finally{setBusy('')}
 }
 async function revokeLink(record){
  if(busy||!window.confirm('Revoke this private supplier link immediately? Saved quotations and history will remain.'))return
  setBusy(record.link_id);setError('');setMessage('')
  try{
   const {error}=await supabase.rpc('proc_portal_revoke_link_v1',{p_link_id:record.link_id})
   if(error)throw error
   setMessage('Supplier link revoked. To request another quotation, generate a new link.')
   await load(selected)
  }catch(e){setError(e.message)}finally{setBusy('')}
 }
 async function importQuote(record){
  if(busy)return
  if(!window.confirm('Import this confirmed quotation into GH Prices? Existing rates for the same supplier may be replaced. Alternative variations require separate review.'))return
  setBusy(record.link_id);setError('');setMessage('')
  try{
   const {data,error}=await supabase.rpc('proc_portal_import_confirmed_v1',{p_link_id:record.link_id,p_expected_revision:record.revision})
   if(error)throw error
   setMessage(data?.status==='already_imported'?'This revision was already imported.':'Quotation imported into GH Prices. Compare landed costs before creating any PO.')
   await load(selected)
  }catch(e){setError(e.message)}finally{setBusy('')}
 }
 async function share(){
  if(!lastLink)return
  const body='General Hardware — Supplier Price Request\nHello '+lastLink.name+', please enter your unit prices, availability and photos before '+new Date(lastLink.due).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})+' (Sri Lanka time).\n'+lastLink.url
  const digits=lastLink.phone.replace(/\D/g,'').replace(/^0/,'94')
  if(digits)window.open('https://wa.me/'+digits+'?text='+encodeURIComponent(body),'_blank','noopener,noreferrer')
  else {await navigator.clipboard.writeText(body);setMessage('Invite text copied; no WhatsApp number on record.')}
 }
 const selectedRfq=requests.find(x=>x.id===selected)
 return <main style={{background:'#0a1423',color:'#f8fafc',minHeight:'100vh',fontFamily:'system-ui, sans-serif',padding:'18px 12px'}}>
 <div style={{maxWidth:850,margin:'0 auto'}}>
  <p style={{fontSize:12,letterSpacing:2,color:'#fbbf24'}}>GENERAL HARDWARE · PROCUREMENT</p>
  <h1>Supplier quotation links</h1>
  <p style={{color:'#cbd5e1'}}>Each supplier receives a private link. They can save drafts, mark no stock, attach photos, and confirm. Confirmed exact-item prices appear in GH Prices. Drafts and alternative variations remain separate.</p>
  <p><a style={{color:'#fbbf24'}} href="/">← Back to Procurement</a></p>
  {error&&<p role="alert" style={{color:'#fecaca'}}>{error}</p>}
  {!portalReady&&<div role="status" style={{...box,borderColor:'#fbbf24'}}><strong>Supplier portal setup is pending</strong><p>The live database has not been configured for private supplier quote links yet. Links cannot be created or received until setup is completed. Your existing RFQs and manually entered prices remain available.</p></div>}
  {message&&<p role="status" style={{color:'#86efac'}}>{message}</p>}
  <div style={box}>
   <label>Workflow </label><select disabled={!!busy} aria-label="Workflow" style={field} value={workflow} onChange={e=>{setWorkflow(e.target.value);setSelected('');setInvitations([]);setResponses([]);setItems([]);setLastLink(null)}}><option value="general">General Items</option><option value="company">Company Items</option></select><p>Choose RFQ</p>
   <select disabled={!!busy} style={{...field,width:'100%',margin:'8px 0'}} value={selected} onChange={e=>{setSelected(e.target.value);setLastLink(null)}}><option value="">Select RFQ</option>{requests.filter(r=>(r.items?.some(i=>i.requirement?.company_id)?'company':'general')===workflow).map(r=><option key={r.id} value={r.id}>{r.rfq_no} · {r.status}</option>)}</select>
   <label>Supplier quotation window </label>
   <select style={{...field,marginLeft:8}} value={hours} onChange={e=>setHours(e.target.value)}><option value="2">2 hours</option><option value="4">4 hours</option><option value="6">6 hours</option><option value="12">12 hours</option><option value="24">24 hours</option><option value="48">48 hours</option></select>
   <button type="button" style={{...btn,marginLeft:8}} onClick={()=>load(selected).catch(e=>setError(e.message))}>Refresh</button>
  </div>
  {lastLink&&<div style={{...box,borderColor:'#fbbf24'}}>
   <strong>New private link for {lastLink.name}</strong>
   <p style={{color:'#cbd5e1',fontSize:12}}>Copy and send now. For security, the original token cannot be retrieved again later.</p>
   <textarea readOnly aria-label="Supplier link" style={{...field,width:'100%',height:82,boxSizing:'border-box'}} value={lastLink.url}/>
   <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:10}}>
    <button style={btn} onClick={async()=>{await navigator.clipboard.writeText(lastLink.url);setMessage('Private link copied.')}}>Copy link</button>
    <button style={{...btn,background:'#fbbf24',color:'#111'}} onClick={share}>Open WhatsApp invitation</button>
   </div>
  </div>}
  <input aria-label="Find supplier" placeholder="Search suppliers…" value={query} onChange={e=>setQuery(e.target.value)} style={{...field,width:'100%',boxSizing:'border-box',marginBottom:12}}/>
  {supplierFilter&&<p>Showing the selected supplier. <button style={btn} onClick={()=>setSupplierFilter('')}>Show all RFQ suppliers</button></p>}
  {(invitations||[]).filter(x=>!supplierFilter||x.supplier_id===supplierFilter).filter(x=>lower(x.supplier?.name).includes(lower(query))).map(inv=>{
   const record=identified.get(inv.id),canImport=record?.status==='confirmed'&&!record?.revoked_at&&record?.revision!==record?.imported_revision
   return <section style={box} key={inv.id}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
     <div><strong>{inv.supplier?.name||'Unknown supplier'}</strong><div style={{fontSize:12,color:'#cbd5e1'}}>RFQ status: {inv.status} · Portal: {record?.revoked_at?'Revoked':record?.status||'Not invited by link'}</div>
      {record&&<div style={{fontSize:12,color:'#cbd5e1'}}>Window closes {new Date(record.closes_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})} · Revision {record.revision}</div>}
     </div>
     <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button disabled={!!busy||!portalReady} style={btn} onClick={()=>issue(inv)}>{busy===inv.id?'Working…':record?'Replace link':'Create link'}</button>
      {canImport&&<button disabled={!!busy} style={{...btn,background:'#fbbf24',color:'#111'}} onClick={()=>importQuote(record)}>Import confirmed prices</button>}
      {record&&!record.revoked_at&&<button disabled={!!busy} style={{...btn,borderColor:'#ef4444'}} onClick={()=>revokeLink(record)}>Revoke link</button>}
     </div>
    </div>
    {record?.response?.length>0&&<details style={{marginTop:12}}><summary>View supplier responses ({record.response.filter(x=>x.status==='in_stock').length} available)</summary>
     {record.response.map(line=>{
      const item=items.find(x=>x.id===line.id),name=item?.requirement?.item?.description||'Item'
      return <div key={line.id} style={{borderTop:'1px solid #334155',padding:'8px 0',fontSize:14}}>
       <strong>{name}</strong> · {line.status==='in_stock'?'Rs. '+line.price+' · Qty '+line.quantity:line.status}
       {line.image&&<img src={line.image} alt="Supplier supplied product" style={{display:'block',maxHeight:120,maxWidth:180,margin:8}}/>}
       {(line.variations||[]).map((v,i)=><div key={i} style={{paddingLeft:14,color:'#cbd5e1'}}>Alternative: {v.name} · Rs. {v.price} · {v.quantity}{v.image&&<img src={v.image} alt="Supplier alternative" style={{display:'block',maxHeight:110,maxWidth:180}}/>}</div>)}
      </div>
     })}
    </details>}
   </section>
  })}
  {selected&&portalReady&&<SupplierRoundControls key={selected} rfqId={selected} onChange={()=>load(selected).catch(e=>setError(e.message))}/>}
  {selectedRfq&&<section style={box}><h2>Provisional lowest unit rates</h2>
   <p style={{color:'#cbd5e1',fontSize:13}}>Informational only. GH Prices calculates full landed cost. Alternatives, freight, minimum orders, and quantities still require review.</p>
   {items.map(i=>{const best=priceSummary.get(i.id),item=i.requirement?.item
    return <div key={i.id} style={{display:'flex',justifyContent:'space-between',borderTop:'1px solid #344861',padding:'8px 0',gap:8}}>
     <span>{item?.description} {item?.size}</span><span style={{textAlign:'right',minWidth:100}}>{best?'Rs. '+best.price+' · '+best.supplier:'Awaiting rate'}</span>
    </div>
   })}
  </section>}
  <p style={{color:'#cbd5e1',fontSize:13}}>Automatic PO generation and sending are intentionally OFF until separately approved server activation. Six-hour rounds and pending PO review are available above. This page does not send WhatsApp messages automatically.</p>
 </div></main>
}