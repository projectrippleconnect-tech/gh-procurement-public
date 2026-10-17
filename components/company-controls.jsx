'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {ModernSelect} from './modern-select'
import {ReviewedSheetSync} from './reviewed-sheet-sync'
import {CompanySheetsConnection} from './company-sheets-connection'
import {ApprovedCompanyNames} from './approved-company-names'
import {defaultCompanyFields} from '@/lib/company-items.mjs'

export async function companyApi(action,payload={}){
 const {data:{session}}=await supabase.auth.getSession()
 const r=await fetch('/api/company-items/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+session?.access_token},body:JSON.stringify(payload)})
 const data=await r.json();if(!r.ok||data.ok===false)throw new Error(data.error||'Company action failed');return data
}
export function CompanyControls({company,rows,can,flash,fail,onChanged}){
 const admin=can('company_lists.manage'),canDocuments=admin||can('procurement.rfq.manage'),[form,setForm]=useState({}),[contacts,setContacts]=useState([]),[brandContacts,setBrandContacts]=useState({}),[documents,setDocuments]=useState([]),[queue,setQueue]=useState([]),[rfqQueue,setRfqQueue]=useState([]),[busy,setBusy]=useState(false)
 const[sheetsConnection,setSheetsConnection]=useState(null)
 const[doc,setDoc]=useState({kind:'quotation',discount_percent:'0',discount_amount:'0',remarks:'',send_with_order:false,supplier_id:'',item_id:'',quote_id:'',po_id:''}),[file,setFile]=useState(null),[quotes,setQuotes]=useState([]),[orders,setOrders]=useState([])
 async function load(){
  if(!canDocuments||!company?.id)return
  const results=await Promise.all([
   supabase.from('proc_suppliers').select('id,name,phone,whatsapp').eq('supplier_kind','company').eq('active',true).order('name'),
   supabase.from('proc_company_attachments').select('*').eq('company_id',company.id).order('created_at',{ascending:false}),
   supabase.from('proc_company_dispatch_queue').select('*').eq('company_id',company.id).order('created_at',{ascending:false}).limit(20),
   supabase.from('proc_quotes').select('id,quote_ref,supplier_id').order('created_at',{ascending:false}).limit(100),
   supabase.from('proc_purchase_orders').select('id,po_no,supplier_id').eq('company_id',company.id).order('created_at',{ascending:false}).limit(100),
   supabase.from('proc_company_contacts').select('brand,supplier_id').eq('company_id',company.id),
   supabase.from('proc_company_rfq_queue').select('id,status,last_error,message_id').eq('company_id',company.id).order('created_at',{ascending:false}).limit(30)
  ])
  for(const r of results)if(r.error)throw r.error
  setRfqQueue(results[6].data||[]);setContacts(results[0].data||[]);setDocuments(results[1].data||[]);setQueue(results[2].data||[]);setQuotes(results[3].data||[]);setOrders(results[4].data||[]);setBrandContacts(Object.fromEntries((results[5].data||[]).map(r=>[r.brand,r.supplier_id])))
 }
 useEffect(()=>{setForm({...company,visible_fields:{...defaultCompanyFields,...company?.visible_fields}});if(company?.id)load().catch(fail)},[company?.id,company?.updated_at,canDocuments])
 const run=async fn=>{if(busy)return;setBusy(true);try{await fn()}catch(e){fail(e)}finally{setBusy(false)}}
 if(!canDocuments)return null
 async function save(){
  const r=await supabase.from('proc_companies').update({name:form.name.trim(),order_route:form.order_route||'quotation',auto_approve:!!form.auto_approve,auto_send:!!form.auto_send,visible_fields:form.visible_fields||{}}).eq('id',company.id)
  if(r.error)throw r.error;onChanged();flash('Company settings saved.')
 }

 async function attach(){
  if(!file)throw new Error('Choose a PDF or image.')
  if(!['application/pdf','image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw new Error('Choose a PDF, PNG, JPEG or WebP up to 10 MB.')
  const percent=Number(doc.discount_percent),fixed=Number(doc.discount_amount)
  if(!Number.isFinite(percent)||percent<0||percent>100||!Number.isFinite(fixed)||fixed<0)throw new Error('Enter valid discounts.')
  const path='company-attachments/'+company.id+'/'+crypto.randomUUID()+'-'+file.name.replace(/[^a-zA-Z0-9._-]/g,'_')
  const u=await supabase.storage.from('gh-procurement').upload(path,file,{contentType:file.type});if(u.error)throw u.error
  const r=await supabase.from('proc_company_attachments').insert({...doc,company_id:company.id,supplier_id:doc.supplier_id||form.default_supplier_id||null,item_id:doc.item_id||null,quote_id:doc.quote_id||null,po_id:doc.po_id||null,name:file.name,storage_path:path,mime_type:file.type,discount_percent:percent,discount_amount:fixed})
  if(r.error){await supabase.storage.from('gh-procurement').remove([path]);throw r.error}
  setFile(null);await load();flash('Attachment, discounts and remarks saved.')
 }
 async function openDocument(d){const r=await supabase.storage.from('gh-procurement').createSignedUrl(d.storage_path,300);if(r.error)throw r.error;window.open(r.data.signedUrl,'_blank','noopener,noreferrer')}
 return <details className="card pad section"><summary>Company settings, groups, contacts &amp; attachments</summary>{admin&&<ApprovedCompanyNames api={companyApi} companyId={company?.id} flash={flash} fail={fail} onChanged={onChanged}/>}
 {admin&&<CompanySheetsConnection api={companyApi} companyId={company?.id} connection={sheetsConnection} onStatus={setSheetsConnection} flash={flash} fail={fail} onChanged={onChanged}/>}
 <ReviewedSheetSync company={company} api={companyApi} canManage={admin} connectionStatus={sheetsConnection} flash={flash} fail={fail} onChanged={onChanged}/>{admin&&<><div className="formgrid section">
  <label className="field">Company name<input className="input" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></label>
  <label className="field">Fallback order route (unconfigured groups)<ModernSelect className="select" value={form.order_route||'quotation'} onChange={e=>setForm(f=>({...f,order_route:e.target.value}))}><option value="quotation">Normal quotation and comparison</option><option value="direct">Direct quantity-only PO</option></ModernSelect></label>
  <label className="checkline"><input type="checkbox" checked={!!form.auto_approve} onChange={e=>setForm(f=>({...f,auto_approve:e.target.checked}))}/>Enable automatic direct PO approval after stock counts</label>
  <label className="checkline"><input type="checkbox" checked={!!form.auto_send} onChange={e=>setForm(f=>({...f,auto_send:e.target.checked}))}/>Auto-send fallback direct POs (group-specific settings override this)</label>
 </div><p className="muted tiny">Company suppliers and automation are managed in the guided setup above. These legacy brand contacts apply only when no saved category or company route exists.</p><details className="section"><summary>Supplier contacts by brand</summary><div className="formgrid section">{[...new Set(rows.map(r=>r.item?.brand).filter(Boolean))].map(brand=><label className="field" key={brand}>{brand}<ModernSelect className="select" value={brandContacts[brand]||''} onChange={e=>{const supplierId=e.target.value;run(async()=>{const r=supplierId?await supabase.from('proc_company_contacts').upsert({company_id:company.id,brand,supplier_id:supplierId},{onConflict:'company_id,brand'}):await supabase.from('proc_company_contacts').delete().eq('company_id',company.id).eq('brand',brand);if(r.error)throw r.error;setBrandContacts(v=>({...v,[brand]:supplierId}));flash('Brand supplier link saved.')})}}><option value="">Use default company contact</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</ModernSelect></label>)}</div></details><p className="muted tiny">Stock-row fields, fonts, and header colors are now controlled globally from Company Lists · Global display customization. Changing company details does not override those shared settings.</p><button className="btn primary section" disabled={busy} onClick={()=>run(save)}>Save company settings</button>
 <p className="muted tiny">Use Manage sections & nested categories above to move company items and whole branches without changing shared item-master categories.</p>
 </>}<details className="section"><summary>Quotation / price-list / order attachments</summary><div className="formgrid section"><label className="field">Document type<ModernSelect className="select" value={doc.kind} onChange={e=>setDoc(d=>({...d,kind:e.target.value}))}>{['quotation','price_list','order'].map(x=><option key={x}>{x}</option>)}</ModernSelect></label><label className="field">Document supplier<ModernSelect className="select" value={doc.supplier_id} onChange={e=>setDoc(d=>({...d,supplier_id:e.target.value,quote_id:''}))}><option value="">Default company contact</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</ModernSelect></label><label className="field">Item remarks (optional)<ModernSelect className="select" value={doc.item_id} onChange={e=>setDoc(d=>({...d,item_id:e.target.value}))}><option value="">Whole document</option>{rows.map(r=><option key={r.id} value={r.item_id}>{r.item?.description} {r.item?.size} {r.item?.colour}</option>)}</ModernSelect></label><label className="field">Quotation (optional)<ModernSelect className="select" value={doc.quote_id} onChange={e=>setDoc(d=>({...d,quote_id:e.target.value}))}><option value="">Unlinked company quotation</option>{quotes.filter(q=>q.supplier_id===(doc.supplier_id||form.default_supplier_id)).map(q=><option key={q.id} value={q.id}>{q.quote_ref||q.id.slice(0,8)}</option>)}</ModernSelect></label><label className="field">Purchase order (optional)<ModernSelect className="select" value={doc.po_id} onChange={e=>setDoc(d=>({...d,po_id:e.target.value}))}><option value="">Company reference</option>{orders.map(o=><option key={o.id} value={o.id}>{o.po_no}</option>)}</ModernSelect></label>{[['discount_percent','Discount %'],['discount_amount','Fixed discount'],['remarks','Remarks / discounted items']].filter(([k])=>form.visible_fields?.['attachment_'+k]!==false).map(([k,label])=><label className="field" key={k}>{label}<input className="input" value={doc[k]} onChange={e=>setDoc(d=>({...d,[k]:e.target.value}))}/></label>)}<label className="checkline"><input type="checkbox" checked={doc.send_with_order} onChange={e=>setDoc(d=>({...d,send_with_order:e.target.checked}))}/>Include this file with company purchase orders</label><label className="field">PDF or screenshot<input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={e=>setFile(e.target.files?.[0]||null)}/></label></div><button className="btn section" disabled={busy} onClick={()=>run(attach)}>Attach file with remarks</button>{documents.map(d=><div className="company-document-row" key={d.id}><button className="btn small" onClick={()=>run(()=>openDocument(d))}>{d.name}</button><span>{d.kind} · {d.discount_percent}% · {d.discount_amount} · {d.remarks}</span></div>)}</details>
 {admin&&<><details className="section"><summary>Automatic RFQ / PO sending ({queue.length+rfqQueue.length})</summary><button className="btn section" disabled={busy} onClick={()=>run(async()=>{const r=await companyApi('orders',{companyId:company.id});await load();flash(r.message)})}>Process approved company orders</button><button className="btn section" disabled={busy} onClick={()=>run(async()=>{const r=await companyApi('rfqs',{companyId:company.id});await load();flash(r.message)})}>Process queued RFQ images</button>{rfqQueue.map(q=><div className="company-document-row" key={q.id}><strong>RFQ · {q.status}</strong><span>{q.last_error||q.message_id||'Queued for automatic delivery'}</span></div>)}{queue.map(q=><div className="company-document-row" key={q.id}><strong>{q.status}</strong><span>{q.last_error||q.message_id||'Queued for automatic delivery'}</span></div>)}<p className="muted tiny">Unknown gateway outcomes are held for review to prevent duplicate orders. Accepted means the gateway accepted the message.</p></details>
 </>}</details>
}
