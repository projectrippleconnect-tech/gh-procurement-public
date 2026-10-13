// Isolated rendering tests: fake browser session and intercepted Supabase responses.
// Never signs in to production or changes production records.
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {jsPDF} from 'jspdf'
// The default smoke flow follows the current focused UI. Specialized modes retain their own checks.
if(!Object.keys(process.env).some(k=>k.startsWith('GH_UI_')&&!['GH_UI_BROWSER_CHANNEL','GH_UI_BROWSER_EXECUTABLE'].includes(k)))process.env.GH_UI_FOCUSED='1'
const root='http://127.0.0.1:3100'
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3100'],{stdio:'inherit'})
let browser
async function setRange(locator,value){
 await locator.focus();await locator.press('Home')
 const min=Number(await locator.getAttribute('min'))
 for(let n=min;n<value;n++)await locator.press('ArrowRight')
}
try{
 for(let attempt=0;attempt<100;attempt++){
  try{if((await fetch(root)).ok)break}catch{}
  if(attempt===99)throw new Error('Test server unavailable')
  await new Promise(r=>setTimeout(r,100))
 }
 await mkdir('test-results',{recursive:true})
 const htmlResponses=[]
 for(let i=0;i<2;i++){
  const response=await fetch(root,{headers:{'x-nonce':'untrusted-client-nonce','Content-Security-Policy':"script-src 'unsafe-inline'"}})
  assert.equal(response.status,200)
  const policy=response.headers.get('content-security-policy')||''
  const nonce=policy.match(/'nonce-([^']+)'/)?.[1]
  assert.ok(nonce&&nonce!=='untrusted-client-nonce','HTML response must use a server-generated nonce')
  assert.doesNotMatch(policy.split(';').find(x=>x.trim().startsWith('script-src ')),/'unsafe-inline'|'unsafe-eval'/)
  assert.match(response.headers.get('cache-control')||'',/no-store/)
  const html=await response.text()
  const scripts=[...html.matchAll(/<script\b([^>]*)>/g)]
  assert.ok(scripts.length>0)
  for(const [,attributes] of scripts)assert.ok(attributes.includes('nonce="'+nonce+'"'),'Framework script must match the response nonce')
  htmlResponses.push(nonce)
 }
 assert.notEqual(htmlResponses[0],htmlResponses[1],'Nonce must change between HTML requests')
 console.log('PASS request-specific CSP nonce, script authorization and client-header override protection')
 browser=await chromium.launch({headless:true,...(process.env.GH_UI_BROWSER_CHANNEL?{channel:process.env.GH_UI_BROWSER_CHANNEL}:{}),...(process.env.GH_UI_BROWSER_EXECUTABLE?{executablePath:process.env.GH_UI_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}: {})})
 const id='00000000-0000-4000-8000-000000000002'
 const user={id,email:'fixture@example.invalid',app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated'}
 const profile={id,display_name:'Fixture Administrator',role:'admin',role_key:'admin',active:true,language:'en'}
 const permissions=['admin.configure_app','admin.users.manage','dashboard.view','urgent.view','invoices.view','invoices.manage','stock.count.view','stock.count.enter','items.view','items.edit','stock.search','suppliers.add','suppliers.view','suppliers.edit','company_lists.view','company_lists.manage',
  'procurement.requirements.view','procurement.requirements.manage','procurement.rfq.view','procurement.rfq.manage',
  'procurement.orders.view','procurement.orders.edit','procurement.orders.create','procurement.orders.approve','receiving.view','receiving.manage']
 const item={id:'00000000-0000-4000-8000-000000000003',item_id:'00000000-0000-4000-8000-000000000003',
  category:'GENERAL',description:'Fixture hardware item with a long description',size:'2 inch',uom:'PCS',
  movement:'FAST',max_stock:20,reorder_level:10,current_stock:10,active:true,is_due:true}
 const requirement={...item,source_count_line_id:'count-line-fixture',id:'00000000-0000-4000-8000-000000000004',requirement_no:'REQ-FIXTURE',
  adjusted_qty:10,remaining_to_order:10,ordered_qty:0,ordered_not_received:0,status:'open',
  approval_status:'pending_review',source_type:'stock_count',priority:'normal',created_at:new Date().toISOString()}
 const supplier={id:'00000000-0000-4000-8000-000000000005',supplier_code:'S-FIXTURE',name:'Fixture supplier',phone:'+94779792078',whatsapp:'+94779792078',active:true}
 const newSupplier={...supplier,id:'00000000-0000-4000-8000-000000000010',name:'Newly registered supplier'}
 const rfq={id:'00000000-0000-4000-8000-000000000006',rfq_no:'RFQ-FIXTURE',status:'prepared',due_date:'2099-01-01'}
 const po={id:'00000000-0000-4000-8000-000000000007',po_no:'PO-FIXTURE',supplier_id:supplier.id,supplier,status:'sent',total:1000,po_date:'2099-01-01'}
 const otherPo={...po,id:'00000000-0000-4000-8000-000000000011',po_no:'PO-SECOND'}
 for(const width of (process.env.GH_UI_WIDTHS?process.env.GH_UI_WIDTHS.split(',').map(Number):[320,390,768,1366])){
  let interfacePreference=null
  const context=await browser.newContext({viewport:{width,height:844}})
  const page=await context.newPage()
  const errors=[],queries=[],receipts=[],stockSubmissions=[],policyViolations=[],companyImports=[]
  await page.exposeFunction('ghRecordCspViolation',data=>policyViolations.push(data))
  await context.addInitScript(()=>document.addEventListener('securitypolicyviolation',e=>window.ghRecordCspViolation({directive:e.effectiveDirective,blocked:e.blockedURI})))
  async function requireQuery(predicate,message){
   for(let attempt=0;attempt<200;attempt++){
    if(queries.some(predicate))return
    await page.waitForTimeout(50)
   }
   assert.fail(message)
  }
  let exceptionFixtures=false
  const savedQuotes=new Map(),additionalCalls=[]; let extraSizeItems=[]
  let quoteReadFailure=null
  let draftSaveFailure=false
  const draftSaves=[]
  let grantedPermissions=permissions
  let currentProfile=profile
  let poFixtureStatus='sent',poLargeExport=false,receivingManyRows=false,rfqItemCount=100,requirementApproval='pending_review'
  const poGatewayRequests=[],rfqGatewayRequests=[],rfqDispatches=[]
  let bulkReady=true
  const setupRequests=[],resetLinkRequests=[]
  let staffInvites=[],staffProfiles=[profile],deleteFailure=true
  const deleteRequests=[]
  const destructiveRequests=[]
  let stallStartup=false,releaseStartup,stalledReturned=false
  const startupGate=new Promise(resolve=>{releaseStartup=resolve})
  await context.route(root+'/api/integrations/whatsapp/po**',async route=>{const req=route.request();if(req.method()==='POST'){poGatewayRequests.push(req.postDataJSON());return route.fulfill({json:{ok:true,status:'accepted'}})}return route.fulfill({json:{configured:true,connected:true,sendingEnabled:true,dispatches:[]}})})
  await context.route(root+'/api/integrations/whatsapp/rfq**',async route=>{
   const req=route.request()
   if(req.method()==='GET')return route.fulfill({json:{ok:true,configured:true,connected:bulkReady,sendingEnabled:bulkReady,dispatches:rfqDispatches}})
   const body=req.postDataJSON();rfqGatewayRequests.push(body)
   assert.equal(body.rfqId,rfq.id);assert.ok(body.caption.includes('RFQ-FIXTURE'));assert.equal(Buffer.from(body.pngBase64,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a')
   const exists=rfqDispatches.some(d=>d.supplier_id===body.supplierId)
   if(exists)return route.fulfill({status:409,json:{ok:false,error:'Duplicate send blocked'}})
   rfqDispatches.push({supplier_id:body.supplierId,status:body.supplierId===newSupplier.id?'failed':'accepted'})
   if(body.supplierId===newSupplier.id)return route.fulfill({status:422,json:{ok:false,error:'Fixture definite rejection'}})
   return route.fulfill({json:{ok:true,status:'accepted',messageId:'fixture-message'}})
  })
  let directory=[supplier],invitations=[{id:'invite-fixture',rfq_id:rfq.id,supplier_id:supplier.id,status:'pending'}],addFailure=true,rfqStatus='prepared'
  page.on('console',m=>{if(m.type()==='error'&&/ReferenceError|TypeError|Minified React error/.test(m.text()))errors.push(m.text())})
  page.on('pageerror',e=>errors.push(e.message))
  await context.route('https://*.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop()
   queries.push(url)
   let data=[]
   if(url.pathname.endsWith('/auth/v1/verify')&&req.method()==='POST'){
    const body=req.postDataJSON()
    if(body.token_hash!=='fixture-valid-hash'){
     await route.fulfill({status:403,json:{code:'otp_expired',msg:'Token invalid or expired'}})
     return
    }
    const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
    const payload=Buffer.from(JSON.stringify({sub:id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')
    await route.fulfill({json:{access_token:header+'.'+payload+'.fixture',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user}})
    return
   }
   if(url.pathname.includes('/auth/'))data=user
   else if(['proc_admin_reset_data_v1','proc_admin_delete_item_v1','proc_admin_clear_po_v1'].includes(name)){destructiveRequests.push({name,body:req.postDataJSON()});return route.fulfill({status:400,json:{message:'Fixture operation blocked'}})}
   else if(name==='proc_quick_add_item_v1')data={existing:false,item:{...item,item_code:'QA-FIXTURE',description:req.postDataJSON().p_item.description}}
   else if(name==='proc_companies')data=[{id:'company-fixture',company_code:'COMP-FIXTURE',name:'Fixture company',active:true,company_list_enabled:true}]
   else if(name==='proc_company_list_items')data=[{id:'company-row-one',item_id:item.id,target_stock:20,item:{...item,item_code:'FIXTURE-ITEM',subgroup:'Locks'}},{id:'company-row-two',item_id:'company-other',target_stock:10,item:{...item,id:'company-other',description:'Fixture switch',category:'ELECTRICAL',subgroup:'Switches'}}]
   else if(name==='proc_import_company_items_v1'){companyImports.push(req.postDataJSON());data={created:req.postDataJSON().p_rows.length,existing:0,company_list_linked:req.postDataJSON().p_rows.length}}
   else if(name==='proc_profiles'){if(stallStartup&&url.searchParams.has('id')){await startupGate;stalledReturned=true}data=url.searchParams.has('id')?[currentProfile]:staffProfiles}
   else if(name==='proc_admin_delete_user_v1'){
    const body=req.postDataJSON();deleteRequests.push(body)
    assert.equal(body.p_confirmation,'DELETE Fixture staff')
    if(deleteFailure){deleteFailure=false;return route.fulfill({status:400,json:{message:'Fixture delete failure'}})}
    staffProfiles=staffProfiles.filter(u=>u.id!==body.p_user_id);staffInvites=staffInvites.map(i=>({...i,status:'revoked'}));data={ok:true,user_id:body.p_user_id}
   }
   else if(name==='proc_roles')data=[{role_key:'viewer',base_role:'viewer',name:'Viewer',enabled:true},{role_key:'admin',base_role:'admin',name:'Admin',enabled:true}]
   else if(name==='proc_user_invites')data=staffInvites
   else if(name==='proc-invite-user'){
    const body=req.postDataJSON()
    if(body.delivery==='reset_link'){
     resetLinkRequests.push(body)
     assert.equal(body.user_id,'00000000-0000-4000-8000-000000000012')
     data={ok:true,setup_link:'https://gh-procurement-production.up.railway.app/?recovery=1#token_hash=fixture-reset&type=recovery',email:'staff@example.invalid',message:'Recovery link generated without sending email.'}
    }else{
     setupRequests.push(body)
     assert.equal(body.delivery,'link','Setup-link flow does not use SMTP')
     staffProfiles=[profile,{id:'00000000-0000-4000-8000-000000000012',display_name:body.display_name,role:body.role_key,role_key:body.role_key,active:true}]
     staffInvites=[{invited_user_id:'00000000-0000-4000-8000-000000000012',id:'staff-invite',email:body.email,display_name:body.display_name,role:body.role_key,role_key:body.role_key,status:'pending',invited_at:new Date().toISOString()}]
     data={ok:true,setup_link:'https://auth.example.invalid/verify?token=fixture-setup-only',message:'One-time setup link generated.'}
    }
   }
   else if(name==='proc_my_permissions_v1')data=grantedPermissions.map(permission_key=>({permission_key}))
   else if(name==='proc_v_dashboard')data={active_items:1,open_requirements:1,still_to_order:1,awaiting_receipt:0,open_pos:0,po_value:0}
   else if(exceptionFixtures&&['proc_v_urgent_actions','proc_automation_jobs','proc_v_rejection_cases'].includes(name)){
    const count=name==='proc_v_urgent_actions'?1011:601
    const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||500)
    data=Array.from({length:count},(_,i)=>({id:'exception-'+i,action_id:'action-'+i,action_type:'existing_item',description:'Exception fixture '+(i+1),size:'',uom:'PCS',category:'GENERAL',movement:'FAST',effective_priority:'urgent',priority_score:100,urgency_reason:i===1010?'customer_paid':'manual_urgent',required_qty:1,status:name==='proc_automation_jobs'?'failed':'open',job_type:'rfq_send',entity_type:'rfq',updated_at:'2026-10-11T00:00:00Z',created_at:'2026-10-11T00:00:00Z',grn_no:'GRN-'+(i+1),po_no:'PO-'+(i+1),supplier_name:'Fixture supplier',rejected_qty:1})).slice(offset,offset+limit)
   }
   else if(name==='proc_v_requirements')data=[{...requirement,approval_status:requirementApproval}]
   else if(name==='proc_review_requirements'){requirementApproval=req.postDataJSON().p_action==='approve'?'approved':'held';data=1}
   else if(name==='proc_create_rfq_v4'){assert.deepEqual(req.postDataJSON().p_requirement_ids,[requirement.id]);assert.deepEqual(req.postDataJSON().p_supplier_ids,[supplier.id]);data=rfq}
   else if(name==='proc_mark_rfq_supplier_sent_v1'){invitations=invitations.map(i=>({...i,status:'sent'}));rfqStatus='sent';data=true}
   else if(name==='proc_rfqs')data=[{...rfq,status:rfqStatus}]
   else if(name==='proc_suppliers'){if(req.method()==='POST'){const payload=req.postDataJSON();assert.equal(payload.whatsapp,'+94771234567');data={...payload,id:'quick-created-supplier'};directory=[...directory,data]}else data=directory}
   else if(name==='proc_rfq_suppliers')data=invitations
   else if(name==='proc_add_rfq_supplier_v1'){
    assert.deepEqual(req.postDataJSON(),{p_rfq_id:rfq.id,p_supplier_id:newSupplier.id,p_scope_override_reason:null})
    if(addFailure){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Fixture invitation failure'})});return}
    const invitation={id:'new-invite-fixture',rfq_id:rfq.id,supplier_id:newSupplier.id,status:'pending'}
    invitations=[...invitations,invitation]
    data={invitation,rfq_status:rfqStatus,added:true}
   }
   else if(name==='proc_rfq_items')data=Array.from({length:rfqItemCount},(_,i)=>({id:i===0?'00000000-0000-4000-8000-000000000008':'sheet-item-'+i,rfq_id:rfq.id,requirement_id:requirement.id,requirement:{...requirement,item:i===0?item:{...item,description:'Bathroom fixture '+i,category:'BATHROOM'}},requested_qty:10,selected_for_po:true})).concat(extraSizeItems)
   else if(name==='proc_v_quote_comparison')data=[{rfq_item_id:'00000000-0000-4000-8000-000000000008',supplier_id:supplier.id,supplier_name:supplier.name,quote_line_id:'quote-fixture',unit_price:100,landed_unit_cost:100,landed_rank:1,available_qty:null,lead_days:null,moq:0,order_multiple:1}].concat(extraSizeItems.map(i=>({rfq_item_id:i.id,supplier_id:supplier.id,supplier_name:supplier.name,quote_line_id:'quote-size',unit_price:40,landed_unit_cost:40,landed_rank:1,available_qty:null,lead_days:null,moq:0,order_multiple:1})))
   else if(name==='proc_quote_snapshot_v1'){
    const supplierId=req.postDataJSON().p_supplier_id
    if(supplierId===quoteReadFailure){quoteReadFailure=null;return route.fulfill({status:400,json:{message:'Fixture quote load failure'}})}
    const q=savedQuotes.get(supplierId)||null;data={quote:q,lines:q?.lines||[],revision:JSON.stringify(q)}
   }
   else if(name==='proc_quotes'){const id=url.searchParams.get('supplier_id')?.slice(3);if(id===quoteReadFailure){quoteReadFailure=null;await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Fixture quote load failure'})});return}data=id?(savedQuotes.get(id)||null):[...savedQuotes.entries()].map(([supplier_id,q])=>({...q,supplier_id}))}
   else if(name==='proc_quote_lines'){const id=url.searchParams.get('quote_id')?.slice(3);data=[...savedQuotes.values()].find(q=>q.id===id)?.lines||[]}
   else if(name==='proc_save_quote_guarded_v1'){
    const p=req.postDataJSON();if(p.p_expected_revision!==JSON.stringify(savedQuotes.get(p.p_supplier_id)||null))return route.fulfill({status:409,json:{code:'40001',message:'Saved supplier quotation changed'}});if(p.p_additional_sizes?.length){additionalCalls.push(p);assert.deepEqual(p.p_additional_sizes,[{source_rfq_item_id:'00000000-0000-4000-8000-000000000008',size:'2 ft',unit_price:40,qty:6,remarks:''}]);extraSizeItems=[{id:'additional-size',rfq_id:rfq.id,requested_qty:6,selected_for_po:true,requirement:{...requirement,adjusted_qty:6,item:{...item,size:'2 ft'}}}];p.p_lines.push({rfq_item_id:'additional-size',unit_price:40,notes:null})}assert.ok([supplier.id,newSupplier.id].includes(p.p_supplier_id),'Saving uses an invited supplier');assert.equal(p.p_attachment_path,null,'Another supplier’s attachment is not uploaded')
    savedQuotes.set(p.p_supplier_id,{id:'saved-'+p.p_supplier_id,quote_ref:p.p_quote_ref,freight_total:p.p_freight_total,minimum_order_value:p.p_minimum_order_value,valid_until:p.p_valid_until,notes:p.p_notes,lines:p.p_lines.map((l,i)=>({...l,id:'saved-line-'+i}))})
    rfqStatus='partially_quoted';invitations=invitations.map(x=>x.supplier_id===p.p_supplier_id?{...x,status:'quoted'}:x);data={status:rfqStatus}
   }
   else if(name==='proc_set_rfq_supplier_items_v1'){const p=req.postDataJSON();invitations=invitations.map(x=>x.supplier_id===p.p_supplier_id?{...x,requested_item_ids:p.p_item_ids}:x);data=invitations.find(x=>x.supplier_id===p.p_supplier_id)}
   else if(name==='proc_finalize_award_with_variations_v1')data=[{po_id:po.id,po_no:po.po_no,supplier_id:supplier.id}]
   else if(name==='proc_approve_po_v2'||name==='proc_mark_po_sent_v2'){assert.equal(req.postDataJSON().p_po_id,po.id);poFixtureStatus=name==='proc_approve_po_v2'?'approved':'sent';data=true}
   else if(name==='proc_purchase_orders'){data=[{...po,status:poFixtureStatus},otherPo];const scope=url.searchParams.get('id');if(scope?.startsWith('in.'))data=data.filter(x=>scope.includes(x.id));if(scope?.startsWith('eq.'))data=data.find(x=>x.id===scope.slice(3));if(Array.isArray(data)&&url.searchParams.get('status')==='eq.approved')data=data.filter(x=>x.status==='approved')}
   else if(name==='proc_receive_po_v3'){receipts.push(req.postDataJSON());await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Fixture receipt retry'})});return}
   else if(name==='proc_supplier_invoices')data=[{id:'invoice-fixture',invoice_no:'INV-VARIANCE',status:'variance',total:1000,supplier,po}]
   else if(name==='proc_po_lines'&&url.searchParams.has('source_quote_line_id'))data=[{po_id:po.id,po:{...po,status:poFixtureStatus}}]
   else if(name==='proc_po_lines'){
    const first={id:'00000000-0000-4000-8000-000000000009',po_id:url.searchParams.get('po_id')?.slice(3)||po.id,item_id:item.id,item,qty:10,unit_price:100,line_total:1000}
    data=poLargeExport?Array.from({length:100},(_,i)=>({id:'po-export-'+i,item:{...item,description:'PO fixture '+String(i+1),size:'2 inch'},qty:i+1,unit_price:123.45,line_total:123.45*(i+1)})):receivingManyRows?[first,...Array.from({length:8},(_,i)=>({...first,id:'receiving-line-'+i,item:{...item,description:'Receiving fixture '+(i+2)}}))]:[first]
   }
   else if(name==='proc_search_item_master_v2')data=[{...item,item_code:'FIXTURE-ITEM',total_count:1}]
   else if(name==='proc_items'||name==='proc_v_stock_check_due'||name==='proc_search_stock_items_v1')data=[item]
   else if(name==='proc_item_filter_options_v1')data={categories:['GENERAL'],main_groups:[]}
   else if(name==='proc_submit_stock_and_continue_v3'){stockSubmissions.push(req.postDataJSON());data={automation:{status:'review_required',submitted_items:1,requirements:1}}}
   else if(name==='proc_begin_stock_count_session_v1')data=new Date().toISOString()
   else if(name==='proc_admin_reset_preview_v1')data={scope:req.postDataJSON().p_scope,counts:{proc_purchase_orders:2,proc_stock_balances:1},token:'fixture-preview-token'}
   else if(name==='proc_stock_count_lines')data=[{count_id:'count-fixture'}]
   else if(name==='proc_stock_counts')data=[{id:'count-fixture',count_no:'COUNT-FIXTURE',submitted_at:'2026-10-12T09:00:00Z',counted_by:profile.id}]
   else if(name==='proc_settings'){if(req.method()==='POST')interfacePreference=req.postDataJSON().value;data=[{key:'company_profile',value:{name:'General Hardware',town:'Nawalapitiya'}},...(interfacePreference?[{key:'interface_preferences',value:interfacePreference}]:[])]}
   else if(name==='proc_feature_settings')data=[{feature_key:'stock.server_drafts',enabled:true}]
   else if(name==='proc_stock_count_drafts'){
    if(req.method()==='POST'){
     draftSaves.push(req.postDataJSON())
     if(draftSaveFailure)return route.fulfill({status:503,json:{message:'Fixture draft sync unavailable'}})
    }
    data=[]
   }
   if(req.headers()['accept']?.includes('vnd.pgrst.object')&&Array.isArray(data))data=data[0]||null
   await route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-0/1'},body:JSON.stringify(data)})
  })
  await context.addInitScript(({id,user})=>{
   const header=btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))
   const payload=btoa(JSON.stringify({sub:id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600}))
   localStorage.setItem('sb-huxhcjmcvlhblvpvrron-auth-token',JSON.stringify({
    access_token:header+'.'+payload+'.fixture',refresh_token:'fixture-refresh',token_type:'bearer',
    expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,user
   }))
  },{id,user})
  // Inject into the parsed HTML response, rather than through trusted runtime code.
  await page.route(root+'/',async route=>{
   const response=await route.fetch()
   const html=await response.text()
   await route.fulfill({response,body:html.replace('</head>','<script>window.__ghUntrustedInlineExecuted=true</script></head>')})
  })
  // Invalid / used links must fail closed even if another user's session is cached.
  await page.goto(root+'/?recovery=1#token_hash=invalid&type=invite')
  await page.getByText(/This password link has expired, was already used/).waitFor()
  assert.equal(await page.getByRole('button',{name:'Update password',exact:true}).count(),0,'Invalid link never permits password updates')
  assert.equal(await page.evaluate(()=>location.hash),'','Expired verification tokens do not remain in the address bar')
  // New first-party links establish their own session without relying on a redirected browser fragment.
  await page.goto(root+'/?recovery=1#token_hash=fixture-valid-hash&type=invite')
  await page.getByRole('heading',{name:'Set a new password',exact:true}).waitFor()
  const setupPassword=page.getByPlaceholder('New password (12+ with upper/lowercase, number & symbol)',{exact:true})
  const setupConfirm=page.getByPlaceholder('Confirm new password',{exact:true})
  await setupPassword.waitFor({state:'visible',timeout:15000})
  assert.equal(await page.getByText('Loading secure workspace…',{exact:true}).count(),0)
  assert.equal(await setupPassword.getAttribute('type'),'password')
  assert.equal(await setupConfirm.getAttribute('type'),'password')
  await page.getByLabel('Show passwords',{exact:true}).check()
  assert.equal(await setupPassword.getAttribute('type'),'text')
  assert.equal(await setupConfirm.getAttribute('type'),'text')
  await page.getByLabel('Show passwords',{exact:true}).uncheck()
  assert.equal(await setupPassword.getAttribute('type'),'password')
  assert.equal(await page.evaluate(()=>location.hash),'','Verified setup tokens do not persist in the address bar')
  await setupPassword.fill('FixturePassword123!')
  await setupConfirm.fill('FixturePassword123!')
  await page.getByRole('button',{name:'Update password',exact:true}).click()
  await page.getByRole('heading',{name:'Password updated',exact:true}).waitFor()
  await page.screenshot({path:'test-results/'+width+'-password-setup.png'})
  if(width===390)stallStartup=true
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  if(width===390){
   await page.getByRole('heading',{name:'Access unavailable',exact:true}).waitFor({timeout:25000})
   await page.getByText(/workspace is taking too long/).waitFor()
   stallStartup=false;releaseStartup()
   for(let attempt=0;attempt<100&&!stalledReturned;attempt++)await page.waitForTimeout(25)
   await page.waitForTimeout(100)
   assert.equal(await page.getByRole('heading',{name:'Home',exact:true}).count(),0,'Late access result cannot bypass the failed startup')
   await page.getByRole('button',{name:'Retry',exact:true}).click()
  }
  await page.unroute(root+'/')
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  for(let attempt=0;attempt<200&&!policyViolations.length;attempt++)await page.waitForTimeout(25)
  assert.equal(await page.evaluate(()=>window.__ghUntrustedInlineExecuted===true),false,'Untrusted inline JavaScript must be blocked')
  assert.ok(policyViolations.some(x=>x.directive==='script-src-elem'&&x.blocked==='inline'),'Browser must enforce the inline-script refusal')
  assert.deepEqual(policyViolations.filter(x=>x.directive!=='script-src-elem'||x.blocked!=='inline'),[],'Only the controlled injection may violate CSP')
  policyViolations.length=0
  async function navigate(label){
   let target=page.getByRole('button',{name:label,exact:true}).filter({visible:true}).first()
   if(await target.count()===0){
    if(await page.getByRole('button',{name:'Open menu',exact:true}).isVisible())
     await page.getByRole('button',{name:'Open menu',exact:true}).click()
    else await page.locator('summary').filter({hasText:'More / Admin'}).click()
    target=page.getByRole('button',{name:label,exact:true}).filter({visible:true}).first()
   }
   await target.click()
  }
  if(process.env.GH_UI_PRINT_TEMPLATES==='1'){
   await navigate('CL Company Lists')
   await page.getByText('Fixture switch',{exact:true}).filter({visible:true}).first().waitFor()
   await page.getByRole('button',{name:'Customize & Print Stock PDF',exact:true}).filter({visible:true}).first().click()
   const print=page.getByRole('dialog',{name:'Stock PDF setup',exact:true});await print.waitFor()
   assert.equal(await print.getByLabel('Tables per page',{exact:true}).inputValue(),'3')
   assert.equal(await print.getByLabel('Print movement',{exact:true}).count(),0,'Company lists do not restrict movement')
   const download=page.waitForEvent('download');await print.getByRole('button',{name:'Download Printable PDF',exact:true}).click()
   const pdf=await download,bytes=await readFile(await pdf.path());const pdfText=b=>[...b.toString('latin1').matchAll(/\(([^()]*)\)\s*Tj/g)].map(m=>m[1]).join(' ');assert.ok(pdfText(bytes).includes('Fixture switch'));assert.ok(bytes.includes(Buffer.from('Stocks Checked By')))
   await writeFile('test-results/'+width+'-company-stock-custom.pdf',bytes)
   await print.getByLabel('Print subcategory',{exact:true}).selectOption('Switches')
   const one=page.waitForEvent('download');await print.getByRole('button',{name:'Download Printable PDF',exact:true}).click()
   const selected=await one,selectedBytes=await readFile(await selected.path());assert.ok(pdfText(selectedBytes).includes('Fixture switch'));assert.ok(!pdfText(selectedBytes).includes(item.description))
   await print.getByRole('button',{name:'Close',exact:true}).click()
   await navigate('Q RFQs & Quotes');await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   await page.locator('.journey-shortcuts > summary').click();await page.getByLabel('Go to procurement section',{exact:true}).selectOption('3')
   await page.getByRole('button',{name:'Edit RFQ Document Template',exact:true}).click()
   const editor=page.getByRole('dialog',{name:'Supplier document template',exact:true});await editor.waitFor()
   await editor.getByLabel('Document business header',{exact:true}).fill('General Ceramics')
   await editor.getByLabel('Document heading',{exact:true}).fill('Supplier Price Enquiry')
   await editor.getByLabel('Document instructions',{exact:true}).fill('Please confirm stock and delivery.')
   await editor.getByLabel('Document caption template',{exact:true}).fill('{company_name} {rfq_number} {supplier_name}')
   await page.screenshot({path:'test-results/'+width+'-supplier-template-editor.png'})
   await editor.getByRole('button',{name:'Done',exact:true}).click()
   const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('gh-rfq-document:00000000-0000-4000-8000-000000000002')))
   assert.equal(saved.name,'General Ceramics');assert.equal(saved.title,'Supplier Price Enquiry');assert.equal(saved.note,'Please confirm stock and delivery.')
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}));assert.ok(dimensions.scroll<=dimensions.width+1)
   assert.deepEqual(errors,[])
   console.log('PASS company full-list PDF, subcategory selection and modern supplier header/caption template at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_STOCK_NUMBERS==='1'){
   await navigate('✓ Stock Entry')
   const stock=page.locator(width<=700?'.browse-stock-input':'section:not([hidden]) .desktop-table input.stock-entry').filter({visible:true}).first()
   await stock.waitFor()
   for(const [input,expected] of [['001','1'],['00101','101'],['000','0'],['00.125','0.125']]){
    await stock.fill(input);assert.equal(await stock.inputValue(),expected)
   }
   await stock.fill('00101')
   await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gh-stock-count-draft:00000000-0000-4000-8000-000000000002')||'{}').entry?.['00000000-0000-4000-8000-000000000003']==='101')
   await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
   await navigate('✓ Stock Entry');await stock.waitFor();assert.equal(await stock.inputValue(),'101')
   await page.getByRole('button',{name:'Submit Stock · 1',exact:true}).click()
   const submitDialog=page.getByRole('dialog',{name:'Submit stock count',exact:true})
   await submitDialog.waitFor();await submitDialog.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(await stock.inputValue(),'101','Cancelling the modern dialog preserves the count draft')
   await navigate('□ Items')
   await page.getByText('FIXTURE-ITEM',{exact:true}).filter({visible:true}).first().waitFor()
   const details=page.locator('section:not([hidden]) summary').filter({hasText:'More details'}).filter({visible:true}).first()
   if(await details.count())await details.click()
   await page.getByRole('button',{name:'Delete item',exact:true}).filter({visible:true}).first().click()
   const deletion=page.getByRole('alertdialog',{name:'Delete item',exact:true})
   assert.equal(await deletion.getByRole('button',{name:'Confirm delete item',exact:true}).isDisabled(),true)
   await deletion.getByLabel('Warning confirmation',{exact:true}).fill('FIXTURE-ITEM')
   assert.equal(await deletion.getByRole('button',{name:'Confirm delete item',exact:true}).isEnabled(),true)
   await page.screenshot({path:'test-results/'+width+'-modern-item-delete.png'})
   await deletion.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(destructiveRequests.length,0,'Cancelling deletion never calls a destructive API')
   if(width<=700){
    await page.getByRole('button',{name:'Open menu',exact:true}).click()
    const menu=page.getByRole('dialog',{name:'GH Procurement',exact:true});await menu.waitFor()
    assert.equal(await menu.evaluate(node=>node.contains(document.activeElement)),true)
    await page.screenshot({path:'test-results/'+width+'-modern-menu.png'})
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'})
    assert.equal(await page.getByRole('button',{name:'Open menu',exact:true}).evaluate(node=>node===document.activeElement),true)
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.getByRole('button',{name:'Open menu',exact:true}).click();await menu.waitFor()
    assert.equal(await menu.evaluate(node=>getComputedStyle(node).animationName),'none')
    await page.keyboard.press('Escape')
   }
   assert.deepEqual(errors,[])
   console.log('PASS normalized stock input, restored drafts, protected item deletion, modern dialogs/menu and reduced motion at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_CATALOG==='1'){
  // Catalog actions use intercepted APIs; production is never mutated.
  await navigate('CL Company Lists')
  await page.getByText('Fixture switch',{exact:true}).filter({visible:true}).first().waitFor()
  const companyView=page.locator('section:not([hidden])').filter({has:page.getByRole('heading',{name:'Company Lists',exact:true})})
  await companyView.getByLabel('Company list category',{exact:true}).selectOption('ELECTRICAL')
  assert.equal(await companyView.getByText(item.description,{exact:true}).filter({visible:true}).count(),0)
  await companyView.getByLabel('Company list subcategory',{exact:true}).selectOption('Switches')
  await companyView.getByText('Fixture switch',{exact:true}).filter({visible:true}).first().waitFor()
  await companyView.getByRole('button',{name:'Remove company list',exact:true}).click()
  const companyWarning=page.getByRole('alertdialog',{name:'Remove company list',exact:true})
  assert.equal(await companyWarning.getByRole('button',{name:'Confirm remove list',exact:true}).isDisabled(),true)
  await companyWarning.getByRole('button',{name:'Cancel',exact:true}).click()
  const catalogPdf=new jsPDF();catalogPdf.text('Cycle Lock 2 ft 100.00',10,20)
  await companyView.getByText('Import Company List with OCR',{exact:true}).click()
  const importPanel=companyView.locator('details.card').filter({has:page.getByText('Import Company List with OCR',{exact:true})})
  await importPanel.getByLabel('Company list photo / PDF',{exact:true}).setInputFiles({name:'company-list.pdf',mimeType:'application/pdf',buffer:Buffer.from(catalogPdf.output('arraybuffer'))})
  await importPanel.getByRole('button',{name:'Select all',exact:true}).waitFor()
  await importPanel.getByRole('button',{name:'Select all',exact:true}).click()
  await importPanel.getByLabel('Category',{exact:true}).first().fill('BATHROOM')
  await importPanel.getByLabel('Subcategory',{exact:true}).first().fill('Locks')
  await importPanel.getByRole('button',{name:'Apply category to selected',exact:true}).click()
  await importPanel.getByLabel('Item name row 1',{exact:true}).fill('Corrected cycle lock')
  await importPanel.getByLabel('Target stock row 1',{exact:true}).fill('0010')
  await importPanel.getByRole('button',{name:'Add blank row',exact:true}).click()
  await importPanel.getByLabel('Item name row 2',{exact:true}).fill('Manual water pump')
  await importPanel.getByLabel('Size row 2',{exact:true}).fill('1 HP')
  await importPanel.getByText('Paste rows from Excel',{exact:true}).click()
  await importPanel.getByLabel('Spreadsheet rows',{exact:true}).fill('Item name\tSize\tUOM\tCategory\tSubcategory\tTarget stock\nPasted PVC elbow\t20 mm\tPCS\tGENERAL\tPVC fittings\t12')
  await importPanel.getByRole('button',{name:'Add pasted rows to review',exact:true}).click()
  await importPanel.getByRole('button',{name:'Add Reviewed Items to Company List',exact:true}).click()
  await requireQuery(url=>url.pathname.endsWith('/proc_import_company_items_v1'),'Company OCR uses reviewed import API')
  assert.equal(companyImports.length,1)
  assert.equal(companyImports[0].p_company_id,'company-fixture')
  assert.equal(companyImports[0].p_add_to_company_list,true)
  assert.deepEqual(companyImports[0].p_rows.map(r=>r.description),['Corrected cycle lock','Manual water pump','Pasted PVC elbow'])
  assert.equal(companyImports[0].p_rows[0].max_stock,10)
  assert.equal(companyImports[0].p_rows[0].category,'BATHROOM')
  assert.equal(companyImports[0].p_rows[2].subgroup,'PVC fittings')
  await importPanel.getByText('3 rows · 0 selected to add',{exact:true}).waitFor()
  assert.equal(await importPanel.getByRole('button',{name:'Add Reviewed Items to Company List',exact:true}).isDisabled(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Company review sheet stays inside mobile viewport')
  await navigate('♢ Suppliers')
  const supplierDetails=page.locator('section:not([hidden]) summary').filter({hasText:'More details'}).filter({visible:true}).first()
  if(await supplierDetails.count())await supplierDetails.click()
  await page.getByRole('button',{name:'Delete supplier',exact:true}).filter({visible:true}).first().click()
  const supplierWarning=page.getByRole('alertdialog',{name:'Delete supplier',exact:true})
  assert.equal(await supplierWarning.getByRole('button',{name:'Confirm delete supplier',exact:true}).isDisabled(),true)
  await supplierWarning.getByLabel('Warning confirmation',{exact:true}).fill('WRONG')
  assert.equal(await supplierWarning.getByRole('button',{name:'Confirm delete supplier',exact:true}).isDisabled(),true)
  await supplierWarning.getByRole('button',{name:'Cancel',exact:true}).click()
  console.log('PASS company category/subcategory filters, company removal and supplier deletion confirmations at '+width+'px')
  await navigate('□ Items')
  await page.getByText('FIXTURE-ITEM',{exact:true}).filter({visible:true}).first().waitFor()
  await page.getByRole('button',{name:'+ Quick Add Item',exact:true}).filter({visible:true}).first().click()
  const quick=page.locator('.card').filter({has:page.getByRole('heading',{name:'Quick Add Item',exact:true})}).last()
  await quick.getByLabel('Item name',{exact:true}).fill('New fixture lock')
  await quick.getByLabel('Size',{exact:true}).fill('2 ft')
  await quick.getByRole('button',{name:'Save Item',exact:true}).click()
  await page.getByRole('heading',{name:'Quick Add Item',exact:true}).waitFor({state:'hidden'})
  await requireQuery(url=>url.pathname.endsWith('/proc_quick_add_item_v1'),'Quick creation must use the guarded item API')
  console.log('PASS quick-add item creation and return to Item Master at '+width+'px')
  await navigate('⇩ Receive Goods')
  await page.getByLabel('Purchase Order',{exact:true}).selectOption(po.id)
  await page.getByLabel('Search receiving items',{exact:true}).waitFor()
  await page.getByText('Scan GRN / delivery note (OCR)',{exact:true}).click()
  const receiptPdf=new jsPDF();receiptPdf.text(item.description+' 2 inch Qty: 6',10,20)
  await page.getByLabel('GRN / delivery document',{exact:true}).setInputFiles({name:'delivery.pdf',mimeType:'application/pdf',buffer:Buffer.from(receiptPdf.output('arraybuffer'))})
  await page.getByRole('button',{name:'Apply Reviewed GRN Rows',exact:true}).waitFor()
  const ocrPanel=page.locator('details').filter({has:page.getByText('Scan GRN / delivery note (OCR)',{exact:true})})
  await ocrPanel.getByLabel('Use',{exact:true}).check()
  await ocrPanel.getByRole('button',{name:'Apply Reviewed GRN Rows',exact:true}).click()
  await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
  if(width<=700){
   assert.equal(await page.getByLabel('Received '+item.description+' · 2 inch',{exact:true}).inputValue(),'6')
   assert.equal(await page.getByLabel('Accepted '+item.description+' · 2 inch',{exact:true}).inputValue(),'')
  }else{
   const quantities=page.locator('section:not([hidden]) .desktop-table tbody .stock-entry')
   assert.equal(await quantities.nth(0).inputValue(),'6');assert.equal(await quantities.nth(1).inputValue(),'')
  }
  assert.equal(receipts.length,0,'OCR never posts a GRN automatically')
  assert.deepEqual(errors,[])
  await page.screenshot({path:'test-results/'+width+'-catalog-grn-ocr.png'})
  console.log('PASS reviewed company-list and GRN PDF extraction without automatic stock posting at '+width+'px')
  await context.close();continue
  }
  if(process.env.GH_UI_FOCUSED==='1'){
   rfqItemCount=6
   await navigate('Q RFQs & Quotes')
   await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   await page.getByRole('heading',{name:'RFQ-FIXTURE',exact:true}).waitFor()
   const guide=page.getByRole('navigation',{name:'Guided procurement navigation',exact:true})
   assert.ok(await guide.getByText('STAGE 1 OF 3',{exact:true}).isVisible())
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).count(),0,'Sending interface hides prices')
   await page.getByRole('button',{name:'Save & enter received quotes →',exact:true}).click()
   const input=page.locator('[data-rfq-price-item]').filter({visible:true}).first()
   await input.waitFor();await input.fill('05');assert.equal(await input.inputValue(),'5')
   await input.fill('123.45');await page.waitForTimeout(400)
   assert.equal(await page.locator('.rfq-bulk-send').filter({visible:true}).count(),0,'Quote interface hides sending')
   assert.equal(await page.getByRole('heading',{name:'Supplier Price Comparison',exact:true}).filter({visible:true}).count(),0,'Quote interface hides comparison')
   await page.locator('.stock-source > summary').click()
   await page.getByText(/COUNT-FIXTURE.*02:30/).waitFor()
   await page.locator('.stock-source > summary').click()
   await page.getByRole('button',{name:'Focus entry',exact:true}).click()
   await page.evaluate(()=>window.scrollTo(0,0))
   await page.screenshot({path:'test-results/focused-quotes-'+width+'.png'})
   const dock=page.locator('.task-dock').filter({visible:true}).first()
   assert.ok(await dock.isVisible())
   const bounds=await dock.boundingBox();assert.ok(bounds.y<844,'Main action stays in viewport')
   await page.getByRole('button',{name:'Exit focus',exact:true}).click()
   assert.ok(await guide.getByText('STAGE 2 OF 3',{exact:true}).isVisible())
   await page.reload();await page.locator('.app').waitFor()
   await page.getByRole('button',{name:'Continue order / task →',exact:true}).click()
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().waitFor()
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'123.45','Refresh restores unsaved supplier prices')
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().fill('124.50')
   await page.reload();await page.locator('.app').waitFor();await page.getByRole('button',{name:'Continue order / task →',exact:true}).click()
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().waitFor()
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'124.50','Immediate refresh flushes the latest draft before debounce')
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().fill('123.45');await page.waitForTimeout(400)
   savedQuotes.set(supplier.id,{id:'changed-server-quote',lines:[{id:'changed-line',rfq_item_id:'00000000-0000-4000-8000-000000000008',unit_price:222,notes:null}]})
   await page.reload();await page.locator('.app').waitFor();await page.getByRole('button',{name:'Continue order / task →',exact:true}).click()
   await page.getByRole('button',{name:'Restore my draft for review',exact:true}).waitFor()
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'222','A newer server quote is never silently overwritten by a stale draft')
   assert.equal(await page.getByRole('button',{name:'Save & Compare Prices →',exact:true}).isDisabled(),true,'Conflict must be resolved before saving')
   await page.getByRole('button',{name:'Restore my draft for review',exact:true}).click()
   savedQuotes.set(supplier.id,{id:'changed-again-quote',freight_total:88,minimum_order_value:250,quote_ref:'CURRENT',notes:'Supplier terms',lines:[{id:'changed-again-line',rfq_item_id:'00000000-0000-4000-8000-000000000008',unit_price:333,notes:null}]})
   await page.getByRole('button',{name:'Save & Compare Prices →',exact:true}).click()
   await page.getByRole('button',{name:'Restore my draft for review',exact:true}).waitFor()
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'333','Save-time conflict reloads the newer saved quotation')
   await page.getByRole('button',{name:'Keep current saved prices',exact:true}).click()
   await page.locator('.rfq-task-screen details').filter({hasText:'Quotation validity & commercial terms'}).locator('summary').click()
   assert.equal(await page.getByLabel('Supplier freight',{exact:true}).inputValue(),'88')
   await page.getByLabel('Quotation reference',{exact:true}).fill('REVISED')
   await page.getByLabel('Supplier freight',{exact:true}).fill('90')
   await page.getByLabel('Minimum order value',{exact:true}).fill('275')
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().fill('123.45')
   await page.waitForTimeout(400)
   await page.reload();await page.locator('.app').waitFor();await page.getByRole('button',{name:'Continue order / task →',exact:true}).click()
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().waitFor()
   assert.equal(await page.getByLabel('Supplier freight',{exact:true}).inputValue(),'90','Commercial draft restores after refresh')
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'123.45')
   await page.getByRole('button',{name:'Save & Compare Prices →',exact:true}).click()
   await page.getByRole('heading',{name:'Supplier Price Comparison',exact:true}).waitFor()
   assert.equal(savedQuotes.get(supplier.id).freight_total,90);assert.equal(savedQuotes.get(supplier.id).minimum_order_value,275);assert.equal(savedQuotes.get(supplier.id).quote_ref,'REVISED')
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).count(),0,'Comparison hides entry')
   await page.getByRole('button',{name:'Review & Create Supplier Orders',exact:true}).click()
   await page.getByRole('dialog').getByRole('button',{name:'Continue',exact:true}).click()
   await page.getByRole('heading',{name:'Choose prices · Review & create orders',exact:true}).waitFor()
   assert.equal(await page.getByRole('heading',{name:'Supplier Price Comparison',exact:true}).filter({visible:true}).count(),0,'Review hides comparison')
   assert.ok(!queries.some(u=>u.pathname.includes('proc_finalize_award')),'Opening review never creates a PO')
   await page.screenshot({path:'test-results/focused-review-'+width+'.png'})
   poFixtureStatus='pending_approval'
   await page.getByRole('button',{name:'Approve & create POs →',exact:true}).click()
   await page.getByRole('dialog').getByRole('button',{name:'Continue',exact:true}).click()
   await page.getByText(/Showing the 1 PO\(s\) created for this order/).waitFor()
   assert.ok(queries.some(u=>u.pathname.endsWith('/proc_purchase_orders')&&u.searchParams.get('id')==='in.('+po.id+')'),'Created order list is scoped to this batch')
   assert.ok(await page.getByText('STAGE 3 OF 3',{exact:true}).isVisible())
   await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
   await page.getByRole('region',{name:'Purchase order bill',exact:true}).waitFor().catch(async e=>{console.log('PO FAIL',errors,await page.locator('body').innerText());throw e})
   await page.screenshot({path:'test-results/po-before-approval-'+width+'.png'})
   await page.getByRole('button',{name:'Approve PO',exact:true}).click()
   await page.getByRole('dialog').getByRole('button',{name:'Continue',exact:true}).click()
   await page.getByText('Purchase order approved.',{exact:true}).waitFor()
   const poBatch=page.getByRole('region',{name:'Send all purchase orders',exact:true})
   await poBatch.getByRole('button',{name:'Send all POs · 1',exact:true}).waitFor()
   await poBatch.getByRole('button',{name:'Send all POs · 1',exact:true}).dblclick()
   await poBatch.getByText(/1 \/ 1 POs accepted for sending/).waitFor()
   assert.equal(poGatewayRequests.length,1,'Double tap sends one PO from this batch only')
   assert.equal(poGatewayRequests[0].poId,po.id)
   assert.equal(Buffer.from(poGatewayRequests[0].pngBase64,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a')
   assert.ok(poGatewayRequests[0].caption.includes(po.po_no),'PO caption accompanies actual PNG bytes')
   assert.equal(poFixtureStatus,'approved','Gateway acceptance never confirms sending or delivery')
   assert.equal(await poBatch.getByRole('button',{name:'Send all POs · 0',exact:true}).isDisabled(),true,'Accepted sends cannot be repeated')
   await page.getByRole('button',{name:'Confirm Sent',exact:true}).click()
   await page.getByRole('dialog').getByRole('button',{name:'Continue',exact:true}).click()
   await page.getByText('Purchase order marked as sent.',{exact:true}).waitFor()
   assert.equal(poFixtureStatus,'sent')
   await navigate('⚙ Admin')
   await page.getByText('Interface · Fonts & spacing',{exact:true}).click()
   await page.getByRole('button',{name:'Large',exact:true}).click()
   const settings=page.locator('.admin-accordion').filter({has:page.getByText('Interface · Fonts & spacing',{exact:true})})
   for(const [label,value] of [['Item description',17],['Size / variation',13],['Reorder level',21],['Stock, quantity & price inputs',19],['Row spacing',8]]){
    await setRange(settings.getByRole('slider',{name:new RegExp('^'+label)}),value)
   }
   assert.equal(await settings.getByLabel('Preview stock input',{exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'19px','Independent input font previews immediately')
   await settings.getByRole('button',{name:'Reset preview to defaults',exact:true}).click()
   assert.equal(await settings.getByLabel('Preview stock input',{exact:true}).evaluate(el=>getComputedStyle(el).fontSize),'16px')
   await settings.getByRole('button',{name:'Large',exact:true}).click()
   await settings.getByRole('combobox',{name:/Preview device/}).selectOption('desktop')
   await setRange(settings.getByRole('slider',{name:/^Item description/}),20)
   assert.equal(await settings.getByRole('slider',{name:/^Reorder level/}).inputValue(),'18','Mobile preset does not change desktop settings')
   await settings.getByRole('combobox',{name:/Preview device/}).selectOption('mobile')
   await settings.getByRole('button',{name:'Save interface settings',exact:true}).click()
   await page.getByText('Interface settings saved for all staff.',{exact:true}).waitFor()
   assert.equal(interfacePreference.mobile.reorder,22);assert.equal(interfacePreference.desktop.description,20)
   await navigate('✓ Stock Entry')
   await page.locator('.stock-reorder-value').filter({visible:true}).first().waitFor()
   const expected=width<=700?'22px':'18px'
   assert.equal(await page.locator('.stock-reorder-value').filter({visible:true}).first().evaluate(el=>getComputedStyle(el).fontSize),expected,'Saved font settings apply on correct device')
   assert.ok((await page.evaluate(()=>document.documentElement.scrollWidth))<=width+1,'No horizontal overflow')
   assert.deepEqual(errors,[])
   console.log('PASS focused tasks, draft recovery, submission time, review guards and font settings '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_SIZE_ORDER==='1'){
   rfqItemCount=1
   await navigate('Q RFQs & Quotes');await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   await page.getByRole('button',{name:'Save & enter received quotes →',exact:true}).click()
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().fill('36')
   let add=page.getByRole('button',{name:'+ Add size variation',exact:true}).filter({visible:true})
   if(!await add.count())await page.locator('.mobile-card-list details > summary').filter({visible:true}).first().click()
   await add.first().click()
   const row=page.locator('.formgrid').filter({has:page.getByPlaceholder('e.g. 1½ inch',{exact:true})}).filter({visible:true}).first()
   await row.getByPlaceholder('e.g. 1½ inch',{exact:true}).fill('2 ft')
   await row.getByPlaceholder('Price',{exact:true}).fill('40')
   await row.getByLabel('Additional size required quantity',{exact:true}).fill('0')
   await page.getByRole('button',{name:'Save & Compare Prices →',exact:true}).click()
   await page.getByText(/Required quantities must be greater than zero/).waitFor()
   assert.equal(additionalCalls.length,0,'Invalid quantity must not save')
   await row.getByLabel('Additional size required quantity',{exact:true}).fill('6')
   await row.getByText(/Separate order line/).waitFor()
   await page.getByRole('button',{name:'Save & Compare Prices →',exact:true}).click()
   const dialog=page.getByRole('dialog');await dialog.waitFor()
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(additionalCalls.length,0,'Cancelling must not add an item')
   assert.equal(await row.getByLabel('Additional size required quantity',{exact:true}).inputValue(),'6')
   await page.getByRole('button',{name:'Save & Compare Prices →',exact:true}).click()
   await dialog.getByRole('button',{name:'Continue',exact:true}).click()
   await page.getByText(/1 additional size line\(s\) added to order review/).waitFor()
   assert.equal(additionalCalls.length,1)
   await page.getByRole('button',{name:/Review & Create Supplier Orders/}).click()
   await page.getByText(/Choose prices · Review & create orders/).waitFor()
   assert.equal(await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).count(),0,'Promoted size is a separate item instead of a stale alternative')
   await page.screenshot({path:'test-results/additional-size-'+width+'.png',fullPage:false})
   assert.deepEqual(errors,[])
   console.log('PASS additional-size quantity, confirmation cancellation, save and order review '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_BULK_SEND==='1'){
   const thirdSupplier={...supplier,id:'00000000-0000-4000-8000-000000000014',name:'Third supplier',phone:'+94770000003',whatsapp:'+94770000003'}
   directory=[supplier,newSupplier,thirdSupplier]
   invitations=directory.map((s,i)=>({id:'bulk-invite-'+i,rfq_id:rfq.id,supplier_id:s.id,status:'pending',requested_item_ids:['00000000-0000-4000-8000-000000000008']}))
   rfqItemCount=1
   await navigate('Q RFQs & Quotes');await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   const panel=page.getByRole('region',{name:'Send RFQ to selected suppliers',exact:true})
   const send=panel.getByRole('button',{name:'Send PNG + Caption to 3 Suppliers',exact:true})
   await send.waitFor();assert.equal(await panel.locator('input[type="checkbox"]:checked').count(),3)
   await panel.getByRole('button',{name:'Clear selection',exact:true}).click()
   assert.equal(await panel.getByRole('button',{name:'Send PNG + Caption to 0 Suppliers',exact:true}).isDisabled(),true)
   await panel.getByLabel('Send RFQ to '+supplier.name,{exact:true}).check()
   await panel.getByLabel('Send RFQ to '+thirdSupplier.name,{exact:true}).check()
   assert.equal(await panel.getByRole('button',{name:'Send PNG + Caption to 2 Suppliers',exact:true}).isEnabled(),true)
   await panel.getByRole('button',{name:'Select all pending',exact:true}).click()
   await send.dblclick()
   await panel.getByText('2 / 3 requests accepted for sending.',{exact:false}).waitFor()
   assert.equal(rfqGatewayRequests.length,3,'One batch sends one PNG/caption per chosen supplier, despite double clicking')
   assert.deepEqual(rfqGatewayRequests.map(r=>r.supplierId),directory.map(s=>s.id))
   for(const [i,request] of rfqGatewayRequests.entries())assert.ok(request.caption.includes(directory[i].name),'Each caption names its own supplier')
   assert.equal(new Set(rfqGatewayRequests.map(r=>r.pngBase64)).size,3,'Each supplier receives their own RFQ PNG')
   await panel.getByText('Fixture definite rejection',{exact:true}).waitFor()
   await panel.getByRole('button',{name:'Select all pending',exact:true}).click()
   assert.equal(await panel.locator('input[type="checkbox"]:checked').count(),0,'Existing attempts cannot be resent automatically')
   assert.equal(await panel.getByRole('button',{name:'Send PNG + Caption to 0 Suppliers',exact:true}).isDisabled(),true)
   await page.screenshot({path:'test-results/bulk-supplier-send-'+width+'.png'})
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}))
   assert.ok(dimensions.scroll<=dimensions.width+1,'Bulk supplier sending has no horizontal overflow')
   if(width===320){
    rfqDispatches.length=0;rfqGatewayRequests.length=0
    await page.reload();await page.locator('.app').waitFor();await navigate('Q RFQs & Quotes');await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
    await send.waitFor()
    bulkReady=false;await panel.getByRole('button',{name:'Refresh status',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.rfq-bulk-send-button')?.disabled===true)
    assert.equal(rfqGatewayRequests.length,0,'Disconnected gateway sends nothing')
    bulkReady=true;await panel.getByRole('button',{name:'Refresh status',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.rfq-bulk-send-button')?.disabled===false)
    await panel.getByLabel('Send RFQ to '+newSupplier.name,{exact:true}).uncheck()
    await panel.getByRole('button',{name:'Send PNG + Caption to 2 Suppliers',exact:true}).click()
    await panel.getByText('2 / 2 requests accepted for sending.',{exact:false}).waitFor()
    assert.deepEqual(rfqGatewayRequests.map(r=>r.supplierId),[supplier.id,thirdSupplier.id],'Unchecked suppliers receive neither caption nor image')
   }
   console.log('PASS checklist, all/partial selection, one-click PNG/caption batch, supplier-specific images, partial failure and no duplicate retries at '+width+'px')
   await context.close();continue
  }
  assert.equal(await page.getByRole('button',{name:'Go back',exact:true}).isDisabled(),true,'Initial screen has no back entry')
  assert.equal(await page.getByRole('button',{name:'Go forward',exact:true}).isDisabled(),true,'Initial screen has no forward entry')
  await navigate('✓ Stock Entry')
  const historyStockInput=page.locator('.stock-fast-panel input[inputmode="decimal"]').filter({visible:true}).first()
  await historyStockInput.waitFor()
  await historyStockInput.fill('8')
  await page.getByRole('button',{name:'Submit Stock · 1',exact:true}).click()
  const stockDialog=page.getByRole('dialog',{name:'Submit stock count',exact:true})
  await stockDialog.waitFor()
  await page.screenshot({path:'test-results/stock-confirmation-'+width+'.png'})
  assert.equal(await page.locator('[inert]').count(),1)
  await stockDialog.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(stockSubmissions.length,0,'Cancel leaves the stock draft unchanged')
  assert.equal(await historyStockInput.inputValue(),'8')
  await page.getByRole('button',{name:'Submit Stock · 1',exact:true}).click()
  await stockDialog.getByRole('button',{name:'Submit stock',exact:true}).click()
  await page.getByRole('heading',{name:'Procurement Review',exact:true}).waitFor()
  assert.equal(stockSubmissions.length,1)
  assert.equal(stockSubmissions[0].p_lines[0].current_stock,8)
  const guide=page.getByRole('navigation',{name:'Guided procurement navigation',exact:true})
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'2','Stock submission automatically advances to Review')
  if(process.env.GH_UI_GUIDE_APPROVAL==='1'){
   rfqItemCount=1
   await page.getByRole('button',{name:'Select All Visible',exact:true}).click()
   await page.getByRole('button',{name:'Approve & Continue',exact:true}).click()
   const builder=page.locator('.rfq-builder')
   await builder.waitFor()
   assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'3','Approval advances to the supplier builder')
   await builder.getByLabel(supplier.name,{exact:true}).check()
   await builder.getByPlaceholder('Required override reason',{exact:true}).fill('Guided workflow test supplier')
   await builder.getByRole('button',{name:'Create RFQ & Continue',exact:true}).click()
   await page.getByRole('heading',{name:'RFQ-FIXTURE',exact:true}).waitFor()
   assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'3','Creation opens the exact RFQ at the sending step')
   await page.locator('.rfq-individual-options > summary').click()
   await page.getByRole('button',{name:'Confirm Sent',exact:true}).click()
   await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('[aria-label="Go to procurement section"]')?.value==='4')
   const price=page.locator('[data-rfq-price-item]').filter({visible:true}).first()
   await price.waitFor();await price.fill('05');assert.equal(await price.inputValue(),'5');await price.fill('123.45')
   if(width<760){const row=page.locator('.quote-bill-row').first();assert.ok((await row.boundingBox()).height<160,'Long item stays compact');await row.locator('summary').click();await row.getByRole('button',{name:'+ Add size variation',exact:true}).click();await row.getByPlaceholder('e.g. 1½ inch').fill('2 feet');await row.getByPlaceholder('Price',{exact:true}).fill('40');await row.getByLabel('Additional size required quantity',{exact:true}).fill('6');await page.screenshot({path:'test-results/compact-quote-variation-'+width+'.png'});await row.getByRole('button',{name:'Remove size',exact:true}).click();await row.locator('summary').click()}
   await page.getByRole('button',{name:/^Save & (Next Supplier|Compare Prices)/}).click()
   await page.waitForFunction(()=>document.querySelector('[aria-label="Go to procurement section"]')?.value==='5')
   await page.getByRole('button',{name:'Review & Create Supplier Orders',exact:true}).click()
   await page.locator('.award-review').waitFor()
   assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'6')
   assert.ok(!queries.some(u=>u.pathname.endsWith('/proc_finalize_award_plan_v2')),'Guided Next never creates an order without final confirmation')
   await page.screenshot({path:'test-results/six-step-award-'+width+'.png'})
   console.log('PASS complete guided stock → approval → exact RFQ → sent → quote save → comparison → order review at '+width+'px')
   await context.close();continue
  }

  await guide.getByRole('button',{name:'Previous procurement step',exact:true}).click()
  await page.getByRole('button',{name:'Continue to Procurement Review →',exact:true}).waitFor()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.screenshot({path:'test-results/stock-next-step-'+width+'.png'})
  await historyStockInput.fill('8')
  await guide.getByRole('button',{name:'Next procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'2')
  await guide.getByRole('button',{name:'Next procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'3','Next enters the RFQ section on the same screen')
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'2','History Back restores the previous guided section')
  await guide.getByLabel('Go to procurement section',{exact:true}).selectOption('1')
  assert.equal(await historyStockInput.inputValue(),'8','Guided navigation preserves unsent stock entries')
  await guide.getByLabel('Go to procurement section',{exact:true}).selectOption('4')
  await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
  await guide.getByRole('button',{name:'Next procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'5')
  await page.getByRole('region',{name:'Scrollable supplier prices',exact:true}).waitFor()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.screenshot({path:'test-results/guided-comparison-'+width+'.png'})
  await guide.getByRole('button',{name:'Previous procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).inputValue(),'4')
  await guide.getByLabel('Go to procurement section',{exact:true}).selectOption('1')
  console.log('PASS six-step guide, automatic Review, Back/Next, section jumping and preserved drafts at '+width+'px')
  if(process.env.GH_UI_STOCK_ONLY==='1'){await context.close();continue}

  await navigate('Q RFQs & Quotes')
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await page.getByRole('heading',{name:'Stock Entry',exact:true}).first().waitFor()
  assert.equal(await historyStockInput.inputValue(),'8','Back keeps the mounted stock draft')
  await page.getByRole('button',{name:'Go forward',exact:true}).click()
  await page.getByRole('heading',{name:'RFQs & Quotes',exact:true}).first().waitFor()
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  await navigate('PO Orders')
  assert.equal(await page.getByRole('button',{name:'Go forward',exact:true}).isDisabled(),true,'New navigation clears the forward branch')
  await navigate('⌂ Home')
  console.log('PASS in-app back/forward, draft preservation and branched history at '+width+'px')
  await navigate('⚙ Admin')
  const adminPanels=page.locator('details.admin-accordion > summary')
  await adminPanels.first().waitFor()
  assert.ok(await adminPanels.count()>=8,'Admin sections are short expandable rows')
  assert.equal(await page.locator('details.admin-accordion[open]').count(),0,'Admin starts collapsed')
  await adminPanels.filter({hasText:/^Invite User$/}).click()
  await page.getByPlaceholder('Staff name',{exact:true}).fill('Fixture staff')
  await page.getByPlaceholder('user@example.com',{exact:true}).fill('staff@example.invalid')
  await page.getByRole('button',{name:'Generate setup link',exact:true}).click()
  const setupInput=page.getByLabel('One-time setup link for staff@example.invalid',{exact:true})
  await setupInput.waitFor()
  assert.equal(await setupInput.inputValue(),'https://auth.example.invalid/verify?token=fixture-setup-only')
  assert.equal(setupRequests.length,1)
  assert.equal(await page.getByRole('button',{name:'Copy setup link',exact:true}).isEnabled(),true)
  assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}).includes('fixture-setup-only')),false,'Setup token stays out of persisted browser storage')
  await page.getByRole('button',{name:'Dismiss',exact:true}).click()
  assert.equal(await setupInput.count(),0,'Admin can clear sensitive link from screen')
  await page.getByRole('button',{name:'Generate link',exact:true}).click()
  await setupInput.waitFor()
  assert.equal(setupRequests.length,2,'Pending invitations can generate a fresh setup link')
  await page.screenshot({path:'test-results/'+width+'-setup-link.png',fullPage:true})
  await page.getByRole('button',{name:'Dismiss',exact:true}).click()
  console.log('PASS admin setup-link generation, fresh pending link and token storage isolation at '+width+'px')
  await adminPanels.filter({hasText:/^Users$/}).click()
  assert.equal(await page.locator('details.admin-accordion[open]').count(),1,'Opening Users closes Invite User')
  const mobileUsers=width<=760
  const staffRow=page.locator('.admin-user-row').filter({hasText:'Fixture staff'})
  if(mobileUsers){
   assert.equal(await page.locator('.admin-users-mobile').isVisible(),true,'Mobile directory uses a compact row list')
   assert.equal(await page.locator('.admin-users-desktop').isVisible(),false,'Clipped desktop table is absent on mobile')
   assert.equal(await page.locator('.admin-user-row').count(),2,'Each user takes only one collapsed row')
   const rect=await page.locator('.admin-users-mobile').boundingBox()
   assert.ok(rect&&rect.x>=0&&rect.x+rect.width<=width+1,'Staff list fits the mobile viewport')
   await page.locator('.admin-user-row').filter({hasText:'Fixture Administrator'}).locator('summary').click()
  }
  assert.equal(await page.getByRole('button',{name:'Delete user Fixture Administrator',exact:true}).isDisabled(),true)
  if(mobileUsers)await staffRow.locator('summary').click()
  const staffReset=page.getByRole('button',{name:'Generate Reset Link',exact:true}).filter({visible:true})
  await staffReset.last().click()
  const recovery=page.getByLabel('Generated recovery link',{exact:true})
  await recovery.waitFor()
  assert.match(await recovery.inputValue(),/token_hash=fixture-reset&type=recovery/)
  assert.equal(resetLinkRequests.length,1,'Recovery uses the admin edge function once')
  assert.equal(setupRequests.length,2,'Recovery does not create or re-invite the staff member')
  assert.equal(await page.getByRole('button',{name:'Copy link',exact:true}).isEnabled(),true)
  await page.getByRole('button',{name:'Dismiss',exact:true}).click()
  assert.equal(await recovery.count(),0,'Sensitive recovery links can be dismissed')
  await page.getByRole('button',{name:'Delete user Fixture staff',exact:true}).click()
  const deleteDialog=page.getByRole('dialog',{name:'Delete user · Fixture staff',exact:true})
  await deleteDialog.getByText('⚠ Warning · delete user',{exact:true}).waitFor()
  await deleteDialog.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(deleteRequests.length,0,'Cancel does not delete a user')
  await page.getByRole('button',{name:'Delete user Fixture staff',exact:true}).click()
  const deleteButton=deleteDialog.getByRole('button',{name:'Confirm delete user',exact:true})
  assert.equal(await deleteButton.isDisabled(),true)
  await page.getByLabel('Delete user confirmation',{exact:true}).fill('DELETE WRONG')
  assert.equal(await deleteButton.isDisabled(),true)
  await page.getByLabel('Delete user confirmation',{exact:true}).fill('DELETE Fixture staff')
  await deleteButton.click()
  await deleteDialog.getByText('Fixture delete failure',{exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Delete user Fixture staff',exact:true}).count(),1,'Failure retains the user')
  await deleteButton.click()
  await deleteDialog.waitFor({state:'hidden'})
  assert.equal(await page.getByRole('button',{name:'Delete user Fixture staff',exact:true}).count(),0,'Deleted user leaves the list')
  assert.equal(deleteRequests.length,2)
  await page.screenshot({path:'test-results/'+width+'-user-deleted.png',fullPage:true})
  console.log('PASS recovery setup, protected deletion, cancellation, failure/retry and user-list removal at '+width+'px')
  await adminPanels.filter({hasText:/^Data Management$/}).click()
  assert.equal(await page.locator('details.admin-accordion[open]').count(),1,'Opening Data Management closes Users')
  await page.getByRole('heading',{name:'Data Management · Admin only',exact:true}).waitFor()
  await page.getByRole('button',{name:'Preview affected records',exact:true}).click()
  await page.getByLabel('Reset confirmation',{exact:true}).waitFor()
  const resetButton=page.getByRole('button',{name:'Reset system to zero',exact:true})
  assert.equal(await resetButton.isDisabled(),true,'Reset requires exact confirmation and reason')
  await page.getByLabel('Reset reason',{exact:true}).fill('Fixture reset review')
  await page.getByLabel('Reset confirmation',{exact:true}).fill('CLEAR WRONG')
  assert.equal(await resetButton.isDisabled(),true,'Wrong reset phrase cannot execute')
  await page.getByLabel('Reset confirmation',{exact:true}).fill('CLEAR FULL')
  assert.equal(await resetButton.isEnabled(),true,'Complete review permits a subsequent confirmation')
  const labels={full:'Reset system to zero',procurement:'Clear procurement records',stock:'Reset current stock to zero',lists:'Clear company lists'}
  for(const scope of ['full','procurement','stock','lists']){
   if(scope!=='full'){
    await page.getByLabel('Reset option',{exact:true}).selectOption(scope)
    await page.getByRole('button',{name:'Preview affected records',exact:true}).click()
    await page.getByLabel('Reset confirmation',{exact:true}).fill('CLEAR '+scope.toUpperCase())
   }
   await page.getByRole('button',{name:labels[scope],exact:true}).click()
   const warning=page.getByRole('alertdialog',{name:labels[scope],exact:true})
   await warning.getByText('Warning · confirmation required',{exact:true}).waitFor()
   assert.equal(await warning.getByRole('button',{name:'Cancel',exact:true}).evaluate(el=>el===document.activeElement),true,'Cancel receives initial focus')
   assert.equal(await page.locator('[inert]').count(),1,'Background controls are inert during confirmation')
   assert.equal(destructiveRequests.length,0,'Opening a warning does not reset records')
   await page.screenshot({path:'test-results/'+width+'-warning-'+scope+'.png'})
   await warning.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(destructiveRequests.length,0,'Cancel never calls the reset endpoint')
  }
  await page.getByLabel('Reset option',{exact:true}).selectOption('full')
  await page.getByRole('button',{name:'Preview affected records',exact:true}).click()
  await page.getByLabel('Reset confirmation',{exact:true}).fill('CLEAR FULL')
  await resetButton.click()
  await page.keyboard.press('Escape')
  assert.equal(destructiveRequests.length,0,'Escape cancels without resetting')
  await resetButton.click()
  const resetWarning=page.getByRole('alertdialog',{name:labels.full,exact:true})
  await resetWarning.getByRole('button',{name:'Confirm reset',exact:true}).click()
  await resetWarning.getByText('Fixture operation blocked',{exact:true}).waitFor()
  assert.equal(destructiveRequests.length,1,'Only the final red button calls reset')
  assert.equal(destructiveRequests[0].body.p_confirmation,'CLEAR FULL')
  await resetWarning.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByLabel('Reset option',{exact:true}).selectOption('stock')
  assert.equal(await page.getByLabel('Reset confirmation',{exact:true}).count(),0,'Changing reset scope invalidates the preview')
  assert.equal(destructiveRequests.length,1,'Changing options does not execute another reset')
  await navigate('⌂ Home')
  console.log('PASS four reset warnings, Cancel/Escape, inert background, final confirmation and error feedback at '+width+'px')

  for(const [card,heading,table,field,value] of [
   ['Active items','Items','proc_search_item_master_v2',null,null],
   ['Open requirements','Review','proc_v_requirements',null,null],
   ['Still to order','Review','proc_v_requirements','remaining_to_order','gt.0'],
   ['Awaiting receipt','Review','proc_v_requirements','ordered_not_received','gt.0'],
   ['Open POs','Orders','proc_purchase_orders','status','in.(pending_approval,approved,sent,partially_received)'],
   ['PO value','Orders','proc_purchase_orders','status','neq.cancelled'],
   ['Invoice variances','Invoices','proc_supplier_invoices','status','eq.variance'],
   ['Stock checks due','Stock Entry','proc_v_stock_check_due','is_due','eq.true'],
   ['Urgent actions','Exceptions','proc_v_urgent_actions',null,null]
  ]){
   queries.length=0
   await page.getByRole('button',{name:card,exact:true}).click()
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
   if(heading==='Stock Entry'){
    await page.getByText('Draft saved to your account.',{exact:true}).waitFor()
    draftSaveFailure=true
    const stockInput=page.locator('.stock-fast-panel input[inputmode="decimal"]').filter({visible:true}).first()
    await stockInput.fill('7')
    await page.getByText('Saved on this device · account sync failed.',{exact:true}).waitFor()
    assert.equal(await page.evaluate(id=>JSON.parse(localStorage.getItem('gh-stock-count-draft:'+id)).entry['00000000-0000-4000-8000-000000000003'],id),'7','Failed sync retains local input')
    draftSaveFailure=false
    await page.getByRole('button',{name:'Retry draft save',exact:true}).click()
    await page.getByText('Draft saved to your account.',{exact:true}).waitFor()
    assert.equal(draftSaves.at(-1).entry[item.item_id],'7','Retry persists the latest input')
    assert.equal(await stockInput.inputValue(),'7','Retry keeps the typed quantity')
   }
   await page.waitForFunction(()=>!document.querySelector('.login-shell'))
   await requireQuery(u=>u.pathname.endsWith('/'+table)&&(!field||u.searchParams.get(field)===value),card+' must query its matching records')
   if(card==='Stock checks due')assert.ok(queries.some(u=>u.pathname.endsWith('/'+table)&&u.searchParams.get('is_due')==='eq.true'&&!u.searchParams.has('category')&&!u.searchParams.has('movement')),'Due shortcut includes all categories and movements')
   await navigate('⌂ Home')
  }
  if(width===320){
   exceptionFixtures=true
   await navigate('! Exceptions')
   const queue=page.locator('.card').filter({has:page.getByRole('heading',{name:'Priority Queue',exact:true})})
   await queue.getByRole('button',{name:'Refresh',exact:true}).click()
   await queue.getByText('1011 active action(s)',{exact:true}).waitFor()
   await queue.locator('select').nth(1).selectOption('customer_paid')
   await queue.getByRole('heading',{name:'Exception fixture 1011',exact:true}).waitFor()
   const jobs=page.locator('.card').filter({has:page.getByRole('heading',{name:'Automation Exceptions',exact:true})})
   await jobs.getByText('601 open',{exact:true}).waitFor()
   const jobPages=jobs.getByRole('navigation',{name:'Automation exceptions pages'})
   for(let i=0;i<4;i++)await jobPages.getByRole('button',{name:'Next',exact:true}).click()
   await jobPages.getByText('Automation exceptions: 201–250 of 601',{exact:true}).waitFor()
   await navigate('⇩ Receive Goods')
   const rejected=page.locator('.card').filter({has:page.getByRole('heading',{name:'Rejected Goods Follow-up',exact:true})})
   await rejected.getByRole('button',{name:'Refresh',exact:true}).click()
   await rejected.getByText('601 open',{exact:true}).waitFor()
   const casePages=rejected.getByRole('navigation',{name:'Rejected goods pages'})
   for(let i=0;i<10;i++)await casePages.getByRole('button',{name:'Next',exact:true}).click()
   await rejected.getByText('GRN-501 · PO-501 · Fixture supplier',{exact:true}).waitFor()
   exceptionFixtures=false
   console.log('PASS urgent filters beyond 1000, automation beyond 200 and rejected goods beyond 500 with bounded rendering')
   await navigate('⌂ Home')
  }
  await navigate('□ Items')
  await page.getByText('FIXTURE-ITEM',{exact:true}).filter({visible:true}).first().waitFor()
  const itemDetails=page.locator('section:not([hidden]) summary').filter({hasText:'More details'}).filter({visible:true}).first()
  if(await itemDetails.count())await itemDetails.click()
  await page.getByRole('button',{name:'Delete item',exact:true}).filter({visible:true}).first().click()
  const itemWarning=page.getByRole('alertdialog',{name:'Delete item',exact:true})
  const confirmItem=itemWarning.getByRole('button',{name:'Confirm delete item',exact:true})
  assert.equal(await confirmItem.isDisabled(),true)
  await itemWarning.getByLabel('Warning confirmation',{exact:true}).fill('WRONG')
  assert.equal(await confirmItem.isDisabled(),true)
  await itemWarning.getByRole('button',{name:'Cancel',exact:true}).click()
  assert.equal(destructiveRequests.filter(r=>r.name==='proc_admin_delete_item_v1').length,0)
  await page.getByRole('button',{name:'Delete item',exact:true}).filter({visible:true}).first().click()
  await itemWarning.getByLabel('Warning confirmation',{exact:true}).fill('FIXTURE-ITEM')
  await confirmItem.click()
  await itemWarning.getByText('Fixture operation blocked',{exact:true}).waitFor()
  assert.equal(destructiveRequests.filter(r=>r.name==='proc_admin_delete_item_v1').length,1)
  await itemWarning.getByRole('button',{name:'Cancel',exact:true}).click()
  await navigate('⌂ Home')

  for(const [button,heading,table,field] of [['Overdue supplier requests','RFQs & Quotes','proc_rfqs','due_date'],['Overdue purchase orders','Orders','proc_purchase_orders','expected_date']]){
   const overdueToggle=page.getByRole('button',{name:'Overdue actions',exact:true})
   if(await overdueToggle.getAttribute('aria-expanded')!=='true')await overdueToggle.click()
   queries.length=0
   await page.getByRole('button',{name:new RegExp('^'+button)}).click()
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
   await requireQuery(u=>u.pathname.endsWith('/'+table)&&u.searchParams.get(field)?.startsWith('lt.')&&u.searchParams.get('status')==='in.(sent,partially_received)'.replace('partially_received',table==='proc_rfqs'?'partially_quoted':'partially_received'),button+' must filter by due date and active status')
   await navigate('⌂ Home')
  }
  await page.screenshot({path:'test-results/'+width+'-Dashboard.png',fullPage:true})
  for(const [label,heading] of [['✓ Stock Entry','Stock Entry'],['≡ Review','Review'],['Q RFQs & Quotes','RFQs & Quotes'],['PO Orders','Orders'],['⇩ Receive Goods','Receive Goods']]){
   if(heading==='Orders')poFixtureStatus='approved'
   if(heading==='Receive Goods')poFixtureStatus='sent'
   await navigate(label)
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
   if(heading==='Review'){
    await page.getByRole('button',{name:item.description+' · '+item.size,exact:true}).filter({visible:true}).first().click()
    await page.getByRole('heading',{name:item.description+' · '+item.size,exact:true}).waitFor()
    await page.locator('.modal').getByRole('button',{name:'Close',exact:true}).click()
   }
   if(heading==='RFQs & Quotes'){
    await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
    await page.getByText('Only enter the supplier\'s unit price.',{exact:false}).waitFor()
    await page.getByRole('button',{name:'View Price Comparison',exact:true}).click()
    await page.getByRole('heading',{name:'Supplier Price Comparison',exact:true}).waitFor()
    assert.ok(await page.getByRole('heading',{name:'Supplier Price Comparison',exact:true}).evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('.topbar').getBoundingClientRect().bottom),'Comparison shortcut clears the sticky header')
    await page.getByRole('button',{name:'Back to Price Entry',exact:true}).click()
    assert.ok(await page.getByLabel('Search supplier price entry',{exact:true}).evaluate(el=>el.getBoundingClientRect().top>=document.querySelector('.topbar').getBoundingClientRect().bottom),'Price entry shortcut clears the sticky header')
    const sheet=page.getByRole('region',{name:'Scrollable supplier prices',exact:true})
    assert.equal(await sheet.locator('tbody tr').count(),100,'Comparison keeps every RFQ item')
    assert.equal(await sheet.locator('.rfq-best-price').count(),1,'Single valid quote is highlighted')
    await page.getByLabel('Comparison filter',{exact:true}).selectOption('missing')
    assert.equal(await sheet.locator('tbody tr').count(),99,'Missing items are explicit')
    await page.getByLabel('Comparison filter',{exact:true}).selectOption('all')
    await page.getByLabel('Search comparison items',{exact:true}).fill('Bathroom fixture 99')
    assert.equal(await sheet.locator('tbody tr').count(),1,'Comparison search finds sparse items')
    await page.getByLabel('Search comparison items',{exact:true}).fill('')
    await page.getByLabel('Comparison filter',{exact:true}).selectOption('single')
    assert.equal(await sheet.locator('tbody tr').count(),1,'Single quote filter handles a sparse 100-item request')
    await page.getByLabel('Comparison filter',{exact:true}).selectOption('all')
    await page.locator('summary').filter({hasText:'Choose request items'}).click()
    await page.getByLabel('Request category',{exact:true}).selectOption('BATHROOM')
    await page.getByRole('button',{name:'Use Visible Items Only',exact:true}).click()
    await page.getByRole('button',{name:'Save Request Items',exact:true}).click()
    await page.getByText('Supplier request items saved.',{exact:false}).waitFor()
    assert.equal(invitations[0].requested_item_ids.length,99,'A bathroom-only request saves every matching item')
    assert.ok(!invitations[0].requested_item_ids.includes('00000000-0000-4000-8000-000000000008'),'A bathroom-only request excludes general hardware')
    if(width===320){
     await page.locator('.rfq-individual-options > summary').click()
     await page.getByRole('button',{name:'Send Request',exact:true}).click()
     const pdfDownload=page.waitForEvent('download')
     await page.getByRole('button',{name:'RFQ PDF',exact:true}).click()
     const pdf=await pdfDownload
     const pdfBytes=await readFile(await pdf.path())
     assert.ok(pdf.suggestedFilename().endsWith('.pdf'))
     assert.ok(pdfBytes.subarray(0,5).toString()==='%PDF-')
     const pdfContent=pdfBytes.toString('latin1')
     assert.ok(pdfContent.includes('Bathroom fixture 99'),'PDF includes the last selected item')
     assert.ok(!pdfContent.includes('Fixture hardware'),'PDF excludes the unselected general item')
     await writeFile('test-results/exported-bathroom-rfq.pdf',pdfBytes)
     const pngDownload=page.waitForEvent('download')
     await page.getByRole('button',{name:'Download PNG Only',exact:true}).click()
     const png=await pngDownload
     const pngBytes=await readFile(await png.path())
     assert.ok(png.suggestedFilename().endsWith('.png'))
     assert.equal(pngBytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
     assert.ok(pngBytes.readUInt32BE(16)>0&&pngBytes.readUInt32BE(20)>1000,'Supplier PNG contains the long item list')
     await writeFile('test-results/exported-bathroom-rfq.png',pngBytes)
     assert.equal(context.pages().length,1,'Download actions do not open a supplier chat')
     await page.getByRole('button',{name:'Send Request',exact:true}).click()
     console.log('PASS actual selective supplier RFQ PDF and PNG downloads under nonce CSP')
    }
    const newSelect=page.getByLabel('New supplier',{exact:true})
    const quoteSelect=page.getByLabel('Supplier',{exact:true})
    await quoteSelect.locator('option[value="'+supplier.id+'"]').waitFor({state:'attached'})
    assert.equal(await quoteSelect.locator('option').count(),1,'Directory suppliers are not implicitly invited')
    directory=[supplier,newSupplier]
    await page.getByRole('button',{name:'Refresh Suppliers',exact:true}).click()
    await newSelect.locator('option[value="'+newSupplier.id+'"]').waitFor({state:'attached'})
    await page.getByLabel('Price entry filter',{exact:true}).selectOption('all')
    const price=page.locator('[data-rfq-price-item]').filter({visible:true}).first()
    const attachment=page.locator('.content > section:not([hidden]) input[type="file"]').first()
    const quotePdf=new jsPDF()
    quotePdf.setFontSize(12)
    quotePdf.text('Supplier quotation - generated extraction test document',15,20)
    quotePdf.text(item.description+' '+item.size+' PCS 123.45',15,40)
    const pdfBuffer=Buffer.from(quotePdf.output('arraybuffer'))
    await attachment.setInputFiles({name:'generated-quotation.pdf',mimeType:'application/pdf',buffer:pdfBuffer})
    await page.getByRole('button',{name:'Read Prices Automatically',exact:true}).click()
    await page.getByText('1 quotation line(s) matched automatically.',{exact:false}).waitFor({timeout:60000})
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Reading quotation…'))
    assert.equal(await price.inputValue(),'123.45','Real PDF.js extraction imports the generated quotation')
    if(width===320){
     await writeFile('test-results/generated-quotation.pdf',pdfBuffer)
     const longPdf=new jsPDF()
     for(let n=1;n<41;n++)longPdf.addPage()
     await attachment.setInputFiles({name:'41-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(longPdf.output('arraybuffer'))})
     await page.getByRole('button',{name:'Read Prices Automatically',exact:true}).click()
     await page.getByText('This PDF has 41 pages.',{exact:false}).waitFor()
     assert.equal(await price.inputValue(),'123.45','An oversized PDF cannot silently replace draft prices')
     const encoded=await page.evaluate(text=>{
      const canvas=document.createElement('canvas');canvas.width=2000;canvas.height=650
      const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,2000,650)
      ctx.fillStyle='#000';ctx.font='38px Arial';ctx.fillText('Supplier quotation',50,90)
      ctx.fillText(text,50,180)
      return canvas.toDataURL('image/png').split(',')[1]
     },item.description+' '+item.size+' PCS 123.45')
     const pngBuffer=Buffer.from(encoded,'base64')
     await writeFile('test-results/generated-quotation.png',pngBuffer)
     await attachment.setInputFiles({name:'generated-quotation.png',mimeType:'image/png',buffer:pngBuffer})
     await price.fill('')
     await page.getByRole('button',{name:'Read Prices Automatically',exact:true}).click()
     await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return input?.value==='123.45'&&!input.disabled},{},{timeout:120000})
     assert.equal(await price.inputValue(),'123.45','Real Tesseract image OCR imports the generated quotation')
     const scanPdf=new jsPDF({orientation:'landscape',unit:'px',format:[2000,650]})
     scanPdf.addImage('data:image/png;base64,'+encoded,'PNG',0,0,2000,650)
     const scannedBuffer=Buffer.from(scanPdf.output('arraybuffer'))
     await writeFile('test-results/generated-scanned-quotation.pdf',scannedBuffer)
     await attachment.setInputFiles({name:'generated-scanned-quotation.pdf',mimeType:'application/pdf',buffer:scannedBuffer})
     await price.fill('')
     await page.getByRole('button',{name:'Read Prices Automatically',exact:true}).click()
     await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return input?.value==='123.45'&&!input.disabled},{},{timeout:120000})
     assert.equal(await price.inputValue(),'123.45','Scanned PDF rendering and OCR preserve the quotation rate')
     console.log('PASS real text PDF, image OCR and scanned-PDF quotation extraction; no silent PDF truncation')
    }
    await price.fill('123.45')
    const addSize=page.getByRole('button',{name:'+ Add size variation',exact:true}).filter({visible:true})
    if(!await addSize.count())await page.locator('.mobile-card-list details > summary').filter({visible:true}).first().click()
    await addSize.first().click()
    await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).filter({visible:true}).first().fill('3 inch')
    const alternatives=page.locator('.formgrid').filter({has:page.getByPlaceholder('e.g. 1½ inch',{exact:true})}).filter({visible:true}).first()
    await alternatives.getByPlaceholder('Price',{exact:true}).fill('57')
    assert.equal(await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).first().inputValue(),'3 inch','Adding an alternative size does not crash the RFQ')
    await page.getByLabel('Search supplier price entry',{exact:true}).fill('Bathroom fixture 99')
    const sparsePrice=page.locator('input[placeholder="Price"],input[placeholder="Rs."]').filter({visible:true}).first()
    await sparsePrice.fill('88')
    await page.getByLabel('Search supplier price entry',{exact:true}).fill(item.description)
    assert.equal(await price.inputValue(),'123.45','Search preserves hidden price drafts')
    await page.getByLabel('Search supplier price entry',{exact:true}).fill('')

    await newSelect.selectOption(newSupplier.id)
    await page.getByRole('button',{name:'Add to RFQ',exact:true}).click()
    await page.getByText('Fixture invitation failure',{exact:true}).waitFor()
    assert.equal(await quoteSelect.locator('option').count(),1,'Failed additions do not create phantom suppliers')
    assert.equal(await price.inputValue(),'123.45','Failed additions preserve price drafts')
    addFailure=false
    await page.getByRole('button',{name:'Add to RFQ',exact:true}).click()
    await quoteSelect.locator('option[value="'+newSupplier.id+'"]').waitFor({state:'attached'})
    await page.evaluate(()=>{const channel=new BroadcastChannel('sb-huxhcjmcvlhblvpvrron-auth-token');channel.postMessage({event:'TOKEN_REFRESHED',session:JSON.parse(localStorage.getItem('sb-huxhcjmcvlhblvpvrron-auth-token'))});channel.close()})
    await page.waitForTimeout(500)
    assert.equal(await price.inputValue(),'123.45','Token refresh preserves unsaved quote input')
    assert.equal(await price.inputValue(),'123.45','Successful additions preserve the existing price draft')
    assert.equal(await quoteSelect.inputValue(),supplier.id,'Adding a supplier keeps the selected quotation')
    assert.equal(await newSelect.locator('option[value="'+newSupplier.id+'"]').count(),0,'Already invited suppliers cannot be selected again')
    await attachment.setInputFiles({name:'supplier-A.pdf',mimeType:'application/pdf',buffer:Buffer.from('Fixture attachment, never uploaded')})
    quoteReadFailure=newSupplier.id
    await quoteSelect.selectOption(newSupplier.id)
    await page.getByLabel('Price entry filter',{exact:true}).selectOption('all')
    await page.getByRole('button',{name:'Reload Supplier Prices',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:/^Save & (Next Supplier|Compare Prices)/}).isDisabled(),true,'Failed quote loads block overwriting existing prices')
    await page.getByRole('button',{name:'Reload Supplier Prices',exact:true}).click()
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'','The new supplier has a separate quotation')
    assert.equal(await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).count(),0,'Alternative sizes remain isolated to their supplier')
    assert.equal(await page.getByText('Selected attachment: supplier-A.pdf',{exact:true}).count(),0,'Attachments stay with their supplier')
    await price.fill('777')
    await quoteSelect.selectOption(supplier.id)
    await page.getByLabel('Price entry filter',{exact:true}).selectOption('all')
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'123.45','Switching suppliers restores unsaved prices')
    assert.equal(await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).first().inputValue(),'3 inch','Supplier draft restores alternative sizes')
    await page.getByText('Selected attachment: supplier-A.pdf',{exact:true}).waitFor()
    await quoteSelect.selectOption(newSupplier.id)
    await page.getByLabel('Price entry filter',{exact:true}).selectOption('all')
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'777','Each supplier retains its own draft')
    await page.getByRole('button',{name:/^Save & (Next Supplier|Compare Prices)/}).click()
    await page.getByText('1 supplier item price(s) saved.',{exact:false}).waitFor()
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await quoteSelect.inputValue(),newSupplier.id,'Saving does not return to the first supplier')
    assert.equal(await price.inputValue(),'777','The saved supplier quote reloads correctly')
    await quoteSelect.selectOption(supplier.id)
    await page.getByLabel('Price entry filter',{exact:true}).selectOption('all')
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    await attachment.setInputFiles([])
    await page.getByRole('button',{name:'Save & Next Supplier →',exact:true}).click()
    await page.waitForFunction(id=>document.querySelector('#rfq-quote-supplier')?.value===id,newSupplier.id)
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'777','Save automatically advances without overwriting the next supplier quote')
    await page.getByRole('button',{name:'+ Quick Create Supplier',exact:true}).click()
    await page.getByLabel('Supplier name',{exact:true}).fill('Quick RFQ Supplier')
    await page.getByLabel('Phone / WhatsApp',{exact:true}).fill('+94771234567')
    await page.getByRole('button',{name:'Create & Select Supplier',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('#rfq-add-supplier')?.value==='quick-created-supplier')
    assert.equal(await quoteSelect.inputValue(),newSupplier.id,'Quick creation preserves the current supplier quotation')

    await page.getByRole('button',{name:'View Price Comparison',exact:true}).click()
    await sheet.getByRole('button',{name:'Enter or edit price for '+item.description+' · '+item.size+' from '+supplier.name,exact:true}).click()
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await quoteSelect.inputValue(),supplier.id,'Tapping a comparison price selects its supplier')
    assert.equal(await price.inputValue(),'123.45','Tapping a comparison price retains the supplier draft')
    assert.ok((await page.getByLabel('Search supplier price entry',{exact:true}).inputValue()).includes(item.description),'Tapping a price searches for the corresponding item')
    await page.getByLabel('Search supplier price entry',{exact:true}).fill('')
    const orderCheckbox=sheet.locator('tbody tr').first().locator('input[type="checkbox"]')
    // This controlled checkbox updates after its server write succeeds.
    await orderCheckbox.click()
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>/^Save & (Next Supplier|Compare Prices)/.test(b.textContent)&&b.disabled))
    assert.equal(await orderCheckbox.isChecked(),false,'Excluded items update after the server confirms the write')
    await page.getByRole('button',{name:'Review & Create Supplier Orders',exact:true}).click()
    await page.getByText('Select at least one priced item to review. Your excluded items remain unticked.',{exact:true}).waitFor()
    assert.equal(await orderCheckbox.isChecked(),false,'Review cannot reselect an excluded priced item')
    await orderCheckbox.click()
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>/^Save & (Next Supplier|Compare Prices)/.test(b.textContent)&&b.disabled))
    assert.equal(await orderCheckbox.isChecked(),true,'Included items update after the server confirms the write')
    await page.getByRole('button',{name:'Review & Create Supplier Orders',exact:true}).click()
    await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
    await page.locator('.award-review').waitFor()
    assert.equal(await page.getByLabel('Award quantity for '+item.description+' · '+item.size,{exact:true}).inputValue(),'10','A one-quote item reaches the final quantity review')
    assert.ok(!queries.some(u=>u.pathname.endsWith('/proc_finalize_award_plan_v2')),'Opening the review does not create purchase orders')
    const reviewDimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}))
    assert.ok(reviewDimensions.scroll<=reviewDimensions.width+1,'Supplier order review overflows at '+width+': '+JSON.stringify(reviewDimensions))
    await page.locator('.award-review').getByRole('button',{name:'Close',exact:true}).click()

    const editableDimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}))
    assert.ok(editableDimensions.scroll<=editableDimensions.width+1,'Editable RFQ overflows at '+width+': '+JSON.stringify(editableDimensions))
    await page.screenshot({path:'test-results/'+width+'-RFQ-added-supplier.png',fullPage:true})
    grantedPermissions=permissions.filter(p=>p!=='procurement.rfq.manage')
    await page.reload()
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
    await navigate('Q RFQs & Quotes')
    await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
    await page.getByText('Only enter the supplier\'s unit price.',{exact:false}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Add to RFQ',exact:true}).count(),0,'Read-only users cannot add suppliers')
    assert.equal(await page.locator('.content > section:not([hidden]) .rfq-price-cell').count(),0,'Read-only users cannot edit through comparison cells')
    grantedPermissions=permissions
   }
   if(heading==='Receive Goods'){
    receivingManyRows=width<=700
    page.on('dialog',dialog=>dialog.accept())
    const selector=page.getByLabel('Purchase Order',{exact:true})
    await selector.selectOption(po.id)
    await page.getByLabel('Search receiving items',{exact:true}).waitFor()
    if(width<=700){
     const receivingRows=page.getByRole('region',{name:'Receiving item rows',exact:true})
     await receivingRows.locator('.receive-entry-row').first().waitFor()
     assert.equal(await receivingRows.locator('.receive-entry-row').count(),9,'Nine receiving items remain visible as rows')
     const heights=await receivingRows.locator('.receive-entry-row').evaluateAll(rows=>rows.map(r=>r.getBoundingClientRect().height))
     assert.ok(heights.every(h=>h<=110),'Closed receiving rows must be compact: '+heights.join(','))
     const firstRow=receivingRows.locator('.receive-entry-row').first()
     await firstRow.getByLabel('Received '+item.description+' · '+item.size,{exact:true}).fill('5')
     assert.equal(await firstRow.getByLabel('Accepted '+item.description+' · '+item.size,{exact:true}).inputValue(),'5','Row receipt entry preserves automatic acceptance')
     await firstRow.locator('summary').click()
     await firstRow.getByLabel('Rejected '+item.description+' · '+item.size,{exact:true}).fill('1')
     assert.equal(await firstRow.getByLabel('Accepted '+item.description+' · '+item.size,{exact:true}).inputValue(),'4','Expanded damage entry preserves acceptance math')
     await firstRow.getByLabel('Rejection reason '+item.description+' · '+item.size,{exact:true}).fill('Damaged packaging')
     await firstRow.locator('summary').click()
     console.log('PASS nine compact receiving rows, inline quantities and expandable rejection at '+width+'px')
    }
    const receivedInput=page.locator('.content > section:not([hidden]) input').filter({visible:true})
    // Draft survives a full page reload and retains the selected account/PO scope.
    await page.getByRole('button',{name:'✓ Mark All Remaining Received',exact:true}).click()
    await page.waitForFunction(()=>!!localStorage.getItem('gh_receiving_draft_v1:00000000-0000-4000-8000-000000000002:00000000-0000-4000-8000-000000000007'))
    await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await navigate('⇩ Receive Goods');await selector.selectOption(po.id)
    await page.getByLabel('Search receiving items',{exact:true}).waitFor()
    assert.equal(await page.locator('.receive-full-check input,.desktop-table tbody input[type="checkbox"]').filter({visible:true}).first().isChecked(),true,'Receiving values survive reload')
    for(const poId of [po.id,otherPo.id,po.id]){
     if(await selector.inputValue()!==poId){
      const loaded=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname.endsWith('/proc_po_lines')&&u.searchParams.get('po_id')==='eq.'+poId})
      await selector.selectOption(poId);await loaded
     }
     await page.getByLabel('Search receiving items',{exact:true}).waitFor()
     const savedAttempt=await page.evaluate(id=>JSON.parse(localStorage.getItem('gh_receiving_draft_v1:00000000-0000-4000-8000-000000000002:'+id)||'null')?.attempt,poId)
     if(savedAttempt)await page.getByText('A receipt attempt is saved.',{exact:false}).waitFor()
     else await page.getByRole('button',{name:'✓ Mark All Remaining Received',exact:true}).click()
     await page.getByRole('button',{name:'Post GRN',exact:true}).click()
     await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
     await page.getByText('Fixture receipt retry',{exact:true}).waitFor()
     await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Posting…'))
     await page.waitForTimeout(100)
    }
    assert.equal(receipts.length,3,'Three receiving attempts were issued')
    assert.notEqual(receipts[0].p_receipt_key,receipts[1].p_receipt_key,'Different POs get different receipt keys')
    assert.equal(receipts[0].p_receipt_key,receipts[2].p_receipt_key,'Retrying the same PO reuses its receipt key')
    receivingManyRows=false
   }
   if(heading==='Orders'){
    poFixtureStatus='approved';poLargeExport=width===320
    await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
    await page.getByRole('button',{name:'Clear this order',exact:true}).click()
    const orderWarning=page.getByRole('alertdialog',{name:'Clear purchase order',exact:true})
    const confirmOrder=orderWarning.getByRole('button',{name:'Confirm clear order',exact:true})
    await orderWarning.getByLabel('Warning confirmation',{exact:true}).fill(po.po_no)
    assert.equal(await confirmOrder.isDisabled(),true,'Clearing an order also requires a reason')
    await orderWarning.getByRole('button',{name:'Cancel',exact:true}).click()
    assert.equal(destructiveRequests.filter(r=>r.name==='proc_admin_clear_po_v1').length,0)
    await page.getByRole('button',{name:'Clear this order',exact:true}).click()
    await orderWarning.getByLabel('Warning confirmation',{exact:true}).fill(po.po_no)
    await orderWarning.getByLabel('Warning reason',{exact:true}).fill('Fixture order cleanup')
    await confirmOrder.click()
    await orderWarning.getByText('Fixture operation blocked',{exact:true}).waitFor()
    assert.equal(destructiveRequests.filter(r=>r.name==='proc_admin_clear_po_v1').length,1)
    await orderWarning.getByRole('button',{name:'Cancel',exact:true}).click()
    await page.locator('summary').filter({hasText:'Document & Sharing Options'}).click()
    await page.getByRole('button',{name:'Download PO PNG',exact:true}).waitFor({state:'visible'})
    if(width===320){
     await page.getByText('Supplier document fields',{exact:true}).click()
     assert.equal(await page.getByLabel('Description',{exact:true}).isChecked(),true)
     assert.equal(await page.getByLabel('Unit price',{exact:true}).isChecked(),false)
     const pdfDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click()
     const pdf=await pdfDownload,pdfBytes=await readFile(await pdf.path())
     assert.equal(pdfBytes.subarray(0,5).toString(),'%PDF-');assert.ok(pdfBytes.includes(Buffer.from('PO fixture 100')))
     assert.ok(!pdfBytes.includes(Buffer.from('Discount %')));assert.ok(!pdfBytes.includes(Buffer.from('Line total')));assert.ok(!pdfBytes.includes(Buffer.from('123.45')))
     await writeFile('test-results/exported-po-default.pdf',pdfBytes)
     const pngDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download PO PNG',exact:true}).click()
     const png=await pngDownload,pngBytes=await readFile(await png.path())
     assert.equal(pngBytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(pngBytes.readUInt32BE(20)>5000)
     await writeFile('test-results/exported-po-default.png',pngBytes)
     await page.getByLabel('Unit price',{exact:true}).check();await page.getByLabel('Size',{exact:true}).uncheck()
     const customDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Download PDF',exact:true}).click()
     const custom=await customDownload,customBytes=await readFile(await custom.path())
     assert.ok(customBytes.includes(Buffer.from('123.45')));assert.ok(!customBytes.includes(Buffer.from('2 inch')))
     await writeFile('test-results/exported-po-custom.pdf',customBytes)
     const preferences=await page.evaluate(()=>JSON.parse(localStorage.getItem('gh_po_supplier_fields_v1:00000000-0000-4000-8000-000000000002')))
     assert.equal(preferences.unit_price,true);assert.equal(preferences.size,false)
     await page.getByRole('button',{name:'Reset to quantity-only fields',exact:true}).click()
     let dialogNumber=0;const sendDialog=async d=>{dialogNumber++;await d.accept(d.type()==='prompt'?'PO fixture caption':undefined)}
     page.on('dialog',sendDialog)
     await page.getByRole('button',{name:'Send PO PNG + Caption',exact:true}).click()
     const captionDialog=page.getByRole('dialog',{name:'Caption for '+supplier.name,exact:true});await captionDialog.getByLabel('Message editor',{exact:true}).fill('PO fixture caption');await captionDialog.getByRole('button',{name:'Use message',exact:true}).click()
     await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
     await page.getByText('WhatsApp gateway accepted the PO image + caption.',{exact:false}).waitFor()
     page.off('dialog',sendDialog)
     assert.equal(dialogNumber,0);assert.equal(poGatewayRequests.length,1)
     assert.equal(poGatewayRequests[0].poId,po.id);assert.equal(poGatewayRequests[0].caption,'PO fixture caption')
     assert.equal(Buffer.from(poGatewayRequests[0].pngBase64,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a')
     assert.equal(poGatewayRequests[0].supplierId,undefined,'Recipient is resolved server-side from PO')
     console.log('PASS 100-item PO PDF/PNG exports, optional fields, preferences and mocked attached-caption dispatch')
    }
    poLargeExport=false
   }
   await page.screenshot({path:'test-results/'+width+'-'+heading.replaceAll(' ','-')+'.png',fullPage:true})
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}))
   assert.ok(dimensions.scroll<=dimensions.width+1,heading+' overflows at '+width+': '+JSON.stringify(dimensions))
   const clipped=await page.locator('button').evaluateAll(buttons=>buttons.filter(button=>{
    if(!button.getClientRects().length||button.closest('.tablewrap')||getComputedStyle(button).visibility==='hidden')return false
    const rect=button.getBoundingClientRect()
    return rect.left < -1 || rect.right > window.innerWidth+1
   }).map(button=>button.textContent.trim()))
   assert.deepEqual(clipped,[],heading+' has clipped buttons at '+width)

  }
  grantedPermissions=['dashboard.view','invoices.view']
  await page.reload()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  await navigate('▤ Invoices')
  await page.getByRole('button').filter({hasText:'INV-VARIANCE'}).click()
  assert.equal(await page.getByRole('button',{name:'Record Variance Action',exact:true}).count(),0,'Invoice viewers cannot open variance editing')
  grantedPermissions=['dashboard.view']
  await page.reload()
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
  assert.equal(await page.locator('.metric-link').count(),0,'Dashboard-only users have no inaccessible shortcuts')
  // The reported staff account is allowed Stock Check but not Dashboard.
  // Verify it opens Stock Check on sign-in rather than presenting a blank shell.
  currentProfile={...profile,display_name:'GH stock handler',role:'stock_handler',role_key:'stock_handler'}
  grantedPermissions=['stock.count.view','stock.count.enter','items.view']
  await page.reload()
  await page.getByRole('heading',{name:'Stock Entry',exact:true}).first().waitFor({timeout:15000})
  await page.locator('.stock-fast-panel input[inputmode="decimal"]').filter({visible:true}).first().waitFor({timeout:15000})
  assert.equal(await page.getByRole('button',{name:'⌂ Home',exact:true}).filter({visible:true}).count(),0,'Unauthorized dashboard must not appear in staff navigation')
  const stockArea=await page.locator('.content').innerText()
  assert.ok(stockArea.trim().length>80,'Authorized stock workspace displays useful content')
  const back=page.getByRole('button',{name:'Go back',exact:true})
  assert.equal(await back.isDisabled(),true,'Initial stock screen is a valid history root')
  await page.screenshot({path:'test-results/'+width+'-stock-handler-home.png',fullPage:true})
  console.log('PASS stock handler begins with populated stock view, no dashboard permission, and clean navigation at '+width+'px')
  if(width===320){
   currentProfile=profile;grantedPermissions=permissions;rfqItemCount=205
   await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
   await navigate('Q RFQs & Quotes')
   await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   await page.getByRole('button',{name:'View Price Comparison',exact:true}).click()
   const comparison=page.getByRole('region',{name:'Scrollable supplier prices',exact:true})
   assert.equal(await comparison.locator('tbody tr').count(),100)
   await page.getByRole('button',{name:'Next items',exact:true}).click()
   await page.getByText('Page 2 of 3',{exact:false}).waitFor()
   assert.equal(await comparison.locator('tbody tr').count(),100)
   await page.getByRole('button',{name:'Next items',exact:true}).click()
   assert.equal(await comparison.locator('tbody tr').count(),5)
   await page.getByLabel('Search comparison items',{exact:true}).fill('Bathroom fixture 204')
   assert.equal(await comparison.locator('tbody tr').count(),1,'Search covers records on every page')
   await page.getByLabel('Search comparison items',{exact:true}).fill('')
   assert.equal(await comparison.locator('tbody tr').count(),100,'Search reset returns to the first page')
   console.log('PASS 205-item comparison pagination and full-dataset search at 320px')
   rfqItemCount=100
  }
  const roleCases=[
   {role:'receiver',grants:['procurement.orders.view','receiving.manage','receiving.view'],landing:'Receive Goods'},
   {role:'document_assistant',grants:['price_lists.manage','price_lists.view'],landing:'Price Lists'},
   {role:'stock_checker',grants:['company_lists.view','items.view','stock.count.enter','stock.count.view','stock.search','urgent.manage','urgent.view'],landing:'Stock Entry'},
   {role:'viewer',grants:['dashboard.view','invoices.view','items.view','price_lists.view','procurement.orders.view','procurement.rfq.view','reports.view','suppliers.view'],landing:'Home'},
   {role:'procurement',grants:[...permissions,'suppliers.view','price_lists.view','reports.view'],landing:'Home'},
   {role:'admin',grants:[...permissions,'admin.roles.manage','company_lists.view','suppliers.view','price_lists.view','reports.view'],landing:'Home'}
  ]
  const moduleViews=[['dashboard.view','⌂ Home'],['stock.count.view','✓ Stock Entry'],['urgent.view','! Exceptions'],['company_lists.view','CL Company Lists'],['suppliers.view','♢ Suppliers'],['price_lists.view','₨ Price Lists'],['procurement.requirements.view','≡ Review'],['procurement.rfq.view','Q RFQs & Quotes'],['procurement.orders.view','PO Orders'],['invoices.view','▤ Invoices'],['receiving.view','⇩ Receive Goods'],['items.view','□ Items'],['reports.view','↗ Reports']]
  for(const staff of roleCases){
   currentProfile={...profile,role:staff.role,role_key:staff.role}
   grantedPermissions=staff.grants
   await page.reload()
   await page.waitForFunction(label=>document.querySelector('.topbar h2')?.textContent===label,staff.landing)
   for(const [permission,label] of moduleViews){
    if(!staff.grants.includes(permission))continue
    await navigate(label)
    await page.locator('.content > section:not([hidden])').waitFor({state:'visible'})
    await page.waitForFunction(()=>{const section=document.querySelector('.content > section:not([hidden])');return section&&section.textContent.trim().length>30&&!section.textContent.includes('Loading screen…')})
   }
   console.log('PASS permitted section navigation for '+staff.role+' at '+width+'px')
  }
  assert.deepEqual(errors,[],'Browser errors at '+width)
  assert.deepEqual(policyViolations,[],'Procurement, PDF and OCR actions must not violate CSP at '+width)
  console.log('PASS guided navigation and no horizontal overflow at '+width+'px')
  await context.close()
 }
}finally{
 if(browser)await browser.close()
 server.kill('SIGTERM')
}
