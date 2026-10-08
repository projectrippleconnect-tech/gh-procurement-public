'use client'

import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {downloadCsv,money,qty} from '@/lib/helpers'
import {exportTablePdf} from '@/lib/pdf'
import {Badge,DataTable,Toggle,Empty} from './ui'
import {InfoButton} from './help-ui'

const REPORT_DEFS={
 reconciliation:{label:'Procurement Reconciliation',source:'proc_v_requirements',select:'*',order:'created_at',dateField:'created_at',dateTime:true,statusField:'status',categoryField:'category',columns:[['requirement_no','Requirement'],['category','Category'],['description','Item'],['size','Size'],['uom','UOM'],['movement','Movement'],['required_qty','Required'],['adjusted_qty','Adjusted'],['ordered_qty','Ordered'],['received_qty','Received'],['remaining_to_order','Still To Order'],['ordered_not_received','Ordered Not Received'],['status','Status'],['created_at','Created']]},
 po:{label:'Purchase Order Register',source:'proc_purchase_orders',select:'*,supplier:proc_suppliers(name,supplier_code)',order:'po_date',dateField:'po_date',statusField:'status',columns:[['po_no','PO No'],['supplier_name','Supplier'],['po_date','PO Date'],['expected_date','Expected'],['subtotal','Subtotal'],['tax_total','Tax'],['freight_total','Freight'],['total','Total'],['status','Status'],['created_at','Created']]},
 invoices:{label:'Supplier Invoice Register',source:'proc_supplier_invoices',select:'*,supplier:proc_suppliers(name,supplier_code),po:proc_purchase_orders(po_no)',order:'invoice_date',dateField:'invoice_date',statusField:'status',columns:[['invoice_no','Invoice'],['supplier_name','Supplier'],['po_no','PO No'],['invoice_date','Invoice Date'],['total','Total'],['status','Status'],['variance_resolution_status','Variance Resolution'],['created_at','Created']]},
 grn:{label:'Goods Receipt Register',source:'proc_grns',select:'*,supplier:proc_suppliers(name,supplier_code),po:proc_purchase_orders(po_no)',order:'received_date',dateField:'received_date',statusField:'status',columns:[['grn_no','GRN No'],['supplier_name','Supplier'],['po_no','PO No'],['received_date','Received Date'],['status','Status'],['created_at','Created']]},
 quotes:{label:'Supplier Price Comparison',source:'proc_v_quote_comparison',select:'*',order:'quote_date',dateField:'quote_date',columns:[['supplier_code','Supplier Code'],['supplier_name','Supplier'],['quote_ref','Quote Ref'],['quote_date','Quote Date'],['unit_price','Raw Unit Price'],['discount_percent','Discount %'],['tax_percent','Tax %'],['effective_unit_price','Effective Unit'],['freight_total','Freight Total'],['freight_unit_cost','Freight / Unit'],['landed_unit_cost','Landed Unit'],['minimum_order_value','Min Order Value'],['moq','MOQ'],['order_multiple','Order Multiple'],['available_qty','Available Qty'],['lead_days','Lead Days'],['landed_rank','Landed Rank']]},
 stock_counts:{label:'Stock Count History',source:'proc_stock_counts',select:'*',order:'count_date',dateField:'count_date',statusField:'status',columns:[['count_no','Count No'],['count_date','Count Date'],['category','Category'],['status','Status'],['submitted_at','Submitted'],['notes','Notes']]},
 stock_due:{label:'Stock Check Due',source:'proc_v_stock_check_due',select:'*',order:'next_check_date',orderAscending:true,dateField:'next_check_date',categoryField:'category',columns:[['item_code','Code'],['category','Category'],['description','Item'],['size','Size'],['uom','UOM'],['movement','Movement'],['book_stock','Book Stock'],['last_counted_at','Last Counted'],['check_every_days','Check Every Days'],['next_check_date','Next Check'],['is_due','Due'],['days_overdue','Days Overdue']]},
 urgent_actions:{label:'Urgent Procurement Actions',source:'proc_v_urgent_actions',select:'*',order:'created_at',dateField:'created_at',dateTime:true,statusField:'status',categoryField:'category',columns:[['effective_priority','Priority'],['priority_score','Score'],['reference_no','Reference'],['action_type','Type'],['urgency_reason','Reason'],['description','Item'],['brand','Brand'],['size','Size'],['uom','UOM'],['movement','Movement'],['required_qty','Required Qty'],['book_stock','Book Stock'],['customer_paid','Customer Paid'],['customer_reference','Customer Ref'],['status','Status'],['created_at','Created']]},
 invoice_variances:{label:'Invoice Variances',source:'proc_v_invoice_variances',select:'*',order:'invoice_date',dateField:'invoice_date',statusField:'variance_resolution_status',columns:[['invoice_no','Invoice'],['invoice_date','Invoice Date'],['supplier_name','Supplier'],['variance_resolution_status','Resolution'],['variance_resolution_action','Last Action'],['variance_credit_note_no','Credit Note'],['item_code','Code'],['description','Item'],['size','Size'],['uom','UOM'],['po_qty','PO Qty'],['invoice_qty','Invoice Qty'],['qty_variance','Qty Variance'],['po_unit_price','PO Unit Price'],['invoice_unit_price','Invoice Unit Price'],['price_variance','Price Variance'],['po_discount_percent','PO Discount %'],['invoice_discount_percent','Invoice Discount %'],['discount_variance','Discount Var'],['po_tax_percent','PO Tax %'],['invoice_tax_percent','Invoice Tax %'],['tax_variance','Tax Var'],['po_effective_unit_cost','PO Effective Unit'],['invoice_effective_unit_cost','Invoice Effective Unit'],['effective_unit_cost_variance','Effective Unit Var']]},
 receipt_reconciliation:{label:'Receiving Reconciliation',source:'proc_v_receipt_reconciliation',select:'*',order:'po_date',dateField:'po_date',statusField:'po_status',categoryField:'category',columns:[['po_no','PO No'],['po_date','PO Date'],['supplier_name','Supplier'],['item_code','Code'],['description','Item'],['size','Size'],['uom','UOM'],['ordered_qty','Ordered'],['total_received_qty','Received'],['total_accepted_qty','Accepted'],['total_rejected_qty','Rejected'],['remaining_to_receive','Remaining'],['over_received_qty','Over Received'],['po_status','PO Status']]},
 rejection_cases:{label:'Rejected Goods Follow-up',source:'proc_v_rejection_cases',select:'*',order:'created_at',dateField:'created_at',dateTime:true,statusField:'status',columns:[['grn_no','GRN'],['po_no','PO'],['supplier_name','Supplier'],['item_code','Code'],['description','Item'],['size','Size'],['uom','UOM'],['rejected_qty','Rejected Qty'],['rejection_reason','Reason'],['status','Status'],['resolution_type','Resolution'],['reference_no','Reference'],['due_date','Due'],['created_at','Created'],['resolved_at','Resolved']]},
 three_way:{label:'PO · Invoice · Receiving Match',source:'proc_v_three_way_match',select:'*',order:'po_date',dateField:'po_date',statusField:'status',columns:[['po_no','PO No'],['po_date','PO Date'],['supplier_name','Supplier'],['item_code','Code'],['description','Item'],['size','Size'],['uom','UOM'],['ordered_qty','Ordered Qty'],['invoiced_qty','Invoiced Qty'],['received_qty','Accepted Qty'],['rejected_qty','Rejected Qty'],['invoice_qty_variance','Invoice Qty Var'],['receipt_qty_variance','Receipt Qty Var'],['ordered_value','PO Value'],['invoiced_value','Invoice Value'],['invoice_value_variance','Value Var'],['status','3-Way Status']]},
 supplier_performance:{label:'Supplier Performance',rpc:'proc_supplier_performance_report_v1',order:'supplier_name',columns:[['supplier_code','Code'],['supplier_name','Supplier'],['quote_count','Quotes'],['awarded_line_count','Awarded Lines'],['awarded_qty','Awarded Qty'],['awarded_value','Awarded Value'],['po_count','POs'],['po_value','PO Value'],['avg_quoted_lead_days','Avg Lead Days'],['completed_fill_rate_pct','Fill Rate %'],['invoice_count','Invoices'],['invoice_variance_count','Invoice Variances']]}
}

const moneyKeys=new Set(['subtotal','tax_total','freight_total','minimum_order_value','total','unit_price','po_unit_price','invoice_unit_price','price_variance','awarded_value','po_value','effective_unit_price','freight_unit_cost','landed_unit_cost','ordered_value','invoiced_value','invoice_value_variance','po_effective_unit_cost','invoice_effective_unit_cost','effective_unit_cost_variance'])
const qtyKeys=new Set(['required_qty','adjusted_qty','ordered_qty','received_qty','remaining_to_order','ordered_not_received','available_qty','moq','order_multiple','po_qty','invoice_qty','qty_variance','book_stock','total_received_qty','total_accepted_qty','total_rejected_qty','remaining_to_receive','over_received_qty','awarded_qty','invoiced_qty','rejected_qty','invoice_qty_variance','receipt_qty_variance'])
const displayValue=(key,v)=>{
 if(v===null||v===undefined)return''
 if(moneyKeys.has(key))return money(v)
 if(qtyKeys.has(key))return qty(v)
 if(String(key).endsWith('_at'))return new Date(v).toLocaleString()
 return String(v).replaceAll('_',' ')
}
function flatten(type,r){
 if(type==='po')return {...r,supplier_name:r.supplier?.name||''}
 if(type==='invoices')return {...r,supplier_name:r.supplier?.name||'',po_no:r.po?.po_no||''}
 if(type==='grn')return {...r,supplier_name:r.supplier?.name||'',po_no:r.po?.po_no||''}
 return r
}

export function Reports({profile,company,footer,features=[],flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const[type,setType]=useState('reconciliation'),[rows,setRows]=useState([]),[columns,setColumns]=useState([]),[selected,setSelected]=useState([]),[status,setStatus]=useState(''),[category,setCategory]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[presets,setPresets]=useState([]),[presetName,setPresetName]=useState(''),[loading,setLoading]=useState(false),[screenPage,setScreenPage]=useState(0)
 const def=REPORT_DEFS[type]
 const reportCfg=features.find(x=>x.feature_key==='reports.full_export')?.config||{}
 const screenPageSize=Math.max(25,Math.min(Number(reportCfg.screen_page_size||100),500))
 const fetchPageSize=Math.max(100,Math.min(Number(reportCfg.fetch_page_size||1000),1000))

 useEffect(()=>{setColumns(def.columns.map(([key,label])=>({key,label})));setSelected(def.columns.map(x=>x[0]));setStatus('');setCategory('');setFrom('');setTo('');setScreenPage(0)},[type,def])
 const loadPresets=useCallback(async()=>{const r=await supabase.from('proc_report_presets').select('*').order('name');if(r.error)fail(r.error);else setPresets(r.data||[])},[fail])
 useEffect(()=>{loadPresets()},[loadPresets])

 const load=useCallback(async()=>{setLoading(true);try{
  if(def.rpc){
   const r=await supabase.rpc(def.rpc,{p_from:from||null,p_to:to||null})
   if(r.error)throw r.error
   setRows((r.data||[]).map(x=>flatten(type,x)));setScreenPage(0);return
  }
  const all=[]
  let offset=0
  while(true){
   let q=supabase.from(def.source).select(def.select).range(offset,offset+fetchPageSize-1)
   if(def.order)q=q.order(def.order,{ascending:def.orderAscending===true})
   if(status&&def.statusField)q=q.eq(def.statusField,status)
   if(category&&def.categoryField)q=q.eq(def.categoryField,category)
   if(from&&def.dateField)q=q.gte(def.dateField,from)
   if(to&&def.dateField)q=q.lte(def.dateField,def.dateTime?to+'T23:59:59.999':to)
   const r=await q
   if(r.error)throw r.error
   all.push(...(r.data||[]).map(x=>flatten(type,x)))
   if((r.data||[]).length<fetchPageSize)break
   offset+=fetchPageSize
   if(offset>=100000)throw new Error(t('validation.report_too_large','Report exceeds 100,000 rows. Narrow the date range before exporting.'))
  }
  setRows(all);setScreenPage(0)
 }catch(e){fail(e)}finally{setLoading(false)}},[def,type,status,category,from,to,fetchPageSize,fail])
 useEffect(()=>{load()},[load])

 const categories=useMemo(()=>[...new Set(rows.map(r=>r.category).filter(Boolean))].sort(),[rows])
 const visibleCols=columns.filter(c=>selected.includes(c.key))
 const tableCols=visibleCols.map(c=>({key:c.key,label:c.label,render:r=>(c.key==='status'||c.key.endsWith('_status'))?<Badge>{r[c.key]}</Badge>:displayValue(c.key,r[c.key])}))
 const exportRows=rows.map(r=>Object.fromEntries(visibleCols.map(c=>[c.label,displayValue(c.key,r[c.key])])))
 const screenRows=rows.slice(screenPage*screenPageSize,(screenPage+1)*screenPageSize)
 const screenPages=Math.max(1,Math.ceil(rows.length/screenPageSize))
 function exportPdf(){exportTablePdf({filename:'GH-'+def.label.replace(/\s+/g,'-')+'.pdf',title:def.label,subtitle:`${rows.length} record(s)`,columns:visibleCols.map(c=>({key:c.key,label:c.label,value:r=>displayValue(c.key,r[c.key])})),rows,company,footer,orientation:visibleCols.length>6?'landscape':'portrait'})}
 async function savePreset(){
  if(!presetName.trim())return fail(new Error(t('validation.preset_name','Enter a preset name.')))
  const r=await supabase.from('proc_report_presets').upsert({owner_id:profile.id,name:presetName.trim(),report_type:type,columns:selected,filters:{status,category,from,to}},{onConflict:'owner_id,name,report_type'})
  if(r.error)return fail(r.error);flash('Report preset saved.');setPresetName('');loadPresets()
 }
 function applyPreset(p){
  setType(p.report_type)
  setTimeout(()=>{setSelected(Array.isArray(p.columns)?p.columns:[]);setStatus(p.filters?.status||'');setCategory(p.filters?.category||'');setFrom(p.filters?.from||'');setTo(p.filters?.to||'')},0)
 }
 return <>
  <div className="card pad"><div className="sectionhead"><div><h3>{t('reports.builder','Report Builder')}</h3><p>{t('reports.builder_hint','Exports page through the complete filtered dataset; screen rendering is paged separately for performance.')}</p></div><div className="toolbar">{can('reports.export_csv')&&<button className="btn" onClick={()=>downloadCsv('GH-'+def.label+'.csv',exportRows)}>CSV</button>}{can('reports.export_pdf')&&<button className="btn primary" onClick={exportPdf}>PDF</button>}</div></div>
   <div className="report-controls">
    <div className="field"><label>{t('reports.report','Report')}</label><select className="select" value={type} onChange={e=>setType(e.target.value)}>{Object.entries(REPORT_DEFS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
    {def.statusField&&<div className="field"><label>{t('reports.status','Status')}</label><input className="input" placeholder="Optional exact status" value={status} onChange={e=>setStatus(e.target.value)}/></div>}
    {def.categoryField&&<div className="field"><label>{t('reports.category','Category')}</label><select className="select" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></div>}
    <div className="field"><label>{t('reports.from','From')}</label><input className="input" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
    <div className="field"><label>{t('reports.to','To')}</label><input className="input" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
   </div>
   <div className="section"><div className="field-title">{t('reports.columns','Columns')}</div><div className="column-picker">{columns.map(c=><label className={'choice-pill '+(selected.includes(c.key)?'selected-choice':'')} key={c.key}><input type="checkbox" checked={selected.includes(c.key)} onChange={e=>setSelected(v=>e.target.checked?[...v,c.key]:v.filter(x=>x!==c.key))}/>{c.label}</label>)}</div></div>
   <div className="preset-bar section"><input className="input" placeholder={t('reports.preset_name','Preset name')} value={presetName} onChange={e=>setPresetName(e.target.value)}/><button className="btn" onClick={savePreset}>{t('reports.save_layout','Save Layout')}</button><select className="select" defaultValue="" onChange={e=>{const p=presets.find(x=>x.id===e.target.value);if(p)applyPreset(p)}}><option value="">{t('reports.load_layout','Load saved layout…')}</option>{presets.map(p=><option key={p.id} value={p.id}>{p.name} · {REPORT_DEFS[p.report_type]?.label||p.report_type}</option>)}</select></div>
  </div>
  <div className="card pad section"><div className="sectionhead"><div><h3>{def.label}</h3><p>{rows.length} filtered record(s) · showing {screenRows.length} on this screen page</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>{loading?<Empty>{t('reports.loading','Loading complete report…')}</Empty>:<><DataTable columns={tableCols} rows={screenRows} mobileCards/><div className="toolbar section"><button className="btn" disabled={screenPage<=0} onClick={()=>setScreenPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{t('common.page','Page')} {screenPage+1} {t('common.of','of')} {screenPages}</span><button className="btn" disabled={screenPage>=screenPages-1} onClick={()=>setScreenPage(x=>x+1)}>{t('common.next','Next')}</button></div></>}</div>
 </>
}


function RoleManager({language='en',t=(k,f)=>f||k,flash,fail,onChanged}){
 const[roles,setRoles]=useState([]),[permissions,setPermissions]=useState([]),[links,setLinks]=useState([]),[selected,setSelected]=useState('admin'),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false)
 const load=useCallback(async()=>{try{
  const[a,b,c]=await Promise.all([
   supabase.from('proc_roles').select('*').order('protected',{ascending:false}).order('name'),
   supabase.from('proc_permissions').select('*').order('sort_order'),
   supabase.from('proc_role_permissions').select('*').eq('allowed',true)
  ])
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error
  setRoles(a.data||[]);setPermissions(b.data||[]);setLinks(c.data||[])
  if((a.data||[]).length&&!a.data.some(x=>x.role_key===selected))setSelected(a.data[0].role_key)
 }catch(e){fail(e)}},[fail,selected])
 useEffect(()=>{load()},[load])
 const role=roles.find(x=>x.role_key===selected)||null
 useEffect(()=>{if(!role)return;setDraft({name:role.name,description:role.description||'',enabled:role.enabled,permissions:new Set(links.filter(x=>x.role_key===role.role_key).map(x=>x.permission_key))})},[role,links])
 const groups=useMemo(()=>Object.entries(permissions.reduce((a,p)=>{(a[p.module_key]??=[]).push(p);return a},{})),[permissions])
 async function save(){
  if(!role||!draft)return
  setBusy(true);try{
   const r=await supabase.rpc('proc_admin_update_role_v1',{p_role_key:role.role_key,p_name:draft.name,p_description:draft.description,p_enabled:draft.enabled,p_permissions:[...draft.permissions]})
   if(r.error)throw r.error
   flash(t('admin.role_saved','Role and permissions saved.'));await load();onChanged?.()
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 async function createRole(){
  const name=window.prompt(t('admin.new_role_name','New role name'))
  if(!name?.trim())return
  const template=selected||'viewer'
  try{const r=await supabase.rpc('proc_admin_create_role_v1',{p_name:name.trim(),p_clone_from:template,p_description:null});if(r.error)throw r.error;flash(t('admin.role_created','Role created.'));await load();if(r.data?.role_key)setSelected(r.data.role_key);onChanged?.()}catch(e){fail(e)}
 }
 async function duplicate(){
  if(!role)return
  const name=window.prompt(t('admin.duplicate_role_name','Name for duplicated role'),role.name+' Copy')
  if(!name?.trim())return
  try{const r=await supabase.rpc('proc_admin_duplicate_role_v1',{p_role_key:role.role_key,p_name:name.trim()});if(r.error)throw r.error;flash(t('admin.role_duplicated','Role duplicated.'));await load();if(r.data?.role_key)setSelected(r.data.role_key);onChanged?.()}catch(e){fail(e)}
 }
 async function remove(){
  if(!role||role.protected)return
  if(!confirm(t('admin.delete_role_confirm','Delete this role? It can only be deleted when no users are assigned to it.')))return
  try{const r=await supabase.rpc('proc_admin_delete_role_v1',{p_role_key:role.role_key});if(r.error)throw r.error;flash(t('admin.role_deleted','Role deleted.'));setSelected('admin');await load();onChanged?.()}catch(e){fail(e)}
 }
 return <div className="card pad section">
  <div className="sectionhead"><div><h3>{t('admin.roles_title','Roles & Permissions')} <InfoButton topic="roles_permissions" language={language}/></h3><p>{t('admin.roles_subtitle','Create roles and control exactly what each role can do.')}</p></div><div className="role-actions"><button className="btn" onClick={createRole}>{t('admin.create_role','Create Role')}</button><button className="btn" disabled={!role} onClick={duplicate}>{t('admin.duplicate','Duplicate')}</button></div></div>
  <div className="role-editor-grid">
   <div className="role-list">{roles.map(r=><button type="button" className={selected===r.role_key?'active':''} key={r.role_key} onClick={()=>setSelected(r.role_key)}><span><b>{r.name}</b><small>{r.enabled?t('common.enabled','Enabled'):t('common.disabled','Disabled')}</small></span>{r.protected&&<Badge>protected</Badge>}</button>)}</div>
   {role&&draft&&<div>
    <div className="role-editor-fields">
     <div className="field"><label>{t('admin.role_name','Role name')}</label><input className="input" value={draft.name} onChange={e=>setDraft(x=>({...x,name:e.target.value}))}/></div>
     <div className="field"><label>{t('admin.role_enabled','Role enabled')}</label><Toggle label={draft.enabled?t('common.enabled','Enabled'):t('common.disabled','Disabled')} checked={draft.enabled} disabled={role.protected} onChange={v=>setDraft(x=>({...x,enabled:v}))}/></div>
     <div className="field wide"><label>{t('admin.role_description','Description')}</label><input className="input" value={draft.description} onChange={e=>setDraft(x=>({...x,description:e.target.value}))}/></div>
    </div>
    <div className="permission-groups section">{groups.map(([module,rows])=><div className="permission-group" key={module}><h4>{module.replaceAll('_',' ')}</h4>{rows.map(p=><label className="permission-row" key={p.permission_key}><span><b>{p.label}</b><small>{p.description}</small></span><input type="checkbox" checked={draft.permissions.has(p.permission_key)} disabled={role.protected&&['admin.roles.manage','admin.users.manage'].includes(p.permission_key)} onChange={e=>setDraft(x=>{const n=new Set(x.permissions);e.target.checked?n.add(p.permission_key):n.delete(p.permission_key);return {...x,permissions:n}})}/></label>)}</div>)}</div>
    <div className="role-actions section"><button className="btn primary" disabled={busy} onClick={save}>{busy?t('common.saving','Saving…'):t('common.save','Save')}</button><button className="btn bad" disabled={role.protected} onClick={remove}>{t('admin.delete','Delete')}</button></div>
   </div>}
  </div>
 </div>
}

export function Admin({profile,modules,fields,features=[],settings,onConfigChanged,flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const[users,setUsers]=useState([]),[invites,setInvites]=useState([]),[directory,setDirectory]=useState([]),[audit,setAudit]=useState([]),[roles,setRoles]=useState([]),[selectedModule,setSelectedModule]=useState('stock'),[company,setCompany]=useState(settings.company_profile||{}),[idle,setIdle]=useState(Number(settings.security_idle_minutes||60)),[busy,setBusy]=useState(false)
 const[invite,setInvite]=useState({display_name:'',email:'',role:'viewer'}),[inviteBusy,setInviteBusy]=useState(false)
 const hasAdmin=can('admin.users.manage')||can('admin.roles.manage')||can('admin.configure_app')||can('admin.audit.view')
 const load=useCallback(async()=>{if(!hasAdmin)return;try{
  const[a,b,d,e,r]=await Promise.all([supabase.from('proc_profiles').select('*').order('display_name'),supabase.from('proc_audit_logs').select('*').order('created_at',{ascending:false}).limit(100),supabase.from('proc_user_invites').select('*').order('invited_at',{ascending:false}).limit(100),supabase.from('proc_user_directory').select('*'),supabase.from('proc_roles').select('*').order('name')])
  if(a.error)throw a.error;if(b.error)throw b.error;if(d.error)throw d.error;if(e.error)throw e.error;if(r.error)throw r.error;setUsers(a.data||[]);setAudit(b.data||[]);setInvites(d.data||[]);setDirectory(e.data||[]);setRoles(r.data||[])
 }catch(e){fail(e)}},[hasAdmin,fail])
 useEffect(()=>{load()},[load])
 useEffect(()=>{setCompany(settings.company_profile||{});setIdle(Number(settings.security_idle_minutes||60))},[settings])
 if(!hasAdmin)return <Empty>{t('admin.admin_required','Administrator access required.')}</Empty>

 async function role(id,v){const r=await supabase.rpc('proc_admin_assign_role_v1',{p_user_id:id,p_role_key:v});if(r.error)fail(r.error);else{flash(t('admin.role_updated','Role updated.'));load()}}
 async function removeUserRole(u){
  if(u.id===profile.id)return fail(new Error(t('validation.self_admin_role','You cannot remove your own Super Admin role.')))
  if((u.role_key||u.role)==='viewer')return
  if(!confirm(t('admin.remove_role_confirm','Set this user to Viewer and remove their current role?')))return
  await role(u.id,'viewer')
 }
 async function active(u,v){if(u.id===profile.id&&!v)return fail(new Error(t('validation.self_deactivate','You cannot deactivate your own account.')));const r=await supabase.from('proc_profiles').update({active:v}).eq('id',u.id);if(r.error)fail(r.error);else{flash(t('admin.user_access_updated','User access updated.'));load()}}
 async function inviteUser(){
  if(!invite.display_name.trim())return fail(new Error(t('admin.enter_user_name','Enter the user name.')))
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invite.email.trim()))return fail(new Error(t('admin.enter_valid_email','Enter a valid email address.')))
  setInviteBusy(true)
  try{
   const r=await supabase.functions.invoke('proc-invite-user',{body:{display_name:invite.display_name.trim(),email:invite.email.trim(),role_key:invite.role}})
   if(r.error)throw r.error
   if(r.data?.error)throw new Error(r.data.error)
   flash(r.data?.message||t('admin.invitation_processed','User invitation processed.'))
   setInvite({display_name:'',email:'',role:'viewer'})
   await load()
  }catch(e){fail(e)}finally{setInviteBusy(false)}
 }
 async function revokeInvite(row){
  if(row.status!=='pending')return
  if(!confirm(t('confirm.revoke_invite','Revoke this invitation and disable GH Procurement access for this invited account?')))return
  const r=await supabase.from('proc_user_invites').update({status:'revoked',updated_at:new Date().toISOString()}).eq('id',row.id)
  if(r.error)return fail(r.error)
  if(row.invited_user_id){
   const p=await supabase.from('proc_profiles').update({active:false,updated_at:new Date().toISOString()}).eq('id',row.invited_user_id)
   if(p.error)return fail(p.error)
  }
  flash('Invitation revoked and procurement access disabled.');load()
 }
 function emailFor(u){return directory.find(x=>x.user_id===u.id)?.email||invites.find(x=>x.invited_user_id===u.id)?.email||''}
 async function sendReset(u){
  const email=emailFor(u)
  if(!email)return fail(new Error(t('validation.no_email','No email is stored for this user yet.')))
  const redirectTo=typeof window!=='undefined'?window.location.origin+'/?recovery=1':undefined
  const r=await supabase.auth.resetPasswordForEmail(email,{redirectTo})
  if(r.error)return fail(r.error)
  flash('Password reset email sent to '+email+'.')
 }
 async function moduleToggle(m,v){if(m.module_key==='admin'&&!v)return fail(new Error(t('validation.admin_module','Admin cannot be disabled; otherwise there would be no way to restore configuration.')));const r=await supabase.from('proc_module_settings').update({enabled:v,updated_at:new Date().toISOString()}).eq('module_key',m.module_key);if(r.error)fail(r.error);else{flash('Tab visibility updated.');onConfigChanged()}}
 async function moduleSave(m,patch){const r=await supabase.from('proc_module_settings').update({...patch,updated_at:new Date().toISOString()}).eq('module_key',m.module_key);if(r.error)fail(r.error);else{flash('Module settings updated.');onConfigChanged()}}
 async function moduleRole(m,role,enabled){const current=new Set(m.allowed_roles||[]);enabled?current.add(role):current.delete(role);if(m.module_key==='admin'&&role==='admin'&&!enabled)return fail(new Error(t('validation.admin_role_access','Admin access to Admin Settings cannot be removed.')));await moduleSave(m,{allowed_roles:[...current]})}
 async function fieldToggle(f,v){if(f.required_core&&!v)return fail(new Error(t('validation.protected_field','This is a protected workflow field and cannot be disabled.')));const r=await supabase.from('proc_field_settings').update({enabled:v}).eq('module_key',f.module_key).eq('field_key',f.field_key);if(r.error)fail(r.error);else onConfigChanged()}
 async function fieldLabelSave(f,label){if(!label.trim())return;const r=await supabase.from('proc_field_settings').update({label:label.trim()}).eq('module_key',f.module_key).eq('field_key',f.field_key);if(r.error)fail(r.error);else{flash('Field label updated.');onConfigChanged()}}
 async function fieldOrderSave(f,value){const n=Number(value);if(!Number.isFinite(n))return;const r=await supabase.from('proc_field_settings').update({sort_order:n}).eq('module_key',f.module_key).eq('field_key',f.field_key);if(r.error)fail(r.error);else onConfigChanged()}
 async function featureSave(f,patch){const r=await supabase.from('proc_feature_settings').update({...patch,updated_at:new Date().toISOString()}).eq('feature_key',f.feature_key);if(r.error)fail(r.error);else{flash('Feature settings updated.');onConfigChanged()}}
 async function featureConfig(f,key,value){const n=Number(value);if(!Number.isFinite(n)||n<0)return fail(new Error(t('validation.valid_number','Enter a valid number.')));await featureSave(f,{config:{...(f.config||{}),[key]:n}})}
 async function featureFlag(f,key,value){await featureSave(f,{config:{...(f.config||{}),[key]:!!value}})}
 async function saveSettings(){
  if(!Number.isFinite(idle)||idle<10||idle>720)return fail(new Error(t('validation.idle_timeout','Idle timeout must be between 10 and 720 minutes.')))
  setBusy(true)
  try{
   const r=await supabase.from('proc_settings').upsert([
    {key:'security_idle_minutes',value:idle,description:'Automatic sign-out after inactivity'},
    {key:'company_profile',value:company,description:'Details printed on procurement PDFs'}
   ])
   if(r.error)throw r.error;flash('Company and security settings saved.');onConfigChanged()
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 const selectedFields=fields.filter(f=>f.module_key===selectedModule).sort((a,b)=>a.sort_order-b.sort_order)
 const stockEntryFields=fields.filter(f=>f.module_key==='stock_entry').sort((a,b)=>a.sort_order-b.sort_order)
 const stockMobileFeature=features.find(f=>f.feature_key==='stock.mobile_entry')
 return <>
  {can('admin.roles.manage')&&<RoleManager language={language} t={t} flash={flash} fail={fail} onChanged={load}/>} 
  {can('admin.configure_app')&&<div className="admin-grid">
   <div className="card pad"><div className="sectionhead"><div><h3>{t('admin.tabs_modules','Tabs / Modules')}</h3><p>{t('admin.tabs_modules_hint','Rename, reorder, enable/disable tabs and control which roles can see them.')}</p></div></div><div className="stack">{modules.map(m=><div className="module-setting" key={m.module_key}>
    <Toggle label={m.module_key} checked={m.enabled} disabled={m.module_key==='admin'} onChange={v=>moduleToggle(m,v)}/>
    <div className="formgrid"><div className="field"><label>Tab label</label><input className="input" defaultValue={m.label} onBlur={e=>e.target.value.trim()&&moduleSave(m,{label:e.target.value.trim()})}/></div><div className="field"><label>Order</label><input className="input" type="number" defaultValue={m.sort_order} onBlur={e=>moduleSave(m,{sort_order:Number(e.target.value)||m.sort_order})}/></div></div>
   </div>)}</div></div>
   <div className="card pad"><div className="sectionhead"><div><h3>{t('admin.fields','Fields')}</h3><p>{t('admin.fields_hint','Hide fields or rename their labels without changing the database.')}</p></div></div><select className="select" value={selectedModule} onChange={e=>setSelectedModule(e.target.value)}>{modules.filter(m=>fields.some(f=>f.module_key===m.module_key)).map(m=><option value={m.module_key} key={m.module_key}>{m.label}</option>)}</select><div className="stack section">{selectedFields.map(f=><div className="field-setting" key={f.field_key}><Toggle label={f.required_core?f.field_key+' · required':f.field_key} checked={f.enabled} disabled={f.required_core} onChange={v=>fieldToggle(f,v)}/><input className="input" defaultValue={f.label} onBlur={e=>fieldLabelSave(f,e.target.value)}/><input className="input field-order-input" type="number" defaultValue={f.sort_order} title="Display order" onBlur={e=>fieldOrderSave(f,e.target.value)}/></div>)}</div></div>
   <div className="card pad"><div className="sectionhead"><div><h3>{t('admin.features_dashboard','Features & Dashboard')}</h3><p>{t('admin.features_dashboard_hint','Enable/disable features across the app, including individual dashboard cards and cycle-count rules.')}</p></div></div><div className="stack">{features.map(f=><div className="field-setting" key={f.feature_key}><Toggle label={f.label} checked={f.enabled} onChange={v=>featureSave(f,{enabled:v})}/>{f.feature_key==='stock.cycle_counting'&&<div className="formgrid section"><div className="field"><label>FAST days</label><input className="input" type="number" min="1" defaultValue={f.config?.fast_days??7} onBlur={e=>featureConfig(f,'fast_days',e.target.value)}/></div><div className="field"><label>NORMAL days</label><input className="input" type="number" min="1" defaultValue={f.config?.normal_days??14} onBlur={e=>featureConfig(f,'normal_days',e.target.value)}/></div><div className="field"><label>SLOW days</label><input className="input" type="number" min="1" defaultValue={f.config?.slow_days??28} onBlur={e=>featureConfig(f,'slow_days',e.target.value)}/></div><div className="field"><label>Daily batch target</label><input className="input" type="number" min="10" defaultValue={f.config?.daily_target??75} onBlur={e=>featureConfig(f,'daily_target',e.target.value)}/></div></div>}{f.feature_key==='quotes.minimum_quotes'&&<div className="formgrid section"><div className="field"><label>Minimum quotes</label><input className="input" type="number" min="1" max="10" defaultValue={f.config?.minimum_quotes??2} onBlur={e=>featureConfig(f,'minimum_quotes',e.target.value)}/></div><div className="field"><label>Reminder after hours</label><input className="input" type="number" min="1" defaultValue={f.config?.reminder_hours??24} onBlur={e=>featureConfig(f,'reminder_hours',e.target.value)}/></div></div>}{f.feature_key==='procurement.straight_through'&&<div className="section"><div className="notice"><b>Normal path becomes automatic.</b><p className="muted tiny">Physical stock count → shortage → supplier pricing → safe lowest-landed-cost award → PO. Manual review remains for exceptions.</p></div><div className="formgrid section"><div className="field"><label>Suppliers per automatic RFQ</label><input className="input" type="number" min="1" max="10" defaultValue={f.config?.supplier_limit??3} onBlur={e=>featureConfig(f,'supplier_limit',e.target.value)}/></div><div className="field"><label>RFQ due in days</label><input className="input" type="number" min="0" max="30" defaultValue={f.config?.rfq_due_days??2} onBlur={e=>featureConfig(f,'rfq_due_days',e.target.value)}/></div><div className="field"><label>Auto-approve each PO up to LKR</label><input className="input" type="number" min="0" step="1000" defaultValue={f.config?.po_auto_approval_limit??100000} onBlur={e=>featureConfig(f,'po_auto_approval_limit',e.target.value)}/></div><div className="field"><label>Daily automatic approval cap LKR</label><input className="input" type="number" min="0" step="1000" defaultValue={f.config?.daily_auto_approval_limit??f.config?.po_auto_approval_limit??100000} onBlur={e=>featureConfig(f,'daily_auto_approval_limit',e.target.value)}/><small className="muted">0 = no daily cap. Only Admin-triggered awards can auto-approve.</small></div><div className="field"><label>Supplier history needed (POs)</label><input className="input" type="number" min="1" max="50" defaultValue={f.config?.supplier_history_min_pos??3} onBlur={e=>featureConfig(f,'supplier_history_min_pos',e.target.value)}/></div><div className="field"><label>Minimum supplier fill rate %</label><input className="input" type="number" min="0" max="100" defaultValue={f.config?.supplier_min_fill_rate_pct??90} onBlur={e=>featureConfig(f,'supplier_min_fill_rate_pct',e.target.value)}/></div><div className="field"><label>Maximum invoice variance %</label><input className="input" type="number" min="0" max="100" defaultValue={f.config?.supplier_max_invoice_variance_pct??25} onBlur={e=>featureConfig(f,'supplier_max_invoice_variance_pct',e.target.value)}/></div><div className="field"><label>Urgent auto-award max lead days</label><input className="input" type="number" min="0" max="90" defaultValue={f.config?.urgent_max_lead_days??7} onBlur={e=>featureConfig(f,'urgent_max_lead_days',e.target.value)}/></div><div className="field"><label>Remind if approved PO unsent after hours</label><input className="input" type="number" min="1" max="168" defaultValue={f.config?.po_send_reminder_hours??4} onBlur={e=>featureConfig(f,'po_send_reminder_hours',e.target.value)}/></div></div><div className="notice section"><b>Automatic supplier safety</b><p className="muted tiny">Routine awards stop for review when the cheapest supplier has poor historical fill rate, excessive invoice variances, or an unsafe lead time for an urgent requirement.</p></div><div className="stock-row-settings section"><Toggle label="Automatically finalize safe landed-cost winners" checked={f.config?.auto_award!==false} onChange={v=>featureFlag(f,'auto_award',v)}/><Toggle label="Automatically approve routine POs within the limit" checked={f.config?.auto_approve_po!==false} onChange={v=>featureFlag(f,'auto_approve_po',v)}/></div></div>}</div>)}</div></div>
   <div className="card pad"><div className="sectionhead"><div><h3>{t('admin.company_security','Company & Security')}</h3><p>{t('admin.company_security_hint','PDF identity and automatic session timeout.')}</p></div></div><div className="formgrid">{[['name','Company name'],['town','Town'],['country','Country'],['phone','Phone'],['email','Email']].map(([k,l])=><div className="field" key={k}><label>{l}</label><input className="input" value={company[k]||''} onChange={e=>setCompany(x=>({...x,[k]:e.target.value}))}/></div>)}<div className="field"><label>Auto sign-out after inactivity (minutes)</label><input className="input" type="number" min="10" max="720" value={idle} onChange={e=>setIdle(Number(e.target.value))}/></div></div><button className="btn primary section" disabled={busy} onClick={saveSettings}>{busy?t('common.saving','Saving…'):t('admin.save_settings','Save Settings')}</button></div>
   <div className="card pad"><div className="sectionhead"><div><h3>{t('admin.security_controls','Security controls')}</h3><p>{t('admin.security_controls_hint','Built into this version.')}</p></div></div><div className="security-list"><div><b>Public registration</b><Badge>disabled</Badge></div><div><b>Anonymous procurement access</b><Badge>blocked</Badge></div><div><b>PO approval</b><span>Straight-through within configured limit; exceptions require review</span></div><div><b>Transactional records</b><span>Cancellation instead of deletion</span></div><div><b>Audit trail</b><span>System generated</span></div><div><b>Password recovery</b><span>Enabled</span></div></div></div>
  </div>}
  {can('admin.configure_app')&&<div className="card pad section"><div className="sectionhead"><div><h3>{t('admin.stock_row_title','Stock Entry · Row Display')} <InfoButton topic="stock_entry" language={language}/></h3><p>{t('admin.stock_row_subtitle','Choose optional information shown in each fast stock-entry row.')}</p></div></div><div className="stock-row-settings">{stockEntryFields.map(f=><Toggle key={f.field_key} label={(f.label||f.field_key)+(f.required_core?' · '+t('admin.mandatory','Mandatory'):'')} checked={f.enabled} disabled={f.required_core} onChange={v=>fieldToggle(f,v)}/>)}</div>{stockMobileFeature&&<div className="field section"><label>{t('admin.default_rows','Default rows per page')}</label><select className="select compact-select" value={Number(stockMobileFeature.config?.default_page_size||20)} onChange={e=>featureSave(stockMobileFeature,{config:{...(stockMobileFeature.config||{}),default_page_size:Number(e.target.value)}})}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></div>}</div>}
  {can('admin.users.manage')&&<><div className="card pad section">
   <div className="sectionhead"><div><h3>{t('admin.invite_user','Invite User')}</h3><p>{t('admin.invite_hint','Create/enable a GH account, assign the procurement role before first sign-in, and send the password-setup invitation.')}</p></div><button className="btn primary" disabled={inviteBusy} onClick={inviteUser}>{inviteBusy?t('admin.sending','Sending…'):t('admin.send_invitation','Send Invitation')}</button></div>
   <div className="formgrid">
    <div className="field"><label>{t('common.name','Name')}</label><input className="input" value={invite.display_name} onChange={e=>setInvite(x=>({...x,display_name:e.target.value}))} placeholder="Staff name"/></div>
    <div className="field"><label>{t('common.email','Email')}</label><input className="input" type="email" value={invite.email} onChange={e=>setInvite(x=>({...x,email:e.target.value}))} placeholder="user@example.com"/></div>
    <div className="field"><label>{t('common.role','Role')}</label><select className="select" value={invite.role} onChange={e=>setInvite(x=>({...x,role:e.target.value}))}>{roles.filter(r=>r.enabled).map(r=><option key={r.role_key} value={r.role_key}>{r.name}</option>)}</select></div>
   </div>
   {invites.some(x=>x.status==='pending')&&<div className="section"><h4>{t('admin.pending_invites','Pending Invitations')}</h4><DataTable columns={[
    {key:'display_name',label:'Name'},{key:'email',label:'Email'},{key:'role',label:'Role',render:r=><Badge>{r.role}</Badge>},{key:'invited_at',label:'Invited',render:r=>new Date(r.invited_at).toLocaleString()},{key:'status',label:'Status',render:r=><Badge>{r.status}</Badge>},{key:'action',label:'',render:r=><button className="btn small bad" onClick={()=>revokeInvite(r)}>Revoke</button>}
   ]} rows={invites.filter(x=>x.status==='pending')} mobileCards/></div>}
  </div>
  <div className="card pad section"><div className="sectionhead"><div><h3>{t('admin.users','Users')}</h3><p>{t('admin.users_hint','Role-based procurement access. Change roles, disable access instantly, or send a password-reset link.')}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div><DataTable columns={[
   {key:'display_name',label:t('common.user','User')},{key:'email',label:t('common.email','Email'),render:u=>emailFor(u)||'—'},{key:'role',label:t('common.role','Role'),render:u=><div className="toolbar role-user-actions"><select className="select compact-select" value={u.role_key||u.role} disabled={u.id===profile.id&&(u.role_key||u.role)==='admin'} onChange={e=>role(u.id,e.target.value)}>{roles.filter(r=>r.enabled||(u.role_key||u.role)===r.role_key).map(r=><option key={r.role_key} value={r.role_key}>{r.name}</option>)}</select>{u.id!==profile.id&&(u.role_key||u.role)!=='viewer'&&<button type="button" className="btn small" onClick={()=>removeUserRole(u)}>{t('admin.set_viewer','Remove role / set Viewer')}</button>}</div>},
   {key:'active',label:t('common.access','Access'),render:u=><Toggle checked={u.active} disabled={u.id===profile.id} label={u.active?'Active':'Disabled'} onChange={v=>active(u,v)}/>},
   {key:'security',label:t('common.security','Security'),render:u=><button className="btn small" disabled={!emailFor(u)} onClick={()=>sendReset(u)}>{t('admin.send_reset','Send Reset Link')}</button>}
  ]} rows={users} mobileCards/></div>
  </>}
  {can('admin.audit.view')&&<div className="card pad section"><div className="sectionhead"><div><h3>{t('admin.audit','Audit Trail')}</h3><p>{t('admin.audit_hint','Last 100 server-generated changes.')}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div><DataTable columns={[
   {key:'created_at',label:'Time',render:r=>new Date(r.created_at).toLocaleString()},{key:'table_name',label:'Area'},{key:'action',label:'Action'},{key:'user_id',label:'User ID',render:r=><span className="mono tiny">{r.user_id||'system'}</span>}
  ]} rows={audit} mobileCards/></div>}
 </>
}
