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
async function pickerOptionCount(locator,value){
 await locator.click()
 const dialog=locator.page().locator('.picker-panel'),rows=dialog.locator('.picker-option')
 let count=await rows.count()
 if(value!==undefined){count=0;for(let i=0;i<await rows.count();i++)if(await rows.nth(i).getAttribute('data-option-value')===String(value))count++}
 await dialog.getByRole('button',{name:'Close selection',exact:true}).click()
 return count
}
async function pickerHasOption(locator,value){assert.equal(await pickerOptionCount(locator,value),1)}
async function chooseOption(locator,value){
 if(await locator.evaluate(node=>node.tagName==='SELECT')){await locator.selectOption(value);return}
 await locator.click()
 const page=locator.page(),dialog=page.locator('.picker-panel')
 await dialog.waitFor()
 const option=dialog.locator('.picker-option')
 for(let i=0;i<await option.count();i++){
  if(await option.nth(i).getAttribute('data-option-value')===String(value)){
   await option.nth(i).click();await dialog.waitFor({state:'hidden'});return
  }
 }
 throw new Error('Picker option missing: '+value)
}
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
 const companyPo={...po,id:'00000000-0000-4000-8000-000000000014',po_no:'PO-COMPANY-DIRECT',company_id:'company-fixture',proc_po_is_company:true,quantity_only:true}
 const companyQuotedPo={...po,id:'00000000-0000-4000-8000-000000000015',po_no:'PO-COMPANY-QUOTED',company_id:null,proc_po_is_company:true}
 const otherPo={...po,id:'00000000-0000-4000-8000-000000000011',po_no:'PO-SECOND'}
 for(const width of (process.env.GH_UI_WIDTHS?process.env.GH_UI_WIDTHS.split(',').map(Number):[320,390,768,1366])){
  let interfacePreference=null
  const context=await browser.newContext({viewport:{width,height:844}})
  const page=await context.newPage()
  if(process.env.GH_UI_CERTIFY==='1'||process.env.GH_UI_BOTTOM_STEPS==='1'||process.env.GH_UI_STOCK_KEYBOARD==='1'||process.env.GH_UI_DENSE_STOCK==='1')await context.addInitScript(()=>{
   const viewport=new EventTarget();viewport.height=innerHeight;viewport.width=innerWidth;viewport.offsetTop=0
   Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport})
  })
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
  const receivingMode=process.env.GH_UI_RECEIVING==='1'
  let receivingAccepted=0,receivingCase=null,caseWrites=[],closureWrites=[],followupFailure=false,receivingReplayKey=null
  let dashboardReviewFailure=false
  let exceptionFixtures=false
  const savedQuotes=new Map(),additionalCalls=[]; let extraSizeItems=[]
  let quoteReadFailure=null
  let draftSaveFailure=false
  const draftSaves=[]
  let grantedPermissions=permissions
  let currentProfile=profile
  let accessReason='allowed',accessExpirySeconds=null
  const accessSaves=[]
  let captureAllowed=false
  const captureChanges=[]
  const accessPolicy={time_enabled:true,location_enabled:true,days:[0,1,2,3,4,5],start_time:'07:30',end_time:'18:30',latitude:7.0552571,longitude:80.5345549,radius_m:100,location_name:'General Hardware, No. 14 Kandy Road, Nawalapitiya'}
  const accessReply=()=>({allowed:accessReason==='allowed',reason:accessReason,exempt:currentProfile.role_key==='admin',policy:accessPolicy,server_now:new Date().toISOString(),valid_until:accessExpirySeconds===null?null:new Date(Date.now()+accessExpirySeconds*1000).toISOString()})
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
  let companyCountAttempt=0
  if(process.env.GH_UI_COMPANY_ITEMS==='1')await context.route(root+'/api/company-items/submit',async route=>{
   const body=route.request().postDataJSON();companyCountAttempt++
   const changed=companyCountAttempt>1
   assert.equal(body.lines.length,1,'Only entered rows are submitted')
   assert.equal(body.lines[0].current_stock,changed?0:1)
   await route.fulfill({json:{ok:true,count_no:changed?'035':'034',requirements_created:0,purchase_orders:[],rfqs:[],stock_outcomes:[{description:item.description,current_stock:changed?0:1,shortage_qty:changed?20:19,committed_qty:19,uncovered_qty:changed?1:0,needs_review:changed,reason:changed?'Stock need changed while an order is outstanding. Additional purchasing needs manual review.':'Covered by existing purchase orders.',orders:[{id:po.id,number:'001',status:'sent',qty:19}],rfqs:[]}]}})
  })
  const routingMode=process.env.GH_UI_ROUTING==='1'
  let setupRoute={id:'routing-fixture',company_id:'company-fixture',section_id:null,route_mode:'rfq',auto_send:true,updated_at:'2026-10-16T00:00:00Z',assigned_supplier_ids:[supplier.id]}
  let setupDefaultId=newSupplier.id,setupRecipients=[supplier.id],setupFailure=false
  const setupSaves=[]
  let groupRoute=null,groupRouteSaves=[],groupPreparations=0,groupContactIds=[],groupNoShortages=false
  const groupSection={id:'00000000-0000-4000-8000-000000000090',company_id:'company-fixture',name:'ALCATHINE HOSE',active:true,parent_id:null}
  let directory=routingMode?[supplier,newSupplier]:[supplier],invitations=[{id:'invite-fixture',rfq_id:rfq.id,supplier_id:supplier.id,status:'pending'}],addFailure=true,rfqStatus='prepared'
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
   else if(name==='proc_access_status_v1')data=accessReply()
   else if(name==='proc_verify_location_v1'){
    const input=req.postDataJSON();assert.equal(input.p_latitude,7.0552571);assert.equal(input.p_longitude,80.5345549)
    accessReason='allowed';data=accessReply()
   }
   else if(name==='proc_admin_access_policy_v1')data=accessPolicy
   else if(name==='proc_admin_save_access_policy_v1'){accessSaves.push(req.postDataJSON());data=null}
   else if(name==='proc_capture_status_v1')data={can_override:currentProfile.role_key==='admin',capture_allowed:captureAllowed,expires_in_seconds:captureAllowed?20:0}
   else if(name==='proc_set_capture_override_v1'){
    if(currentProfile.role_key!=='admin')return route.fulfill({status:403,json:{message:'Only Super Admin can allow screenshots'}})
    captureChanges.push(req.postDataJSON());captureAllowed=req.postDataJSON().p_enabled;data={can_override:true,capture_allowed:captureAllowed,expires_in_seconds:captureAllowed?20:0}
   }
   else if(name==='proc_admin_record_preview_v1'){const b=req.postDataJSON();data={label:b.p_table==='proc_rfqs'?rfq.rfq_no:b.p_table==='proc_suppliers'?supplier.supplier_code:po.po_no,counts:{[b.p_table]:1},token:'fixture-record-token'}}
   else if(['proc_admin_delete_record_v1','proc_admin_reset_data_v1','proc_admin_delete_item_v1','proc_admin_clear_po_v1'].includes(name)){destructiveRequests.push({name,body:req.postDataJSON()});return route.fulfill({status:400,json:{message:'Fixture operation blocked'}})}
   else if(name==='proc_quick_add_item_v1')data={existing:false,item:{...item,item_code:'QA-FIXTURE',description:req.postDataJSON().p_item.description}}
   else if(name==='proc_company_section_routes'&&routingMode)data=[setupRoute]
   else if(name==='proc_company_section_route_suppliers'&&routingMode)data=setupRecipients.map((id,i)=>({route_id:setupRoute.id,supplier_id:id,sort_order:i+1}))
   else if(name==='proc_company_save_supplier_setup'&&routingMode){
    const b=req.postDataJSON();setupSaves.push(b)
    if(setupFailure)return route.fulfill({status:503,json:{message:'Fixture atomic save failure'}})
    assert.equal(b.p_expected_route_id,setupRoute.id);assert.equal(b.p_expected_updated_at,setupRoute.updated_at)
    setupRecipients=b.p_recipient_ids
    setupDefaultId=b.p_assigned_ids.length===1?b.p_assigned_ids[0]:null
    setupRoute={...setupRoute,route_mode:b.p_action.startsWith('direct')?'direct':'rfq',auto_send:['rfq','direct'].includes(b.p_action),assigned_supplier_ids:b.p_assigned_ids,updated_at:'2026-10-16T00:00:0'+setupSaves.length+'Z'}
    data={id:setupRoute.id,updated_at:setupRoute.updated_at}
   }
   else if(name==='proc_company_sections'&&process.env.GH_UI_GROUP_SEND==='1')data=[groupSection]
   else if(name==='proc_company_section_routes'&&process.env.GH_UI_GROUP_SEND==='1')data=groupRoute?[groupRoute]:[]
   else if(name==='proc_company_group_contacts'&&process.env.GH_UI_GROUP_SEND==='1')data=groupContactIds.map((id,idx)=>({company_id:'company-fixture',section_id:groupSection.id,supplier_id:id,sort_order:idx+1}))
   else if(name==='proc_company_save_group_contacts'&&process.env.GH_UI_GROUP_SEND==='1'){const b=req.postDataJSON();groupContactIds=b.p_supplier_ids;data={supplier_count:groupContactIds.length}}
   else if(name==='proc_company_section_route_suppliers'&&process.env.GH_UI_GROUP_SEND==='1')data=groupRoute?[{route_id:groupRoute.id,supplier_id:supplier.id,sort_order:1}]:[]
   else if(name==='proc_company_save_supplier_setup'&&process.env.GH_UI_GROUP_SEND==='1'){
    const b=req.postDataJSON()
    groupRouteSaves.push({p_mode:b.p_action,p_auto_send:b.p_action!=='manual',p_supplier_ids:b.p_recipient_ids,p_section_id:b.p_section_id,p_template:b.p_template})
    groupRoute={id:'route-fixture',company_id:b.p_company_id,section_id:b.p_section_id,route_mode:b.p_action==='direct'?'direct':'rfq',auto_send:b.p_action!=='manual',document_template:b.p_template,assigned_supplier_ids:b.p_assigned_ids,updated_at:'2026-10-17T10:00:00Z'}
    data={id:groupRoute.id,updated_at:groupRoute.updated_at}
   }
   else if(name==='proc_company_save_route_v2'&&process.env.GH_UI_GROUP_SEND==='1'){
    const b=req.postDataJSON();groupRouteSaves.push(b);groupRoute={id:'route-fixture',company_id:b.p_company_id,section_id:b.p_section_id,route_mode:b.p_mode,auto_send:b.p_auto_send,document_template:b.p_template};data={id:groupRoute.id}
   }
   else if(name==='proc_company_prepare_route_rfq'&&process.env.GH_UI_GROUP_SEND==='1'){
    groupPreparations++
    if(groupNoShortages){await route.fulfill({status:400,json:{code:'P0001',message:'No approved unquoted shortages remain for this group'}});return}
    data={rfq_id:rfq.id,rfq_no:rfq.rfq_no,document_template:groupRoute.document_template}
   }
   else if(name==='proc_company_direct_po_history')data=process.env.GH_UI_COMPANY_PO==='1'?[{po_id:companyPo.id,po_no:companyPo.po_no,company_id:'company-fixture',company_name:'Fixture company',po_status:'sent',created_at:new Date().toISOString(),item_count:1,sent_count:1,failed_count:0}]:[]
   else if(name==='proc_company_rfq_history')data=[{rfq_id:rfq.id,rfq_no:rfq.rfq_no,company_id:'company-fixture',company_name:'Fixture company',rfq_status:'prepared',created_at:new Date().toISOString(),item_count:2,supplier_count:2,sent_count:1,failed_count:1}]
   else if(name==='proc_companies')data=[{id:'company-fixture',company_code:'COMP-FIXTURE',name:'Fixture company',active:true,company_list_enabled:true,...(routingMode?{default_supplier_id:setupDefaultId,updated_at:setupRoute.updated_at}:process.env.GH_UI_CONTACT_PASTE==='1'?{default_supplier_id:supplier.id}:{})}]
   else if(name==='proc_company_list_items'&&process.env.GH_UI_DENSE_STOCK==='1')data=Array.from({length:12},(_,i)=>({id:'dense-row-'+i,item_id:'dense-item-'+i,target_stock:20,item:{...item,id:'dense-item-'+i,description:'ALKATHENE HOSE '+['1/2IN 200FT','3/4IN 100FT','3/4IN 200FT','1IN 100FT','1IN 200FT','1 1/2IN 100FT'][i%6],category:'ALKATHINE',subgroup:'',size:'',uom:'PCS'}}))
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
   else if(name==='proc_requirements'&&req.method()==='HEAD'&&dashboardReviewFailure)return route.fulfill({status:503,json:{message:'Fixture dashboard queue unavailable'}})
   else if(name==='proc_v_dashboard')data={active_items:1,open_requirements:1,still_to_order:1,awaiting_receipt:0,open_pos:0,po_value:0}
   else if(receivingMode&&name==='proc_v_rejection_cases'){if(followupFailure)return route.fulfill({status:503,json:{message:'Fixture follow-up unavailable'}});data=receivingCase&&receivingCase.status!=='resolved'?[receivingCase]:[]}
   else if(receivingMode&&name==='proc_resolve_rejection_case_v1'){const b=req.postDataJSON();caseWrites.push(b);if(b.p_action==='replacement_received'){receivingAccepted+=receivingCase.rejected_qty;receivingCase.status='resolved'}else receivingCase.status=b.p_action==='replacement_requested'?'replacement_due':'resolved';data={status:receivingCase.status}}
   else if(receivingMode&&name==='proc_close_po_v1'){closureWrites.push(req.postDataJSON());poFixtureStatus='closed';data={status:'closed'}}
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
   else if(name==='proc_rfq_suppliers')data=process.env.GH_UI_GROUP_SEND==='1'?invitations.map(inv=>({...inv,supplier})):invitations
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
    const p=req.postDataJSON();if(p.p_expected_revision!==JSON.stringify(savedQuotes.get(p.p_supplier_id)||null))return route.fulfill({status:409,json:{code:'PT409',message:'Saved supplier quotation changed'}});if(p.p_additional_sizes?.length){additionalCalls.push(p);assert.deepEqual(p.p_additional_sizes,[{source_rfq_item_id:'00000000-0000-4000-8000-000000000008',size:'2 ft',unit_price:40,qty:6,remarks:''}]);extraSizeItems=[{id:'additional-size',rfq_id:rfq.id,requested_qty:6,selected_for_po:true,requirement:{...requirement,adjusted_qty:6,item:{...item,size:'2 ft'}}}];p.p_lines.push({rfq_item_id:'additional-size',unit_price:40,notes:null})}assert.ok([supplier.id,newSupplier.id].includes(p.p_supplier_id),'Saving uses an invited supplier');assert.equal(p.p_attachment_path,null,'Another supplier’s attachment is not uploaded')
    savedQuotes.set(p.p_supplier_id,{id:'saved-'+p.p_supplier_id,quote_ref:p.p_quote_ref,freight_total:p.p_freight_total,minimum_order_value:p.p_minimum_order_value,valid_until:p.p_valid_until,notes:p.p_notes,lines:p.p_lines.map((l,i)=>({...l,id:'saved-line-'+i}))})
    rfqStatus='partially_quoted';invitations=invitations.map(x=>x.supplier_id===p.p_supplier_id?{...x,status:'quoted'}:x);data={status:rfqStatus}
   }
   else if(name==='proc_set_rfq_supplier_items_v1'){const p=req.postDataJSON();invitations=invitations.map(x=>x.supplier_id===p.p_supplier_id?{...x,requested_item_ids:p.p_item_ids}:x);data=invitations.find(x=>x.supplier_id===p.p_supplier_id)}
   else if(name==='proc_finalize_award_with_variations_v1')data=[{po_id:po.id,po_no:po.po_no,supplier_id:supplier.id}]
   else if(name==='proc_approve_po_v2'||name==='proc_mark_po_sent_v2'){assert.equal(req.postDataJSON().p_po_id,po.id);poFixtureStatus=name==='proc_approve_po_v2'?'approved':'sent';data=true}
   else if(name==='proc_purchase_orders'){data=process.env.GH_UI_COMPANY_PO==='1'?[po,companyPo,companyQuotedPo]:[{...po,status:poFixtureStatus},otherPo];if(process.env.GH_UI_COMPANY_PO==='1'){const type=url.searchParams.get('proc_po_is_company');if(type==='eq.false')data=data.filter(x=>!x.company_id&&!x.proc_po_is_company);if(type==='eq.true')data=data.filter(x=>x.company_id||x.proc_po_is_company)}const scope=url.searchParams.get('id');if(scope?.startsWith('in.'))data=data.filter(x=>scope.includes(x.id));if(scope?.startsWith('eq.'))data=data.find(x=>x.id===scope.slice(3));if(Array.isArray(data)&&url.searchParams.get('status')==='eq.approved')data=data.filter(x=>x.status==='approved');if(receivingMode&&Array.isArray(data)&&url.searchParams.get('status')?.startsWith('in.'))data=data.filter(x=>url.searchParams.get('status').includes(x.status))}
   else if(name==='proc_receive_po_v3'&&receivingMode){
    const b=req.postDataJSON();receipts.push(b);if(b.p_receipt_key===receivingReplayKey){await route.fulfill({status:200,json:{grn_no:'GRN-RECOVERED',replayed:true}});return}receivingAccepted+=b.p_lines.reduce((n,l)=>n+l.accepted_qty,0);poFixtureStatus=receivingAccepted===10?'received':'partially_received'
    const damaged=b.p_lines.find(l=>l.rejected_qty>0);if(damaged)receivingCase={id:'rejection-fixture',po_id:po.id,po_no:po.po_no,grn_no:'GRN-FIXTURE',description:item.description,size:item.size,supplier_name:supplier.name,rejected_qty:damaged.rejected_qty,rejection_reason:damaged.rejection_reason,status:'open'}
    data={grn_no:'GRN-FIXTURE-'+receipts.length,replayed:false}
   }
   else if(name==='proc_receive_po_v3'){receipts.push(req.postDataJSON());await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Fixture receipt retry'})});return}
   else if(name==='proc_supplier_invoices')data=[{id:'invoice-fixture',invoice_no:'INV-VARIANCE',status:'variance',total:1000,supplier,po}]
   else if(name==='proc_po_lines'&&url.searchParams.has('source_quote_line_id'))data=[{po_id:po.id,po:{...po,status:poFixtureStatus}}]
   else if(name==='proc_po_lines'){
    const first={id:'00000000-0000-4000-8000-000000000009',po_id:url.searchParams.get('po_id')?.slice(3)||po.id,item_id:item.id,item,qty:10,unit_price:100,line_total:1000}
    if(receivingMode&&first.po_id===po.id)first.grn=[{accepted_qty:receivingAccepted,receipt:{status:'posted'}}]
    data=poLargeExport?Array.from({length:100},(_,i)=>({id:'po-export-'+i,item:{...item,description:'PO fixture '+String(i+1),size:'2 inch'},qty:i+1,unit_price:123.45,line_total:123.45*(i+1)})):receivingManyRows?[first,...Array.from({length:8},(_,i)=>({...first,id:'receiving-line-'+i,item:{...item,description:'Receiving fixture '+(i+2)}}))]:[first]
   }
   else if(name==='proc_search_item_master_v2')data=[{...item,item_code:'FIXTURE-ITEM',total_count:1}]
   else if(name==='proc_items'||name==='proc_v_stock_check_due'||name==='proc_search_stock_items_v1')data=[item]
   else if(name==='proc_item_filter_options_v1')data={categories:['GENERAL'],main_groups:[]}
   else if(name==='proc_submit_stock_and_continue_v3'){stockSubmissions.push(req.postDataJSON());data={automation:{status:'review_required',submitted_items:1,requirements:1}}}
   else if(name==='proc_begin_stock_count_session_v1')data=new Date().toISOString()
   else if(name==='proc_admin_reset_preview_v1')data={scope:req.postDataJSON().p_scope,counts:{proc_purchase_orders:2,proc_stock_balances:1},token:'fixture-preview-token'}
   else if(name==='proc_stock_submission_history_v1')data=[
    {count_id:'general-history',count_no:'GENERAL-HISTORY',category:'GENERAL',submitted_at:'2026-10-22T09:00:00Z',item_count:1,counted_by_name:'Fixture staff'},
    {count_id:'company-history',count_no:'COMPANY-HISTORY',category:'COMPANY: Fixture company',submitted_at:'2026-10-22T08:00:00Z',item_count:1}
   ]
   else if(name==='proc_stock_submission_detail_v1')data=[{line_id:'history-line',description:'HISTORICAL ITEM',size:'2 inch',uom:'PCS',current_stock:7,required_qty:3}]
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
   await route.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-0/1','access-control-expose-headers':'content-range'},body:JSON.stringify(data)})
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
  if(process.env.GH_UI_STOCK_HISTORY==='1'){
   await navigate('✓ Stock Entry')
   const shortcut=page.getByRole('button',{name:'Open General stock submission history',exact:true})
   await shortcut.click()
   const dialog=page.getByRole('dialog',{name:'General stock submission history',exact:true})
   await dialog.getByRole('button',{name:/GENERAL-HISTORY/}).waitFor()
   assert.equal(await dialog.getByText('COMPANY-HISTORY',{exact:true}).count(),0)
   await dialog.getByRole('button',{name:/GENERAL-HISTORY/}).click()
   await dialog.getByText('HISTORICAL ITEM · 2 INCH',{exact:true}).waitFor()
   assert.equal(await dialog.locator('.stock-history-detail-row>b').first().innerText(),'7')
   await page.keyboard.press('Escape')
   await dialog.waitFor({state:'hidden'})
   assert.equal(await shortcut.evaluate(el=>document.activeElement===el),true)
   if(width<=700)assert.equal(await page.locator('.stock-filter-summary').evaluate(el=>getComputedStyle(el).position),'static')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   await page.locator('.company-stock-header').waitFor()
   assert.equal(await shortcut.count(),0)
   if(width<=700)assert.equal(await page.locator('.company-stock-header').evaluate(el=>getComputedStyle(el).position),'static')
   assert.equal(stockSubmissions.length,0,'Viewing history never submits a stock count')
   assert.deepEqual(errors,[])
   console.log('PASS General history, Company separation, detail, focus return and scrolling controls at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_BOTTOM_STEPS==='1'){
   await navigate('✓ Stock Entry')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   const count=page.getByLabel('Current stock: '+item.description,{exact:true})
   await count.fill('0')
   const guide=page.getByRole('navigation',{name:'Guided procurement navigation',exact:true})
   const labels=['Stock','Review','Prices','Order','Receive']
   assert.equal(await guide.getByRole('button').count(),5)
   assert.equal(await page.getByText('Choose a step',{exact:true}).count(),0)
   if(width<=700){
    assert.equal(await page.getByRole('navigation',{name:'Main navigation',exact:true}).isVisible(),false)
    const boxes=await guide.getByRole('button').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}}))
    assert.ok(boxes.every(b=>Math.abs(b.y-boxes[0].y)<1&&Math.abs(b.w-boxes[0].w)<1&&b.h>=48&&b.x>=0&&b.x+b.w<=width+1),'Five equal touch targets fit in one row')
   }
   for(const label of labels){
    await guide.getByRole('button',{name:label,exact:true}).click()
    await page.waitForFunction(label=>document.querySelector('.workflow-step-tabs [aria-current="step"]')?.textContent.endsWith(label),label)
    await page.waitForFunction(()=>{const el=document.querySelector('.content > section:not([hidden])');return el&&el.textContent.trim().length>30&&!el.textContent.includes('Loading screen…')})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.screenshot({path:'test-results/bottom-steps-'+label.toLowerCase()+'-'+width+'.png'})
   }
   // Order must open actual orders, including when coming from a different stage.
   await guide.getByRole('button',{name:'Stock',exact:true}).click()
   assert.equal(await count.inputValue(),'0','Switching steps preserves the stock draft')
   await guide.getByRole('button',{name:'Order',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('.topbar h2')?.textContent==='Orders')
   await guide.getByRole('button',{name:'Stock',exact:true}).click()
   if(width<=700){
    const dock=page.getByRole('region',{name:'Company count actions',exact:true})
    const d=await dock.boundingBox(),n=await guide.boundingBox()
    assert.ok(d.y+d.height<=n.y,'Primary action stays above steps')
    await count.focus()
    await page.evaluate(()=>{window.visualViewport.height=500;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--gh-keyboard-gap')==='344px')
    const keyboardDock=await dock.boundingBox()
    assert.equal(await guide.isVisible(),false,'Journey hides while typing')
    assert.ok(keyboardDock.y>=0&&keyboardDock.y+keyboardDock.height<=500&&keyboardDock.height<=44&&keyboardDock.width<=160,'Compact Submit stays above the simulated keyboard')
    await page.screenshot({path:'test-results/bottom-steps-keyboard-'+width+'.png'})
    await page.evaluate(()=>{window.visualViewport.height=innerHeight;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--gh-keyboard-gap')==='0px')
    await page.getByRole('button',{name:'Go to Home',exact:true}).click()
    assert.equal(await guide.count(),0)
    assert.ok(await page.getByRole('navigation',{name:'Main navigation',exact:true}).isVisible())
   }
   assert.deepEqual(errors,[]);assert.deepEqual(policyViolations,[])
   console.log('PASS five aligned steps, direct order destination, preserved stock draft and Home at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_DENSE_STOCK==='1'){
   await navigate('✓ Stock Entry')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   const rows=page.locator('.company-stock-item-row')
   await rows.nth(11).waitFor()
   const field=rows.nth(5).locator('input.stock-entry')
   await field.fill('5')
   if(width<=700){
    await page.evaluate(()=>{window.visualViewport.height=340;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.dataset.ghKeyboardOpen==='true')
    await page.waitForFunction(()=>{const c=document.querySelector('.content').getBoundingClientRect(),f=document.activeElement.getBoundingClientRect();return f.top>=c.top&&f.bottom<=c.bottom})
    const metrics=await rows.evaluateAll(nodes=>{const c=document.querySelector('.content').getBoundingClientRect();const b=nodes.map(n=>n.getBoundingClientRect());return {visible:b.filter(r=>r.top>=c.top-1&&r.bottom<=c.bottom+1).length,maxHeight:Math.max(...b.map(r=>r.height)),contentHeight:c.height,lastBottom:Math.max(...b.filter(r=>r.top<c.bottom).map(r=>Math.min(r.bottom,c.bottom))),contentBottom:c.bottom}})
    assert.ok(metrics.visible>=5,'At least five complete company stock rows with keyboard: '+JSON.stringify(metrics))
    assert.ok(metrics.maxHeight<=52,'Long descriptions remain compact: '+JSON.stringify(metrics))
    assert.ok(metrics.contentBottom-metrics.lastBottom<40,'Stock rows use the available height')
    assert.equal(await page.getByRole('navigation',{name:'Guided procurement navigation',exact:true}).isVisible(),false)
    assert.ok(await page.locator('.stock-header-action').getByRole('button',{name:'Submit 1 item →',exact:true}).isVisible())
    assert.equal(await field.inputValue(),'5')
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.screenshot({path:'test-results/dense-company-keyboard-'+width+'.png'})
    await page.evaluate(()=>{window.visualViewport.height=innerHeight;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.dataset.ghKeyboardOpen==='false')
    console.log('PASS '+metrics.visible+' complete readable stock rows with keyboard at '+width+'px')
   }
   assert.deepEqual(errors,[]);assert.deepEqual(policyViolations,[])
   await context.close();continue
  }
  if(process.env.GH_UI_STOCK_KEYBOARD==='1'){
   if(width>700){await context.close();continue}
   await navigate('✓ Stock Entry')
   const general=page.locator('.stock-fast-panel input[inputmode="decimal"]').filter({visible:true}).first()
   await general.fill('4')
   const journey=page.getByRole('navigation',{name:'Guided procurement navigation',exact:true})
   for(const [kind,input,action] of [
    ['general',general,page.locator('.stock-submit-dock').filter({visible:true})],
    ['company',page.getByLabel('Current stock: '+item.description,{exact:true}),page.getByRole('region',{name:'Company count actions',exact:true})]
   ]){
    if(kind==='company')await page.getByRole('tab',{name:'Company Items',exact:true}).click()
    await input.fill(kind==='company'?'0':'4')
    for(const [height,top] of [[500,0],[340,0],[340,75]]){
     await input.focus()
     await page.evaluate(({height,top})=>{window.visualViewport.height=height;window.visualViewport.offsetTop=top;window.visualViewport.dispatchEvent(new Event('resize'));window.visualViewport.dispatchEvent(new Event('scroll'))},{height,top})
     await page.waitForFunction(height=>document.documentElement.style.getPropertyValue('--gh-workspace-height')===height+'px',height)
     const shell=await page.locator('.app').boundingBox()
     assert.ok(Math.abs(shell.height-height)<=1,'Workspace must shrink to keyboard viewport: '+JSON.stringify({kind,height,top,shell}))
     await page.waitForFunction(()=>{const el=document.activeElement,c=document.querySelector('.content');if(!el||!c)return false;const e=el.getBoundingClientRect(),b=c.getBoundingClientRect();return e.top>=b.top+4&&e.bottom<=b.bottom-4})
     await page.waitForFunction(()=>{const f=document.activeElement,b=f.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===f})
     const field=await input.boundingBox(),dock=await action.boundingBox()
     assert.equal(await journey.isVisible(),false,'Bottom steps must not consume typing space')
     assert.ok(dock.width<=160&&dock.height<=44,'Submit is a compact button: '+JSON.stringify(dock))
     const content=await page.locator('.content').boundingBox()
     assert.ok(dock.y>=top&&dock.y+dock.height<=content.y+1,'Submit occupies the header above the worksheet')
     assert.ok(field.y>=content.y+4&&field.y+field.height<=top+height-4,'Focused stock has unobstructed worksheet space')
     assert.equal(await action.locator('xpath=ancestor::header').count(),1,'Stock action belongs to the header')
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
     await page.screenshot({path:`test-results/stock-keyboard-${kind}-${width}-${height}-${top}.png`})
    }
    await page.evaluate(()=>{window.visualViewport.height=innerHeight;window.visualViewport.offsetTop=0;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--gh-keyboard-gap')==='0px')
    // Android can resize the layout viewport itself rather than overlay it.
    await page.setViewportSize({width,height:420})
    await page.evaluate(()=>{window.visualViewport.height=innerHeight;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.dataset.ghKeyboardOpen==='true')
    assert.equal(await page.evaluate(()=>document.documentElement.style.getPropertyValue('--gh-keyboard-gap')),'0px','Resized layout must not apply a second keyboard offset')
    await page.waitForFunction(()=>{const c=document.querySelector('.content').getBoundingClientRect(),f=document.activeElement.getBoundingClientRect();return f.top>=c.top+4&&f.bottom<=c.bottom-4})
    await page.waitForFunction(()=>{const f=document.activeElement,b=f.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===f})
    await page.screenshot({path:`test-results/stock-keyboard-${kind}-${width}-layout-resize.png`})
    await page.setViewportSize({width,height:844})
    await page.evaluate(()=>{window.visualViewport.height=innerHeight;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.dataset.ghKeyboardOpen==='false')
    assert.equal(await input.inputValue(),kind==='company'?'0':'4')
    assert.ok(await journey.isVisible(),'Bottom steps return after the keyboard closes')
    const submitButton=kind==='general'?action:action.getByRole('button')
    await submitButton.click()
    const confirmation=page.getByRole('dialog').filter({visible:true})
    await confirmation.waitFor();await confirmation.getByRole('button',{name:'Cancel',exact:true}).click()
    assert.equal(await input.inputValue(),kind==='company'?'0':'4','Cancel submission preserves quantities')
   }
   assert.deepEqual(errors,[]);assert.deepEqual(policyViolations,[])
   console.log('PASS general/company focused stock, compact/panned keyboard, reachable action and restored draft at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_CERTIFY==='1'){
   if(width<=700){
    await navigate('✓ Stock Entry')
    await page.getByRole('tab',{name:'Company Items',exact:true}).click()
    const count=page.getByLabel('Current stock: '+item.description,{exact:true})
    await count.fill('1')
    await page.evaluate(()=>{window.visualViewport.height=500;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--gh-keyboard-gap')==='344px')
    const dock=page.getByRole('region',{name:'Company count actions',exact:true})
    const box=await dock.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=500,'Submit stays above the simulated keyboard: '+JSON.stringify(box))
    assert.ok(await dock.getByRole('button',{name:'Submit 1 item →',exact:true}).isEnabled())
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.screenshot({path:'test-results/certified-keyboard-'+width+'.png'})
    await page.evaluate(()=>{window.visualViewport.height=innerHeight;window.visualViewport.dispatchEvent(new Event('resize'))})
    await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--gh-keyboard-gap')==='0px')
    console.log('PASS keyboard viewport simulation and reachable counted-item action at '+width+'px')
   }
   const staffCases=[
    {role:'admin',grants:[...permissions,'admin.roles.manage','company_lists.view','suppliers.view','price_lists.view','reports.view'],landing:'Home'},
    {role:'stock_handler',grants:['company_lists.view','items.edit','items.view','stock.count.enter','stock.count.view','stock.reorder.manage','stock.search'],landing:'Stock'},
    {role:'receiver',grants:['procurement.orders.view','receiving.manage','receiving.view'],landing:'Receive'},
    {role:'document_assistant',grants:['price_lists.manage','price_lists.view'],landing:'Price Lists'},
    {role:'stock_checker',grants:['company_lists.view','items.view','stock.count.enter','stock.count.view','stock.search','urgent.manage','urgent.view'],landing:'Stock'},
    {role:'viewer',grants:['dashboard.view','invoices.view','items.view','price_lists.view','procurement.orders.view','procurement.rfq.view','reports.view','suppliers.view'],landing:'Home'},
    {role:'procurement',grants:[...permissions,'company_lists.view','suppliers.view','price_lists.view','reports.view'],landing:'Home'}
   ]
   const sections=[['dashboard.view','⌂ Home'],['stock.count.view','✓ Stock Entry'],['urgent.view','! Exceptions'],['company_lists.view','CL Company Lists'],['suppliers.view','♢ Suppliers'],['price_lists.view','₨ Price Lists'],['procurement.requirements.view','≡ Review'],['procurement.rfq.view','Q RFQs & Quotes'],['procurement.orders.view','PO Orders'],['invoices.view','▤ Invoices'],['receiving.view','⇩ Receive Goods'],['items.view','□ Items'],['reports.view','↗ Reports']]
   for(const staff of staffCases){
    currentProfile={...profile,role:staff.role,role_key:staff.role};grantedPermissions=staff.grants
    await page.reload()
    await page.waitForFunction(label=>document.querySelector('.topbar h2')?.textContent===label,staff.landing)
    if(!staff.grants.includes('dashboard.view'))assert.equal(await page.getByRole('button',{name:'⌂ Home',exact:true}).filter({visible:true}).count(),0,'Dashboard is unavailable to '+staff.role)
    for(const [permission,label] of sections){
     if(!staff.grants.includes(permission))continue
     await navigate(label)
     await page.waitForFunction(()=>{const el=document.querySelector('.content > section:not([hidden])');return el&&el.textContent.trim().length>30&&!el.textContent.includes('Loading screen…')})
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'Workspace overflow: '+staff.role+' / '+label+' / '+width)
    }
    if(!staff.grants.some(x=>x.startsWith('admin.')))assert.equal(await page.getByRole('button',{name:'⚙ Admin',exact:true}).filter({visible:true}).count(),0,'Admin is unavailable to '+staff.role)
    await page.screenshot({path:'test-results/certified-role-'+staff.role+'-'+width+'.png'})
    console.log('PASS permitted workspaces and landing for '+staff.role+' at '+width+'px')
   }
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   assert.deepEqual(errors,[]);assert.deepEqual(policyViolations,[])
   await context.close();continue
  }
  if(receivingMode){
   await navigate('PO Orders')
   await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
   await page.getByText('Outstanding delivery balances',{exact:true}).click()
   await page.getByRole('button',{name:'Cancel balance',exact:true}).click()
   const cancelDialog=page.getByRole('dialog',{name:'Cancel the outstanding balance',exact:true})
   await cancelDialog.getByLabel('Warning reason',{exact:true}).fill('Not needed now')
   await cancelDialog.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.equal(queries.some(u=>u.pathname.endsWith('/proc_release_po_balance_v1')),false,'Cancelling the balance review makes no RPC')
   await page.getByRole('button',{name:'Receive this order →',exact:true}).click()
   const view=page.locator('.content > section:not([hidden])')
   await chooseOption(page.getByLabel('Purchase Order',{exact:true}),po.id)
   await page.getByLabel('Search receiving items',{exact:true}).waitFor()
   const mobile=width<=700
   const row=mobile?view.locator('.receive-entry-row').first():view.locator('.desktop-table tbody tr').first()
   if(mobile){await row.getByLabel('Received '+item.description+' · '+item.size,{exact:true}).fill('6');await row.locator('summary').click();await row.getByLabel('Rejected '+item.description+' · '+item.size,{exact:true}).fill('2');await row.getByLabel('Rejection reason '+item.description+' · '+item.size,{exact:true}).fill('Broken')}
   else{await row.locator('input').nth(1).fill('6');await row.locator('input').nth(3).fill('2');await row.locator('input').nth(4).fill('Broken')}
   const reviewButton=view.getByRole('button',{name:'Review receipt (1) →',exact:true})
   await reviewButton.click()
   let review=page.getByRole('dialog',{name:'2. Review receipt',exact:true})
   await review.getByText('6 received · 4 accepted · 2 rejected',{exact:true}).waitFor()
   await review.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(receipts.length,0,'Review cancellation posts nothing')
   await reviewButton.click();await review.getByRole('button',{name:'Post receipt',exact:true}).click()
   await page.getByRole('region',{name:'Receipt result',exact:true}).waitFor();assert.equal(receipts.length,1)
   await page.getByRole('button',{name:'Settle rejected goods →',exact:true}).click()
   let followups=page.getByRole('tab',{name:'Follow-ups (1)',exact:true});await followups.waitFor()
   assert.equal(await page.getByRole('button',{name:'Update follow-up →',exact:true}).count(),1)
   await page.getByRole('button',{name:'Update follow-up →',exact:true}).click()
   let dialog=page.getByRole('dialog',{name:'1. Settle rejected goods',exact:true})
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(caseWrites.length,0,'Cancelling follow-up changes nothing')
   await page.getByRole('button',{name:'Update follow-up →',exact:true}).click()
   await dialog.getByLabel('Follow-up date (optional)',{exact:true}).fill('2026-10-20')
   await dialog.getByRole('button',{name:'Review →',exact:true}).click()
   dialog=page.getByRole('dialog',{name:'2. Review follow-up',exact:true})
   await page.screenshot({path:'test-results/receiving-followup-'+width+'.png'})
   await dialog.getByRole('button',{name:'Save follow-up',exact:true}).click()
   await page.getByRole('dialog').waitFor({state:'hidden'})
   assert.equal(caseWrites[0].p_action,'replacement_requested');assert.equal(caseWrites[0].p_due_date,'2026-10-20')
   await page.getByRole('button',{name:'Update follow-up →',exact:true}).click()
   dialog=page.getByRole('dialog',{name:'1. Settle rejected goods',exact:true})
   assert.equal(await dialog.getByLabel('What happens next?',{exact:true}).inputValue(),'replacement_received')
   await dialog.getByRole('button',{name:'Review →',exact:true}).click()
   await page.getByRole('dialog',{name:'2. Review follow-up',exact:true}).getByRole('button',{name:'Save follow-up',exact:true}).click()
   await page.getByText('No unresolved rejected goods.',{exact:true}).waitFor();assert.equal(receivingAccepted,6)
   followupFailure=true;await page.locator('.content > section:not([hidden])').getByRole('button',{name:'Refresh',exact:true}).click()
   await page.getByText('Follow-ups unavailable. Retry above.',{exact:true}).waitFor()
   assert.equal(await page.getByText('No unresolved rejected goods.',{exact:true}).count(),0,'Failure never looks settled')
   followupFailure=false;await page.getByRole('button',{name:'Retry receiving',exact:true}).click();await page.getByText('No unresolved rejected goods.',{exact:true}).waitFor()
   await page.getByRole('tab',{name:'Deliveries',exact:true}).click()
   await chooseOption(page.getByLabel('Purchase Order',{exact:true}),po.id)
   await page.getByText('60% received',{exact:true}).filter({visible:true}).waitFor()
   await page.getByRole('button',{name:'✓ Mark All Remaining Received',exact:true}).click()
   await page.getByRole('button',{name:'Review receipt (1) →',exact:true}).click()
   await page.getByRole('dialog',{name:'2. Review receipt',exact:true}).getByText('4 received · 4 accepted · 0 rejected',{exact:true}).waitFor()
   await page.getByRole('dialog').getByRole('button',{name:'Post receipt',exact:true}).click()
   await page.getByRole('button',{name:'Track / complete order →',exact:true}).click()
   await page.getByText('100% received',{exact:true}).filter({visible:true}).waitFor()
   await page.getByRole('button',{name:'Complete order →',exact:true}).click()
   await page.getByRole('dialog',{name:'Complete this order',exact:true}).getByRole('button',{name:'Close order',exact:true}).click()
   await page.getByText('Order closed',{exact:true}).filter({visible:true}).first().waitFor()
   assert.equal(closureWrites.length,1);assert.equal(receipts.length,2);assert.equal(receivingAccepted,10)
   // Simulate a lost receipt response followed by closure in another browser.
   receivingReplayKey='00000000-0000-4000-8000-000000000077'
   const recoveryDraft='gh_receiving_draft_v1:'+profile.id+':'+po.id
   await page.evaluate(({draft,key,lineId})=>localStorage.setItem(draft,JSON.stringify({receiptKey:key,vals:{[lineId]:{received:'10',accepted:'10',rejected:'0',reason:''}},notes:'Saved before a dropped connection',attempt:{lines:[{po_line_id:lineId,received_qty:10,accepted_qty:10,rejected_qty:0,rejection_reason:null}],notes:'Saved before a dropped connection'}})),{draft:recoveryDraft,key:receivingReplayKey,lineId:'00000000-0000-4000-8000-000000000009'})
   await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await navigate('⇩ Receive Goods')
   await chooseOption(page.getByLabel('Purchase Order',{exact:true}),po.id)
   await page.getByRole('button',{name:'Retry saved receipt',exact:true}).click()
   await page.getByRole('dialog',{name:'2. Review receipt',exact:true}).getByText(/An already posted receipt will not add stock again/).waitFor()
   await page.getByRole('dialog').getByRole('button',{name:'Post receipt',exact:true}).click()
   await page.getByRole('region',{name:'Receipt result',exact:true}).getByText(/GRN-RECOVERED/).waitFor()
   assert.equal(receivingAccepted,10,'Recovery adds no stock');assert.equal(receipts.length,3);assert.equal(receipts[2].p_receipt_key,receivingReplayKey)
   assert.equal(await page.evaluate(draft=>localStorage.getItem(draft),recoveryDraft),null,'Confirmed recovery clears the saved attempt')
   receivingCase={...receivingCase,status:'open'};grantedPermissions=permissions.filter(x=>x!=='receiving.manage')
   await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await navigate('⇩ Receive Goods')
   await page.getByRole('tab',{name:'Follow-ups (1)',exact:true}).click()
   assert.equal(await page.getByRole('button',{name:'Update follow-up →',exact:true}).count(),0,'Read-only users cannot resolve rejected goods')
   assert.equal(await page.getByRole('button',{name:/^Review receipt/}).filter({visible:true}).count(),0,'Read-only users cannot post receipts')
   assert.equal(errors.length,0,errors.join('\n'));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   console.log('PASS reviewed partial delivery, rejection follow-up, replacement, remaining delivery, refresh failure, closure, lost-response recovery and read-only guards at '+width+'px')
   await context.close();continue
  }
  if(routingMode){
   await navigate('✓ Stock Entry')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   await page.getByRole('button',{name:'Company setup',exact:true}).click()
   const setup=page.getByLabel('Company supplier automation',{exact:true})
   await setup.locator('summary').first().click()
   await setup.getByRole('button',{name:'Next →',exact:true}).click()
   await setup.getByText(/A previously saved contact differs/).waitFor()
   await setup.getByRole('checkbox',{name:/Supplier 1: Fixture supplier/}).click()
   await setup.getByRole('button',{name:'Add saved contact to suppliers',exact:true}).click()
   await setup.getByRole('button',{name:'Next →',exact:true}).click()
   await setup.getByRole('radio',{name:/Auto direct PO/}).check()
   const summary=setup.getByLabel('Sending summary',{exact:true})
   assert.ok((await summary.innerText()).includes(newSupplier.name))
   assert.ok((await summary.innerText()).includes(newSupplier.phone))
   const save=setup.getByRole('button',{name:'Save supplier & automation settings',exact:true})
   const saveBox=await save.boundingBox();assert.ok(saveBox.x>=0&&saveBox.x+saveBox.width<=width+1,'The complete supplier save button fits the viewport')
   await page.screenshot({path:'test-results/supplier-summary-'+width+'.png'})
   setupFailure=true;await save.click()
   await page.getByText('Fixture atomic save failure',{exact:true}).waitFor()
   assert.equal(setupRoute.route_mode,'rfq','Failed save keeps the original route')
   assert.deepEqual(setupRecipients,[supplier.id])
   setupFailure=false;await save.click()
   await setup.getByText(/^Saved\./).waitFor()
   assert.equal(setupSaves.length,2)
   assert.deepEqual(setupSaves[1].p_assigned_ids,[newSupplier.id]);assert.deepEqual(setupRecipients,[newSupplier.id])
   assert.equal(setupDefaultId,newSupplier.id)
   assert.equal(poGatewayRequests.length+rfqGatewayRequests.length,0,'Saving contacts never sends a document')
   await setup.getByRole('button',{name:'1. Scope',exact:true}).click()
   await setup.getByRole('button',{name:'Next →',exact:true}).click()
   assert.equal(await setup.getByText(/A previously saved contact differs/).count(),0,'No stale separate company-contact selection remains')
   await setup.getByRole('checkbox',{name:/Supplier 1:/}).click()
   await setup.getByRole('button',{name:'Next →',exact:true}).click()
   await setup.getByRole('radio',{name:/Manual/}).check()
   await save.click();await setup.getByText(/^Saved\./).waitFor()
   assert.equal(setupRoute.auto_send,false);assert.deepEqual(setupRoute.assigned_supplier_ids,[])
   await page.getByLabel('Advanced company supplier tools',{exact:true}).locator('summary').first().click()
   const advanced=page.getByLabel('Group supplier routing',{exact:true})
   await advanced.locator('summary').first().click()
   await advanced.getByLabel('Advanced: show optional company-wide fallback',{exact:true}).check()
   const fallback=advanced.locator('.company-section-directory-row').filter({has:page.getByText('Advanced · fallback for unassigned groups',{exact:true})})
   await fallback.getByRole('button',{name:'Configure',exact:true}).click()
   await fallback.getByRole('checkbox',{name:/^Fixture supplier/}).first().check()
   await fallback.getByText('Outgoing image & WhatsApp message',{exact:true}).click()
   await fallback.getByLabel('Document title',{exact:true}).fill('REVIEW REQUEST')
   await fallback.getByRole('button',{name:'Save group route',exact:true}).click()
   await fallback.getByRole('button',{name:'Configure',exact:true}).waitFor()
   assert.equal(setupSaves.at(-1).p_action,'rfq_manual','Advanced templates use the same atomic endpoint without enabling automatic sending')
   assert.equal(setupSaves.at(-1).p_template.title,'REVIEW REQUEST')
   assert.equal(setupRoute.auto_send,false)
   assert.equal(poGatewayRequests.length+rfqGatewayRequests.length,0)
   await navigate('PO Orders')
   await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
   await page.getByText('Record the delivery when goods arrive',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Receive this order →',exact:true}).click()
   await page.getByText('0% received',{exact:true}).filter({visible:true}).waitFor()
   assert.equal(errors.length,0,errors.join('\n'))
   await page.screenshot({path:'test-results/supplier-routing-'+width+'.png'})
   console.log('PASS contact-conflict resolution, recipient summary, atomic save failure/retry and manual no-contact route at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_DASHBOARD==='1'){
   const home=page.getByRole('region',{name:'Needs your attention',exact:true})
   await home.getByRole('button',{name:/Urgent purchases/}).filter({hasText:'1'}).waitFor()
   assert.equal(await home.locator('.dashboard-task').count(),4,'Home initially shows at most four task groups')
   assert.equal(await page.locator('.metric-link').filter({visible:true}).count(),0,'Detailed totals stay collapsed')
   await home.getByRole('button',{name:/All .* task groups/}).click()
   await home.getByRole('button',{name:/Review shortages/}).click()
   await requireQuery(url=>url.pathname.endsWith('proc_v_requirements')&&url.searchParams.get('approval_status')==='eq.pending_review','Review action opens pending shortages')
   await navigate('PO Orders')
   await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
   await page.locator('.po-expanded').filter({visible:true}).waitFor()
   await navigate('⌂ Home')
   await home.getByRole('button',{name:/Continue purchase order/}).waitFor()
   await page.reload()
   await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
   await home.getByRole('button',{name:/Continue purchase order/}).click()
   await page.locator('.po-expanded').filter({visible:true}).waitFor()
   assert.ok((await page.locator('.po-expanded').filter({visible:true}).innerText()).includes('PO-FIXTURE'),'Resume reopens the saved PO identity')
   await navigate('⇩ Receive Goods')
   await chooseOption(page.getByLabel('Purchase Order',{exact:true}),po.id)
   await page.getByText('0% received',{exact:true}).filter({visible:true}).waitFor()
   await navigate('⌂ Home')
   await home.getByRole('button',{name:/Continue delivery entry/}).click()
   await page.getByText('0% received',{exact:true}).filter({visible:true}).waitFor()
   await navigate('⌂ Home')
   await navigate('✓ Stock Entry')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   await page.getByLabel('Current stock: '+item.description,{exact:true}).fill('0')
   await page.waitForTimeout(250)
   await navigate('⌂ Home')
   await page.reload()
   await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
   await home.getByRole('button',{name:/Continue stock count/}).click()
   assert.equal(await page.getByRole('tab',{name:'Company Items',exact:true}).getAttribute('aria-selected'),'true')
   assert.equal(await page.getByLabel('Current stock: '+item.description,{exact:true}).inputValue(),'0','Company stock draft restores with its selected list')
   await navigate('⌂ Home')
   dashboardReviewFailure=true
   await home.getByRole('button',{name:'Refresh tasks',exact:true}).click()
   await home.getByRole('button',{name:/All .* task groups/}).click()
   await home.getByRole('button',{name:/Review shortages.*Retry/}).waitFor()
   assert.equal(await home.getByText('No pending tasks in your available work queues.',{exact:true}).count(),0)
   dashboardReviewFailure=false
   await home.getByRole('button',{name:/Review shortages.*Retry/}).click()
   await home.getByRole('button',{name:/Review shortages/}).filter({hasNotText:'Retry'}).waitFor()
   assert.equal(errors.length,0,errors.join('\n'))
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:'test-results/dashboard-phase-'+width+'.png'})
   console.log('PASS action-first dashboard, queue failure/retry, exact PO resume and receiving resume at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_REDESIGN==='1'){
   if(width<=700){
    const nav=page.getByRole('navigation',{name:'Main navigation',exact:true})
    assert.equal(await nav.getByRole('button').count(),5)
    for(const label of ['Home','Stock','Orders','Receive','More'])assert.ok(await nav.getByRole('button',{name:label,exact:true}).isVisible(),label+' missing: '+await nav.innerText())
   }
   await navigate('✓ Stock Entry')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   const view=page.locator('section:not([hidden])').filter({has:page.getByRole('heading',{name:'Company Lists',exact:true})})
   const current=view.getByLabel('Current stock: '+item.description,{exact:true})
   await current.waitFor()
   const dock=page.getByRole('region',{name:'Company count actions',exact:true})
   assert.ok(await dock.getByRole('button',{name:'Submit 0 items →',exact:true}).isDisabled())
   await current.fill('0')
   assert.ok(await dock.getByRole('button',{name:'Submit 1 item →',exact:true}).isEnabled(),'Zero is a counted item')
   await view.getByLabel('Search company items',{exact:true}).fill('Fixture switch')
   assert.ok(await dock.getByRole('button',{name:'Submit 1 item →',exact:true}).isEnabled(),'Submit count includes filtered-out entries')
   await view.getByLabel('Search company items',{exact:true}).fill('')
   await current.fill('1')
   await page.screenshot({path:'test-results/mobile-stock-'+width+'.png'})
   if(width<=700){
    await page.locator('.content').evaluate(el=>el.scrollTop=el.scrollHeight)
    const box=await dock.boundingBox(),navBox=await page.getByRole('navigation',{name:'Guided procurement navigation',exact:true}).boundingBox()
    assert.ok(box.y>=0&&box.y+box.height<=navBox.y,'Submit remains above navigation at the end of the list')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'Only the workspace scrolls')
   }
   await dock.getByRole('button',{name:'Submit 1 item →',exact:true}).click()
   await page.getByRole('dialog').getByRole('button',{name:'Continue',exact:true}).click()
   await view.getByText(/Existing purchase orders cover 1 shortage item/).waitFor()
   assert.equal(companyCountAttempt,1)
   assert.ok(await dock.getByRole('button',{name:'Submit 0 items →',exact:true}).isDisabled())
   await view.getByRole('button',{name:'Company setup',exact:true}).click()
   await view.getByText('Company suppliers & automation',{exact:true}).click()
   const setup=view.getByLabel('Company supplier automation',{exact:true})
   await setup.getByRole('navigation',{name:'Supplier setup steps'}).waitFor()
   await setup.getByRole('button',{name:'Next →',exact:true}).click()
   assert.ok(await setup.getByText('Supplier contacts (0)',{exact:true}).isVisible())
   assert.equal(await page.getByText('Designated company contact',{exact:true}).filter({visible:true}).count(),0)
   await setup.getByRole('button',{name:'+ Add supplier from directory',exact:true}).click()
   await setup.locator('.company-simple-directory').getByRole('checkbox').first().check()
   await setup.getByRole('button',{name:'Next →',exact:true}).click()
   assert.ok(await setup.getByText('After stock submission',{exact:true}).isVisible())
   assert.ok(await setup.getByRole('radio',{name:/Auto direct PO/}).isEnabled(),'One supplier enables the direct PO choice')
   await navigate('PO Orders')
   await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
   await page.getByText('0% received',{exact:true}).filter({visible:true}).waitFor()
   await page.getByRole('navigation',{name:'Purchasing sections'}).getByRole('button',{name:'Prices',exact:true}).click()
   await page.getByRole('button',{name:/^RFQ-FIXTURE/}).waitFor()
   await page.screenshot({path:'test-results/mobile-prices-'+width+'.png'})
   await navigate('⇩ Receive Goods')
   await chooseOption(page.getByLabel('Purchase Order',{exact:true}),po.id)
   await page.getByText('0% received',{exact:true}).filter({visible:true}).waitFor()
   const post=page.getByRole('button',{name:/^(Review receipt \(\d+\) →|Retry saved receipt)$/})
   if(width<=700){const a=await post.boundingBox(),b=await page.getByRole('navigation',{name:'Guided procurement navigation',exact:true}).boundingBox();assert.ok(a.y+a.height<=b.y,'Receiving action stays above navigation')}
   assert.equal(errors.length,0,errors.join('\n'))
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
   await page.screenshot({path:'test-results/mobile-redesign-'+width+'.png'})
   console.log('PASS guided mobile navigation, fixed count, zero/blank, filtering, submission, supplier steps and delivery progress at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_COMPANY_PO==='1'){
   await navigate('PO Orders')
   const general=page.getByRole('tab',{name:'General Items',exact:true}),companyTab=page.getByRole('tab',{name:'Company Items',exact:true})
   await page.getByRole('button',{name:/^PO-FIXTURE/}).waitFor()
   assert.equal(await page.getByRole('button',{name:/^PO-COMPANY-DIRECT/}).count(),0)
   await companyTab.click()
   const companyRow=page.getByRole('button',{name:/^PO-COMPANY-DIRECT/})
   await companyRow.waitFor();await page.getByRole('button',{name:/^PO-COMPANY-QUOTED/}).waitFor();assert.equal(await page.getByRole('button',{name:/^PO-FIXTURE/}).count(),0)
   assert.ok(queries.some(u=>u.pathname.endsWith('/proc_purchase_orders')&&u.searchParams.get('proc_po_is_company')==='eq.true'),'Company filtering runs before pagination')
   await companyRow.click()
   const bill=page.getByRole('region',{name:'Purchase order bill',exact:true})
   await bill.locator('.po-bill-line').waitFor()
   assert.match(await bill.innerText(),/Unit Rate.*Direct PO/s)
   await page.getByText('Direct PO — RFQ bypassed',{exact:true}).waitFor()
   assert.equal(await bill.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Direct PO rates fit on mobile')
   await general.click();await page.getByRole('button',{name:/^PO-FIXTURE/}).waitFor()
   assert.equal(await page.getByRole('region',{name:'Purchase order bill',exact:true}).count(),0,'Switching tabs closes the other tab order')
   await navigate('Q RFQs & Quotes');await page.getByRole('tab',{name:'Company RFQs',exact:true}).click()
   const history=page.getByLabel('Company RFQ history',{exact:true})
   await history.getByRole('button',{name:'Open PO',exact:true}).waitFor()
   assert.match(await history.innerText(),/Direct PO — RFQ bypassed.*Unit Rate: Direct PO/s)
   await history.getByRole('button',{name:'Open PO',exact:true}).click()
   await page.getByRole('region',{name:'Purchase order bill',exact:true}).waitFor()
   assert.equal(await page.getByRole('tab',{name:'Company Items',exact:true}).getAttribute('aria-selected'),'true')
   assert.deepEqual(errors,[])
   await page.screenshot({path:`test-results/company-direct-po-${width}.png`,fullPage:true})
   console.log('PASS separate PO tabs, direct rate remarks and company RFQ bypass history at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_HELD_SEARCH==='1'){
   await navigate('✓ Stock Entry')
   await page.locator('.stock-search-launch').click()
   await page.locator('#stock-global-search').fill('Fixture')
   await page.locator('.stock-search-hold input').click()
   await page.locator('.stock-held-summary').waitFor()
   const stock=page.locator(width<=700?'.browse-stock-input':'section:not([hidden]) .desktop-table input.stock-entry').filter({visible:true}).first()
   await stock.fill('7')
   await navigate('⌂ Home');await navigate('✓ Stock Entry')
   await page.locator('.stock-held-summary').waitFor()
   assert.equal(await stock.inputValue(),'7')
   await page.locator('.stock-search-launch').click()
   await page.locator('.stock-search-result').first().click()
   await page.locator('.stock-quick-modal .guided-entry input').fill('8')
   await page.getByRole('button',{name:'Save Stock',exact:true}).click()
   assert.equal(await stock.inputValue(),'8')
   assert.equal(await page.locator('.stock-held-summary').count(),1)
   const heldBar=await page.locator('.stock-held-summary').boundingBox()
   const searchLauncher=await page.locator('.stock-search-launch').boundingBox()
   assert.ok(heldBar&&searchLauncher&&heldBar.y<searchLauncher.y,'Clear & Unhold must be at the top, above search')
   await page.getByRole('button',{name:'Clear & Unhold',exact:true}).click()
   await page.locator('.stock-held-summary').waitFor({state:'hidden'})
   assert.equal(await stock.inputValue(),'8','Clearing and unholding must preserve entered stock')
   await page.locator('.stock-search-launch').click()
   assert.equal(await page.locator('#stock-global-search').inputValue(),'','Clear & Unhold must clear the search term')
   assert.equal(await page.locator('.stock-search-hold input').isChecked(),false,'Held results must be released')
   assert.ok((await page.getByRole('button',{name:'All Items',exact:true}).getAttribute('class')).includes('selected-choice'),'Search scope returns to All Items')
   assert.deepEqual(errors,[])
   console.log('PASS held stock search, draft restore, quick entry, and one-tap Clear & Unhold '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_SETTINGS_SEARCH==='1'){
   await navigate('⚙ Admin')
   const search=page.getByLabel('Search settings',{exact:true})
   await search.fill('screenshot')
   await page.getByText('2 matching sections',{exact:true}).waitFor()
   assert.equal(await page.locator('details.admin-accordion:not([hidden])').count(),2)
   await page.locator('.settings-search-results').getByRole('button',{name:'Screenshot Protection',exact:false}).click()
   const capture=page.locator('details.admin-accordion[open]').filter({hasText:'Screenshot Protection'})
   await capture.getByText('This browser has no verified capture control.',{exact:false}).waitFor()
   assert.equal(await capture.getByRole('button',{name:'Allow my screenshots for 5 minutes',exact:true}).isDisabled(),true,'Browser UI must not claim native screenshot control')
   await page.screenshot({path:`test-results/settings-search-${width}.png`,fullPage:true})
   await search.fill('not-a-real-setting-zzzz')
   await page.getByText('No matching settings. Try another word.',{exact:true}).waitFor()
   assert.equal(await page.locator('details.admin-accordion:not([hidden])').count(),0)
   await page.getByRole('button',{name:'Clear search',exact:true}).click()
   assert.ok(await page.locator('details.admin-accordion:not([hidden])').count()>5)
   await search.fill('radius');await search.press('Enter')
   await page.locator('details.admin-accordion[open]').filter({hasText:'Time & Location Restrictions'}).waitFor()
   // Emulate the protected native bridge only for testing the server-driven UI.
   await context.addInitScript(()=>{window.GHProcurementAndroid={refreshCapturePolicy:()=>{}}})
   await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await navigate('⚙ Admin')
   await page.getByLabel('Search settings',{exact:true}).fill('screenshot')
   await page.locator('.settings-search-results').getByRole('button',{name:'Screenshot Protection',exact:false}).click()
   await page.getByRole('button',{name:'Allow my screenshots for 5 minutes',exact:true}).click()
   await page.getByRole('button',{name:'Block screenshots now',exact:true}).waitFor()
   await page.getByRole('button',{name:'Block screenshots now',exact:true}).click()
   await page.getByRole('button',{name:'Allow my screenshots for 5 minutes',exact:true}).waitFor()
   assert.deepEqual(captureChanges.map(c=>c.p_enabled),[true,false])
   currentProfile={...profile,role:'viewer',role_key:'custom_test'};await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await navigate('⚙ Admin')
   await page.getByLabel('Search settings',{exact:true}).fill('screenshot')
   assert.equal(await page.getByRole('button',{name:'Allow my screenshots for 5 minutes',exact:true}).count(),0,'Staff never receive the capture override')
   assert.deepEqual(errors,[])
   console.log('PASS settings filtering, jump, no-results, browser disclaimer and Super Admin-only capture controls at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_RECORD_DELETE==='1'){
   await navigate('Q RFQs & Quotes');await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   await page.getByRole('button',{name:'Delete RFQ',exact:true}).click()
   const warning=page.getByRole('alertdialog',{name:'Delete RFQ',exact:true}),submit=warning.getByRole('button',{name:'Delete permanently',exact:true})
   await warning.waitFor();assert.equal(await submit.isDisabled(),true)
   await warning.getByLabel('Warning confirmation',{exact:true}).fill('WRONG')
   await warning.getByLabel('Warning reason',{exact:true}).fill('Fixture cleanup')
   assert.equal(await submit.isDisabled(),true);assert.equal(destructiveRequests.length,0)
   await warning.getByLabel('Warning confirmation',{exact:true}).fill('DELETE '+rfq.rfq_no)
   assert.equal(await submit.isEnabled(),true)
   await submit.click();await warning.getByText('Fixture operation blocked',{exact:true}).waitFor()
   assert.equal(destructiveRequests.length,1);assert.equal(destructiveRequests[0].body.p_token,'fixture-record-token')
   await warning.getByRole('button',{name:'Cancel',exact:true}).click()
   assert.deepEqual(errors,[]);console.log('PASS RFQ deletion preview, typed confirmation, reason and error handling at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_PICKERS==='1'){
   await navigate('⇩ Receive Goods')
   const trigger=page.getByLabel('Purchase Order',{exact:true})
   await trigger.click()
   const picker=page.getByRole('dialog',{name:'Purchase Order',exact:true})
   await picker.waitFor()
   await picker.getByRole('textbox').fill('no-such-order')
   await picker.getByText('No matching options.',{exact:true}).waitFor()
   await picker.getByRole('textbox').fill(po.po_no)
   assert.equal(await picker.locator('.picker-option').count(),1)
   assert.equal(await picker.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true)
   await page.screenshot({path:'test-results/'+width+'-modern-picker.png'})
   await picker.getByRole('textbox').press('Escape')
   await picker.waitFor({state:'hidden'})
   assert.equal(await trigger.evaluate(n=>n===document.activeElement),true,'Closing picker restores focus')
   await chooseOption(trigger,po.id)
   await page.getByLabel('Search receiving items',{exact:true}).waitFor()
   assert.ok((await trigger.innerText()).includes(po.po_no),'Selection is shown in trigger')
   await trigger.click()
   await page.locator('.picker-backdrop').click({position:{x:2,y:2}})
   await picker.waitFor({state:'hidden'})
   console.log('PASS compact picker search, empty state, selection, Escape, focus and outside dismissal at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_ACCESS==='1'){
   // Super Admin can open the workspace and configure defaults without GPS.
   await navigate('⚙ Admin')
   const controls=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Time & Location Restrictions'})})
   await controls.locator('summary').click()
   const radius=controls.locator('input[type=number]').last()
   await radius.fill('150');await controls.getByRole('button',{name:'Save access restrictions',exact:true}).click()
   await requireQuery(u=>u.pathname.endsWith('proc_admin_save_access_policy_v1'),'Access rules can be saved')
   assert.equal(Number(accessSaves[0].p_policy.radius_m),150);assert.equal(accessSaves[0].p_user_id,null)
   await page.screenshot({path:`test-results/access-settings-${width}.png`,fullPage:true})
   currentProfile={...profile,role:'viewer',role_key:'custom_test'}
   accessReason='outside_hours';queries.length=0;await page.reload()
   await page.getByText('Access is closed at this time.',{exact:false}).waitFor()
   assert.equal(await page.locator('.app').count(),0)
   assert.equal(queries.filter(u=>u.pathname.includes('/rest/v1/')&&!u.pathname.endsWith('proc_access_status_v1')).length,0,'Locked users never load workspace data')
   await page.screenshot({path:`test-results/access-hours-${width}.png`,fullPage:true})
   accessReason='location_required';await page.reload()
   await page.getByText('Verify your location to open the workspace.',{exact:true}).waitFor()
   await context.clearPermissions()
   await page.getByRole('button',{name:'Verify location / Retry',exact:true}).click()
   await page.getByText('Location permission is required.',{exact:false}).waitFor()
   assert.equal(await page.locator('.app').count(),0)
   await context.grantPermissions(['geolocation'],{origin:root})
   await context.setGeolocation({latitude:7.0552571,longitude:80.5345549,accuracy:5})
   await page.getByRole('button',{name:'Verify location / Retry',exact:true}).click()
   await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
   accessReason='outside_location';await page.reload()
   await page.getByText('You must be at the approved location to use this system.',{exact:true}).waitFor()
   assert.equal(await page.locator('.app').count(),0)
   accessReason='allowed';accessExpirySeconds=2;await page.reload()
   await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
   await page.getByText('Verify your location to open the workspace.',{exact:true}).waitFor({timeout:6000})
   assert.equal(await page.locator('.app').count(),0,'Server lease expiry locks an open workspace')
   assert.deepEqual(errors,[])
   console.log('PASS Super Admin, location permission, geofence, working-hours lock and active-session expiry at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_GROUP_SEND==='1'){
   // The old three-step 'Company supplier automation' wizard was deliberately
   // removed. Exercise the single current supplier workflow instead of probing
   // deleted UI, while separately retaining SQL/contract tests of send safety.
   await navigate('CL Company Lists')
   await chooseOption(page.getByLabel('Company list',{exact:true}),'company-fixture')
   const setupButton=page.getByRole('button',{name:'Company setup',exact:true})
   if(await setupButton.count())await setupButton.click()
   const workflow=page.getByLabel('RFQ and PO workflow settings',{exact:true})
   await workflow.locator('summary').first().click()
   const directory=workflow.getByLabel('Company workflow directory',{exact:true})
   await directory.getByRole('searchbox',{name:'Search companies, categories and suppliers',exact:true}).waitFor()
   const checklist=directory.getByRole('group',{name:'Company and category automation checklist',exact:true})
   await checklist.locator('.company-workflow-check-row').first().waitFor()
   assert.ok(await checklist.getByRole('checkbox',{name:/Auto RFQ for/}).count()>0,'Current workflow shows RFQ choices')
   assert.ok(await checklist.getByRole('checkbox',{name:/Auto PO for/}).count()>0,'Current workflow shows PO choices')
   assert.equal(await page.getByLabel('Company supplier automation',{exact:true}).count(),0,'Obsolete duplicate supplier wizard is removed')
   const recipients=checklist.locator('.company-workflow-supplier-link').first()
   await recipients.click()
   await checklist.getByText('Assigned contacts vs recipients',{exact:true}).first().waitFor()
   await checklist.getByText(/A Direct PO can have several assigned contacts but exactly one selected recipient/).first().waitFor()
   assert.equal(rfqGatewayRequests.length,0,'Opening supplier settings does not send RFQ images')
   assert.equal(groupRouteSaves.length,0,'Opening supplier settings does not modify route data')
   const advanced=workflow.getByLabel('Advanced group sending and templates',{exact:true})
   await advanced.locator('summary').first().click()
   await advanced.getByText('Advanced document templates & approved sending',{exact:true}).waitFor()
   await page.screenshot({path:'test-results/'+width+'-workflow-directory.png',fullPage:true})
   assert.deepEqual(errors,[])
   console.log('PASS current consolidated company RFQ/PO checklist, independent supplier recipients, and no side effects at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_CONTACT_PASTE==='1'){
   // Test the current one-by-one Supplier Directory, not the removed supplier wizard.
   await navigate('CL Company Lists')
   await chooseOption(page.getByLabel('Company list',{exact:true}),'company-fixture')
   const setupButton=page.getByRole('button',{name:'Company setup',exact:true})
   if(await setupButton.count())await setupButton.click()
   const directory=page.locator('.company-directory-panel')
   await directory.getByRole('button',{name:/Company Supplier Directory/}).click()
   await directory.locator('.company-directory-company-list button').filter({hasText:'Fixture company'}).first().click()
   const name=directory.getByLabel('Contact name',{exact:true})
   const phone=directory.getByLabel('WhatsApp number',{exact:true})
   const save=directory.getByRole('button',{name:'Save Contact & Add Next',exact:true})
   await name.fill('Sample local supplier')
   await phone.fill('+61 412345678')
   assert.equal(await save.isDisabled(),true,'Overseas numbers are rejected before saving')
   await phone.fill('0771234567')
   await directory.locator('.company-directory-number-preview').first().getByText(/Save as \+94771234567/).waitFor()
   assert.equal(await save.isEnabled(),true,'Correct Sri Lankan number enables a one-contact save')
   for(const label of ['Paste contact','Pick from phone','Pick phone number only','Receive from Contacts app','Import .vcf']){
    assert.equal(await directory.getByRole('button',{name:label,exact:true}).count(),0,'Obsolete duplicate contact entry action removed: '+label)
   }
   assert.equal(rfqGatewayRequests.length,0,'Typing or validating a supplier contact never sends an RFQ')
   assert.equal(groupRouteSaves.length,0,'Supplier directory entry does not change RFQ/PO routing')
   await page.screenshot({path:'test-results/'+width+'-contact-directory-validation.png',fullPage:true})
   assert.deepEqual(errors,[])
   console.log('PASS one-by-one company contact entry validates +94 numbers without duplicate paste tools at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_COMPANY_ITEMS==='1'){
   await navigate('✓ Stock Entry')
   const stockHeader=page.locator('section:not([hidden]) .stock-work-header')
   await stockHeader.getByRole('button',{name:/Submit Stock/}).waitFor()
   assert.equal(await page.getByRole('navigation',{name:'Guided procurement navigation',exact:true}).count(),0,'Procurement stage banner must not appear on Stock Entry')
   assert.equal(await page.locator('section:not([hidden]) .stock-simple-flow').count(),0,'Redundant Enter stock → Submit Stock → Review progress strip is absent')
   await page.locator('.stock-work-header').getByRole('button',{name:'Filters',exact:true}).click()
   assert.equal(await page.locator('.stock-filter-panel input[type="file"]').count(),0,'Paper sheet upload is not shown in Stock Entry')
   for(const label of ['FAST Checklist PDF','NORMAL Checklist PDF','SLOW Checklist PDF','Stock Taking PDF']){
    assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0,label+' is not shown in Stock Entry')
   }
   assert.equal(await page.getByRole('button',{name:'Customize & Print Stock PDF',exact:true}).count(),1,'The separate customizable printing tool is preserved')
   await page.getByRole('tab',{name:'Company Items',exact:true}).click()
   const view=page.locator('section:not([hidden])').filter({has:page.getByRole('heading',{name:'Company Lists',exact:true})})
   await view.locator('.company-item-name').first().waitFor()
   const enough=view.getByRole('checkbox',{name:'Sufficient stock: '+item.description,exact:true})
   const current=view.getByLabel('Current stock: '+item.description,{exact:true})
   await current.fill('5');await enough.check();assert.equal(await current.isDisabled(),true);assert.equal(await current.inputValue(),'')
   await enough.uncheck();assert.equal(await current.inputValue(),'5')
   assert.equal(await view.locator('.mobile-card-list').count(),0,'Company items keep compact rows on phones')
   assert.ok(await view.locator('.company-category-row').count()>0,'Category headings group company stock')
   const refresh=view.getByRole('button',{name:'Refresh company items',exact:true})
   await refresh.click()
   await view.locator('.company-item-name').first().waitFor()
   assert.equal(await view.getByLabel('Current stock: '+item.description,{exact:true}).inputValue(),'5','Refresh preserves unsent company stock')
   const grid=view.locator('.company-items-grid')
   assert.equal(await grid.getByRole('columnheader',{name:'Order',exact:true}).count(),0,'Calculated order is absent from company stock entry')
   assert.equal(await grid.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'All company stock columns fit without horizontal scrolling')
   assert.equal(await grid.getByRole('button',{name:'Remove',exact:true}).filter({visible:true}).count(),0,'Removal controls stay inside row editing')
   await grid.locator('details.company-item-edit summary').first().click()
   await view.getByLabel('Company item description',{exact:true}).first().waitFor()
   assert.equal(await view.getByLabel('Item movement',{exact:true}).count(),0,'Company item Edit excludes movement')
   assert.equal(await grid.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Expanded editing fits without horizontal scrolling')
   await grid.locator('details.company-item-edit summary').first().click()
   assert.equal(await view.locator('.company-stock-filters').getAttribute('open'),null)
   assert.equal(await view.locator('.company-stock-tools').getAttribute('open'),null)
   await view.locator('.company-stock-filters>summary').click()
   await chooseOption(view.getByLabel('Company list category',{exact:true}),'ELECTRICAL')
   assert.equal(await grid.locator('tbody tr.company-stock-item-row').count(),1)
   await view.getByRole('button',{name:'Clear filters',exact:true}).click()
   await grid.locator('tbody tr.company-stock-item-row').nth(1).waitFor()
   assert.equal(await grid.locator('tbody tr.company-stock-item-row').count(),2)
   assert.equal(await view.getByLabel('Company movement',{exact:true}).count(),0,'Company lists have no movement filter')
   assert.equal(await view.locator('.company-item-meta').first().getByText(/Movement/i).count(),0,'Compact item metadata excludes movement')
   await view.locator('.company-stock-tools>summary').click()
   await view.getByRole('button',{name:'Customize & Print Stock PDF',exact:true}).click()
   const print=page.getByRole('dialog',{name:'Stock PDF setup',exact:true})
   assert.equal(await print.getByLabel('Print movement',{exact:true}).count(),0,'Company PDFs include all movements')
   const download=page.waitForEvent('download');await print.getByRole('button',{name:'Download Printable PDF',exact:true}).click()
   const pdf=await download;const bytes=await readFile(await pdf.path());assert.ok(bytes.includes(Buffer.from('Stocks Verified By')))
   await print.getByRole('button',{name:'Close',exact:true}).click()
   const globalDisplay=view.locator('.company-row-layout-settings')
   await globalDisplay.locator('summary').click()
   assert.equal(await globalDisplay.getByLabel('Show Maximum stock',{exact:true}).count(),1,'A single global visibility toggle is available')
   await globalDisplay.getByLabel('Show Maximum stock',{exact:true}).uncheck()
   assert.equal(await globalDisplay.locator('.company-layout-preview .company-meta-max').count(),0,'Hiding Max immediately changes the preview')
   await globalDisplay.getByLabel('Show Maximum stock',{exact:true}).check()
   await chooseOption(globalDisplay.getByLabel('Size / variant row',{exact:true}),'second')
   assert.equal(await globalDisplay.locator('.company-layout-preview .company-second-line .company-layout-sample-size').count(),1,'Moving size updates the preview')
   await globalDisplay.locator('summary').click()
   const nestedManager=view.locator('.company-section-manager')
   await nestedManager.locator(':scope > summary').click()
   assert.equal(await nestedManager.getByLabel('Section parent',{exact:true}).count(),1,'Parent section picker is available')
   assert.equal(await nestedManager.getByLabel('Move items to section',{exact:true}).count(),1,'Bulk move destination is available')
   await nestedManager.locator(':scope > summary').click()
   await view.getByText('Company settings, groups, contacts & attachments',{exact:true}).click()
   assert.equal(await view.getByRole('checkbox',{name:'movement',exact:true}).count(),0,'Movement is absent from Company Items')
   assert.equal(await view.getByRole('checkbox',{name:'variation',exact:true}).count(),0,'Company-specific layout toggles were removed')
   assert.equal(await grid.evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,'Company stock table remains within the viewport')
   // Real submission wording distinguishes physical shortages from new requirement records.
   await current.fill('1')
   await view.getByRole('button',{name:'Submit Count',exact:true}).click()
   await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
   const result=view.getByRole('region',{name:'Company stock submission result',exact:true})
   await result.getByText(/Existing purchase orders cover 1 shortage item/).waitFor()
   assert.equal(await current.inputValue(),'','A saved count clears only the submitted draft')
   await current.fill('0')
   await view.getByRole('button',{name:'Submit Count',exact:true}).click()
   await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
   await result.getByText(/1 item\(s\) need review/).waitFor()
   await result.locator('summary').click()
   await result.getByText(/Stock shortage: 20.*In existing POs: 19.*Uncovered: 1/).waitFor()
   assert.equal(await result.getByText(/0 new shortage/).count(),0)
   assert.equal(companyCountAttempt,2)
   await page.screenshot({path:'test-results/company-items-'+width+'.png',fullPage:true})
   assert.deepEqual(errors,[])
   console.log('PASS company stock tab, compact rows, sufficient stock, full company PDF and field customization at '+width+'px')
   await context.close();continue
  }
  if(process.env.GH_UI_PRINT_TEMPLATES==='1'){
   await navigate('CL Company Lists')
   await chooseOption(page.getByLabel('Company list',{exact:true}),'company-fixture')
   await page.locator('.company-stock-tools>summary').filter({visible:true}).first().click()
   await page.getByRole('button',{name:'Customize & Print Stock PDF',exact:true}).filter({visible:true}).first().click()
   const print=page.getByRole('dialog',{name:'Stock PDF setup',exact:true});await print.waitFor()
   assert.equal(await print.getByLabel('Maximum tables per page',{exact:true}).getAttribute('data-value'),'3')
   assert.equal(await print.getByLabel('Print movement',{exact:true}).count(),0,'Company lists have no movement filtering')
   const download=page.waitForEvent('download');await print.getByRole('button',{name:'Download Printable PDF',exact:true}).click()
   const pdf=await download,bytes=await readFile(await pdf.path());const pdfText=b=>[...b.toString('latin1').matchAll(/\(([^()]*)\)\s*Tj/g)].map(m=>m[1]).join(' ');assert.ok(pdfText(bytes).includes('Fixture switch'));assert.ok(bytes.includes(Buffer.from('Stocks Checked By')))
   await writeFile('test-results/'+width+'-company-stock-custom.pdf',bytes)
   await chooseOption(print.getByLabel('Print subcategory',{exact:true}),'Switches')
   const one=page.waitForEvent('download');await print.getByRole('button',{name:'Download Printable PDF',exact:true}).click()
   const selected=await one,selectedBytes=await readFile(await selected.path());assert.ok(pdfText(selectedBytes).includes('Fixture switch'));assert.ok(!pdfText(selectedBytes).includes(item.description))
   await print.getByRole('button',{name:'Close',exact:true}).click()
   await navigate('Q RFQs & Quotes');await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
   await page.locator('.journey-shortcuts > summary').click();await chooseOption(page.getByLabel('Go to procurement section',{exact:true}),'3')
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
  await chooseOption(page.getByLabel('Company list',{exact:true}),'company-fixture')
  await page.getByRole('button',{name:'Back to stock',exact:true}).click()
  await page.locator('.company-item-name').filter({hasText:/fixture switch/i}).first().waitFor()
  const companyView=page.locator('section:not([hidden])').filter({has:page.getByRole('heading',{name:'Company Lists',exact:true})})
  await companyView.locator('.company-stock-filters>summary').click()
  await chooseOption(companyView.getByLabel('Company list category',{exact:true}),'ELECTRICAL')
  assert.equal(await companyView.locator('input[aria-label="Company item description"]').filter({hasNotText:'__unused__'}).evaluateAll((nodes,name)=>nodes.filter(n=>n.value===name).length,item.description),0)
  await chooseOption(companyView.getByLabel('Company list subcategory',{exact:true}),'Switches')
  await companyView.locator('.company-item-name').filter({hasText:/fixture switch/i}).first().waitFor()
  await companyView.getByRole('button',{name:'Company setup',exact:true}).click()
  await companyView.locator('.company-stock-tools>summary').click()
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
  const supplierRow=page.locator('section:not([hidden]) .supplier-directory-row').first()
  await supplierRow.locator('.supplier-directory-summary').waitFor()
  assert.equal(await supplierRow.locator('.supplier-directory-name').evaluate(node=>getComputedStyle(node).wordBreak!=='break-all'),true,'Supplier names must not wrap letter by letter')
  assert.equal(await supplierRow.getByRole('button',{name:'Delete supplier',exact:true}).isVisible(),false,'Supplier actions remain collapsed in the compact row')
  await supplierRow.locator('.supplier-directory-summary').click()
  await supplierRow.getByRole('button',{name:'Delete supplier',exact:true}).click()
  const supplierWarning=page.getByRole('alertdialog',{name:'Delete supplier',exact:true})
  assert.equal(await supplierWarning.getByRole('button',{name:'Delete permanently',exact:true}).isDisabled(),true)
  await supplierWarning.getByLabel('Warning confirmation',{exact:true}).fill('WRONG')
  assert.equal(await supplierWarning.getByRole('button',{name:'Delete permanently',exact:true}).isDisabled(),true)
  await supplierWarning.getByRole('button',{name:'Cancel',exact:true}).click()
  console.log('PASS company category/subcategory filters, company removal and supplier deletion confirmations at '+width+'px')
  await navigate('□ Items')
  await page.getByText('FIXTURE-ITEM',{exact:true}).filter({visible:true}).first().waitFor()
  await page.getByRole('button',{name:'+ Quick Add Item',exact:true}).filter({visible:true}).first().click()
  const quick=page.locator('.card').filter({has:page.getByRole('heading',{name:'Quick Add Item',exact:true})}).last()
  await quick.getByLabel('Item name',{exact:true}).fill('New fixture lock')
  await quick.getByLabel('Size',{exact:true}).fill('2 ft')
  await chooseOption(quick.getByRole('button',{name:'Category',exact:true}),'BATHROOM')
  await quick.getByRole('button',{name:'+ New category',exact:true}).click()
  await quick.getByRole('button',{name:'Use category',exact:true}).click()
  await quick.getByRole('alert').filter({hasText:'Enter a category name.'}).waitFor()
  await quick.getByLabel('New category name',{exact:true}).fill('  Special   fittings  ')
  await quick.getByRole('button',{name:'Use category',exact:true}).click()
  assert.equal(await quick.getByRole('button',{name:'Category',exact:true}).getAttribute('data-value'),'SPECIAL FITTINGS')
  await quick.getByRole('button',{name:'+ New category',exact:true}).click()
  await quick.getByLabel('New category name',{exact:true}).fill('special fittings')
  await quick.getByRole('button',{name:'Use category',exact:true}).click()
  await quick.getByRole('button',{name:'Category',exact:true}).click()
  assert.equal(await page.getByRole('button',{name:'SPECIAL FITTINGS',exact:true}).count(),1)
  await page.getByRole('button',{name:'SPECIAL FITTINGS',exact:true}).click()
  await quick.getByRole('button',{name:'Save Item',exact:true}).click()
  await page.getByRole('heading',{name:'Quick Add Item',exact:true}).waitFor({state:'hidden'})
  await requireQuery(url=>url.pathname.endsWith('/proc_quick_add_item_v1'),'Quick creation must use the guarded item API')
  console.log('PASS quick-add item creation and return to Item Master at '+width+'px')
  await navigate('⇩ Receive Goods')
  await chooseOption(page.getByLabel('Purchase Order',{exact:true}),po.id)
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
   await guide.getByText('Step 3 of 5 · Prices',{exact:true}).waitFor({state:'attached'})
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
   await guide.getByText('Step 3 of 5 · Prices',{exact:true}).waitFor({state:'attached'})
   await page.reload();await page.locator('.app').waitFor()
   await page.getByRole('button',{name:'Continue supplier request',exact:true}).click()
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().waitFor()
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'123.45','Refresh restores unsaved supplier prices')
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().fill('124.50')
   await page.reload();await page.locator('.app').waitFor();await page.getByRole('button',{name:'Continue supplier request',exact:true}).click()
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().waitFor()
   assert.equal(await page.locator('[data-rfq-price-item]').filter({visible:true}).first().inputValue(),'124.50','Immediate refresh flushes the latest draft before debounce')
   await page.locator('[data-rfq-price-item]').filter({visible:true}).first().fill('123.45');await page.waitForTimeout(400)
   savedQuotes.set(supplier.id,{id:'changed-server-quote',lines:[{id:'changed-line',rfq_item_id:'00000000-0000-4000-8000-000000000008',unit_price:222,notes:null}]})
   await page.reload();await page.locator('.app').waitFor();await page.getByRole('button',{name:'Continue supplier request',exact:true}).click()
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
   await page.reload();await page.locator('.app').waitFor();await page.getByRole('button',{name:'Continue supplier request',exact:true}).click()
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
   await page.getByText('Step 4 of 5 · Order',{exact:true}).waitFor({state:'attached'})
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
   await chooseOption(settings.getByRole('button',{name:/Preview device/}),'desktop')
   await setRange(settings.getByRole('slider',{name:/^Item description/}),20)
   assert.equal(await settings.getByRole('slider',{name:/^Reorder level/}).inputValue(),'18','Mobile preset does not change desktop settings')
   await chooseOption(settings.getByRole('button',{name:/Preview device/}),'mobile')
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
    await panel.getByLabel('Send RFQ to '+newSupplier.name,{exact:true}).uncheck()
    const manual=panel.getByRole('button',{name:'Prepare PNG + Caption for 2 Suppliers · Manual sharing',exact:true})
    assert.equal(await manual.isEnabled(),true,'Manual sharing is available with the gateway offline')
    await manual.click()
    const manualPanel=panel.getByRole('region',{name:'Manual supplier sharing',exact:true})
    assert.equal(await manualPanel.getByRole('button',{name:/^Prepare PNG · /}).count(),2,'Only the selected suppliers enter the manual queue')
    await page.evaluate(()=>{
     window.fixtureShares=[]
     Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true})
     Object.defineProperty(navigator,'share',{configurable:true,value:async data=>{window.fixtureShares.push({text:data.text,name:data.files[0].name,size:data.files[0].size,type:data.files[0].type})}})
    })
    await manualPanel.getByRole('button',{name:'Prepare PNG · '+supplier.name,exact:true}).click()
    await manualPanel.getByRole('button',{name:'Share PNG + Caption · '+supplier.name,exact:true}).click()
    const shared=await page.evaluate(()=>window.fixtureShares)
    assert.equal(shared.length,1);assert.ok(shared[0].text.includes(supplier.name));assert.equal(shared[0].type,'image/png');assert.ok(shared[0].size>0)
    const privateLink=manualPanel.getByRole('link',{name:'Private quote link · '+supplier.name,exact:true})
    assert.equal(await privateLink.getAttribute('href'),'/supplier-links?rfq='+rfq.id+'&supplier='+supplier.id)
    await manualPanel.getByRole('button',{name:'Prepare PNG · '+thirdSupplier.name,exact:true}).click()
    await manualPanel.getByLabel('PNG caption for '+thirdSupplier.name,{exact:true}).waitFor()
    assert.ok((await manualPanel.getByLabel('PNG caption for '+thirdSupplier.name,{exact:true}).inputValue()).includes(thirdSupplier.name))
    const downloadEvent=page.waitForEvent('download')
    await manualPanel.getByRole('button',{name:'Download PNG',exact:true}).click()
    assert.match((await downloadEvent).suggestedFilename(),/\.png$/)
    assert.equal(rfqGatewayRequests.length,0,'Manual preparation and native sharing never call automatic dispatch')
    await panel.getByLabel('Send RFQ to '+thirdSupplier.name,{exact:true}).uncheck()
    await panel.getByRole('button',{name:'Prepare PNG + Caption for 1 Supplier · Manual sharing',exact:true}).click()
    assert.equal(await manualPanel.getByRole('button',{name:/^Prepare PNG · /}).count(),1,'One selected supplier gets one manual entry')
    await panel.getByLabel('Send RFQ to '+thirdSupplier.name,{exact:true}).check()

    await panel.getByLabel('Send RFQ to '+newSupplier.name,{exact:true}).check()

    bulkReady=true;await panel.getByRole('button',{name:'Refresh status',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('.rfq-bulk-send-button')?.disabled===false)
    await panel.getByLabel('Send RFQ to '+newSupplier.name,{exact:true}).uncheck()
    await panel.getByRole('button',{name:'Send PNG + Caption to 2 Suppliers',exact:true}).click()
    await panel.getByText('2 / 2 requests accepted for sending.',{exact:false}).waitFor()
    assert.deepEqual(rfqGatewayRequests.map(r=>r.supplierId),[supplier.id,thirdSupplier.id],'Unchecked suppliers receive neither caption nor image')
   }
   if(width===320){
    await context.route('**/rest/v1/rpc/proc_portal_staff_responses_v1',route=>route.fulfill({status:404,json:{code:'PGRST202',message:'Function not found'}}))
    await page.goto(root+'/supplier-links?rfq='+rfq.id+'&supplier='+supplier.id)
    await page.getByText('Supplier portal setup is pending',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Create link',exact:true}).count(),1,'Supplier link entry scopes to the selected supplier')
    assert.equal(await page.getByRole('button',{name:'Create link',exact:true}).isDisabled(),true,'Unavailable database setup cannot issue a broken link')
    assert.equal(await page.getByRole('heading',{name:'Quotation round and purchase safeguards'}).count(),0)
    await page.getByRole('button',{name:'Show all RFQ suppliers',exact:true}).click()
    assert.equal(await page.getByRole('button',{name:'Create link',exact:true}).count(),3)
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
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'2','Stock submission automatically advances to Review')
  if(process.env.GH_UI_GUIDE_APPROVAL==='1'){
   rfqItemCount=1
   await page.getByRole('button',{name:'Select All Visible',exact:true}).click()
   await page.getByRole('button',{name:'Approve & Continue',exact:true}).click()
   const builder=page.locator('.rfq-builder')
   await builder.waitFor()
   assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'3','Approval advances to the supplier builder')
   await builder.getByLabel(supplier.name,{exact:true}).check()
   await builder.getByPlaceholder('Required override reason',{exact:true}).fill('Guided workflow test supplier')
   await builder.getByRole('button',{name:'Create RFQ & Continue',exact:true}).click()
   await page.getByRole('heading',{name:'RFQ-FIXTURE',exact:true}).waitFor()
   assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'3','Creation opens the exact RFQ at the sending step')
   await page.locator('.rfq-individual-options > summary').click()
   await page.getByRole('button',{name:'Confirm Sent',exact:true}).click()
   await page.getByRole('dialog',{name:'Review and continue',exact:true}).getByRole('button',{name:'Continue',exact:true}).click()
   await page.waitForFunction(()=>document.querySelector('[aria-label="Go to procurement section"]')?.getAttribute('data-value')==='4')
   const price=page.locator('[data-rfq-price-item]').filter({visible:true}).first()
   await price.waitFor();await price.fill('05');assert.equal(await price.inputValue(),'5');await price.fill('123.45')
   if(width<760){const row=page.locator('.quote-bill-row').first();assert.ok((await row.boundingBox()).height<160,'Long item stays compact');await row.locator('summary').click();await row.getByRole('button',{name:'+ Add size variation',exact:true}).click();await row.getByPlaceholder('e.g. 1½ inch').fill('2 feet');await row.getByPlaceholder('Price',{exact:true}).fill('40');await row.getByLabel('Additional size required quantity',{exact:true}).fill('6');await page.screenshot({path:'test-results/compact-quote-variation-'+width+'.png'});await row.getByRole('button',{name:'Remove size',exact:true}).click();await row.locator('summary').click()}
   await page.getByRole('button',{name:/^Save & (Next Supplier|Compare Prices)/}).click()
   await page.waitForFunction(()=>document.querySelector('[aria-label="Go to procurement section"]')?.getAttribute('data-value')==='5')
   await page.getByRole('button',{name:'Review & Create Supplier Orders',exact:true}).click()
   await page.locator('.award-review').waitFor()
   assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'6')
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
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'2')
  await guide.getByRole('button',{name:'Next procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'3','Next enters the RFQ section on the same screen')
  await page.getByRole('button',{name:'Go back',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'2','History Back restores the previous guided section')
  await chooseOption(guide.getByLabel('Go to procurement section',{exact:true}),'1')
  assert.equal(await historyStockInput.inputValue(),'8','Guided navigation preserves unsent stock entries')
  await chooseOption(guide.getByLabel('Go to procurement section',{exact:true}),'4')
  await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
  await guide.getByRole('button',{name:'Next procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'5')
  await page.getByRole('region',{name:'Scrollable supplier prices',exact:true}).waitFor()
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
  await page.screenshot({path:'test-results/guided-comparison-'+width+'.png'})
  await guide.getByRole('button',{name:'Previous procurement step',exact:true}).click()
  assert.equal(await guide.getByLabel('Go to procurement section',{exact:true}).getAttribute('data-value'),'4')
  await chooseOption(guide.getByLabel('Go to procurement section',{exact:true}),'1')
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
  await page.getByRole('heading',{name:'Data Management · Super Admin only',exact:true}).waitFor()
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
    await chooseOption(page.getByLabel('Reset option',{exact:true}),scope)
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
  await chooseOption(page.getByLabel('Reset option',{exact:true}),'full')
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
  await chooseOption(page.getByLabel('Reset option',{exact:true}),'stock')
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

   if(card==='Open requirements'){
    // Regression: compact procurement controls must never overlap on phones
    // or on the standard tablet/desktop test widths.
    const geometry=await page.evaluate(()=>{
     const screen=document.querySelector('section:not([hidden])')
     const selectors={
      queue:'.procurement-work-queues',focus:'.procurement-focus-row',
      focusLabel:'.procurement-focus-row>label',focusSelect:'#proc-attention-filter',
      sort:'.procurement-sort-row',sortButton:'.procurement-sort-row>.btn',
      sortHelp:'.procurement-waiting-help'
     }
     return Object.fromEntries(Object.entries(selectors).map(([name,selector])=>{
      const el=screen?.querySelector(selector)
      if(!el)return [name,null]
      const r=el.getBoundingClientRect()
      return [name,{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}]
     }))
    })
    for(const [name,box] of Object.entries(geometry))assert.ok(box&&box.width>0&&box.height>0,'Procurement '+name+' must have a visible layout at '+width+'px')
    assert.ok(geometry.queue.bottom<=geometry.focus.top+1,'Work queues must not overlap the Focus filter at '+width+'px')
    assert.ok(geometry.focus.bottom<=geometry.sort.top+1,'Focus filter must not overlap sorting controls at '+width+'px')
    const intersects=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1
    assert.ok(!intersects(geometry.focusLabel,geometry.focusSelect),'Focus label and dropdown must not overlap at '+width+'px')
    assert.ok(!intersects(geometry.sortButton,geometry.sortHelp),'Sorting button and help must not overlap at '+width+'px')
    console.log('PASS procurement queue/focus/sort layout spacing at '+width+'px')
   }
   await navigate('⌂ Home')
  }
  if(width===320){
   exceptionFixtures=true
   await navigate('! Exceptions')
   const queue=page.locator('.card').filter({has:page.getByRole('heading',{name:'Priority Queue',exact:true})})
   await queue.getByRole('button',{name:'Refresh',exact:true}).click()
   await queue.getByText('1011 active action(s)',{exact:true}).waitFor()
   await chooseOption(queue.locator('.modern-select').nth(1),'customer_paid')
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
    await chooseOption(page.getByLabel('Comparison filter',{exact:true}),'missing')
    assert.equal(await sheet.locator('tbody tr').count(),99,'Missing items are explicit')
    await chooseOption(page.getByLabel('Comparison filter',{exact:true}),'all')
    await page.getByLabel('Search comparison items',{exact:true}).fill('Bathroom fixture 99')
    assert.equal(await sheet.locator('tbody tr').count(),1,'Comparison search finds sparse items')
    await page.getByLabel('Search comparison items',{exact:true}).fill('')
    await chooseOption(page.getByLabel('Comparison filter',{exact:true}),'single')
    assert.equal(await sheet.locator('tbody tr').count(),1,'Single quote filter handles a sparse 100-item request')
    await chooseOption(page.getByLabel('Comparison filter',{exact:true}),'all')
    await page.locator('summary').filter({hasText:'Choose request items'}).click()
    await chooseOption(page.getByLabel('Request category',{exact:true}),'BATHROOM')
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
    await pickerHasOption(quoteSelect,supplier.id)
    assert.equal(await pickerOptionCount(quoteSelect),1,'Directory suppliers are not implicitly invited')
    directory=[supplier,newSupplier]
    await page.getByRole('button',{name:'Refresh Suppliers',exact:true}).click()
    await pickerHasOption(newSelect,newSupplier.id)
    await chooseOption(page.getByLabel('Price entry filter',{exact:true}),'all')
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

    await chooseOption(newSelect,newSupplier.id)
    await page.getByRole('button',{name:'Add to RFQ',exact:true}).click()
    await page.getByText('Fixture invitation failure',{exact:true}).waitFor()
    assert.equal(await pickerOptionCount(quoteSelect),1,'Failed additions do not create phantom suppliers')
    assert.equal(await price.inputValue(),'123.45','Failed additions preserve price drafts')
    addFailure=false
    await page.getByRole('button',{name:'Add to RFQ',exact:true}).click()
    await pickerHasOption(quoteSelect,newSupplier.id)
    await page.evaluate(()=>{const channel=new BroadcastChannel('sb-huxhcjmcvlhblvpvrron-auth-token');channel.postMessage({event:'TOKEN_REFRESHED',session:JSON.parse(localStorage.getItem('sb-huxhcjmcvlhblvpvrron-auth-token'))});channel.close()})
    await page.waitForTimeout(500)
    assert.equal(await price.inputValue(),'123.45','Token refresh preserves unsaved quote input')
    assert.equal(await price.inputValue(),'123.45','Successful additions preserve the existing price draft')
    assert.equal(await quoteSelect.getAttribute('data-value'),supplier.id,'Adding a supplier keeps the selected quotation')
    assert.equal(await pickerOptionCount(newSelect,newSupplier.id),0,'Already invited suppliers cannot be selected again')
    await attachment.setInputFiles({name:'supplier-A.pdf',mimeType:'application/pdf',buffer:Buffer.from('Fixture attachment, never uploaded')})
    quoteReadFailure=newSupplier.id
    await chooseOption(quoteSelect,newSupplier.id)
    await chooseOption(page.getByLabel('Price entry filter',{exact:true}),'all')
    await page.getByRole('button',{name:'Reload Supplier Prices',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:/^Save & (Next Supplier|Compare Prices)/}).isDisabled(),true,'Failed quote loads block overwriting existing prices')
    await page.getByRole('button',{name:'Reload Supplier Prices',exact:true}).click()
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'','The new supplier has a separate quotation')
    assert.equal(await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).count(),0,'Alternative sizes remain isolated to their supplier')
    assert.equal(await page.getByText('Selected attachment: supplier-A.pdf',{exact:true}).count(),0,'Attachments stay with their supplier')
    await price.fill('777')
    await chooseOption(quoteSelect,supplier.id)
    await chooseOption(page.getByLabel('Price entry filter',{exact:true}),'all')
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'123.45','Switching suppliers restores unsaved prices')
    assert.equal(await page.getByPlaceholder('e.g. 1½ inch',{exact:true}).first().inputValue(),'3 inch','Supplier draft restores alternative sizes')
    await page.getByText('Selected attachment: supplier-A.pdf',{exact:true}).waitFor()
    await chooseOption(quoteSelect,newSupplier.id)
    await chooseOption(page.getByLabel('Price entry filter',{exact:true}),'all')
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'777','Each supplier retains its own draft')
    await page.getByRole('button',{name:/^Save & (Next Supplier|Compare Prices)/}).click()
    await page.getByText('1 supplier item price(s) saved.',{exact:false}).waitFor()
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await quoteSelect.getAttribute('data-value'),newSupplier.id,'Saving does not return to the first supplier')
    assert.equal(await price.inputValue(),'777','The saved supplier quote reloads correctly')
    await chooseOption(quoteSelect,supplier.id)
    await chooseOption(page.getByLabel('Price entry filter',{exact:true}),'all')
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    await attachment.setInputFiles([])
    await page.getByRole('button',{name:'Save & Next Supplier →',exact:true}).click()
    await page.waitForFunction(id=>document.querySelector('#rfq-quote-supplier')?.getAttribute('data-value')===id,newSupplier.id)
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await price.inputValue(),'777','Save automatically advances without overwriting the next supplier quote')
    await page.getByRole('button',{name:'+ Quick Create Supplier',exact:true}).click()
    await page.getByLabel('Supplier name',{exact:true}).fill('Quick RFQ Supplier')
    await page.getByLabel('Phone / WhatsApp',{exact:true}).fill('+94771234567')
    await page.getByRole('button',{name:'Create & Select Supplier',exact:true}).click()
    await page.waitForFunction(()=>document.querySelector('#rfq-add-supplier')?.getAttribute('data-value')==='quick-created-supplier')
    assert.equal(await quoteSelect.getAttribute('data-value'),newSupplier.id,'Quick creation preserves the current supplier quotation')

    await page.getByRole('button',{name:'View Price Comparison',exact:true}).click()
    await sheet.getByRole('button',{name:'Enter or edit price for '+item.description+' · '+item.size+' from '+supplier.name,exact:true}).click()
    await page.waitForFunction(()=>{const input=document.querySelector('[data-rfq-price-item]');return !!input&&!input.disabled})
    assert.equal(await quoteSelect.getAttribute('data-value'),supplier.id,'Tapping a comparison price selects its supplier')
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
    await chooseOption(selector,po.id)
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
    await page.reload();await page.getByRole('heading',{name:'Home',exact:true}).waitFor();await navigate('⇩ Receive Goods');await chooseOption(selector,po.id)
    await page.getByLabel('Search receiving items',{exact:true}).waitFor()
    assert.equal(await page.locator('.receive-full-check input,.desktop-table tbody input[type="checkbox"]').filter({visible:true}).first().isChecked(),true,'Receiving values survive reload')
    for(const poId of [po.id,otherPo.id,po.id]){
     if(await selector.getAttribute('data-value')!==poId){
      const loaded=page.waitForResponse(r=>{const u=new URL(r.url());return u.pathname.endsWith('/proc_po_lines')&&u.searchParams.get('po_id')==='eq.'+poId})
      await chooseOption(selector,poId);await loaded
     }
     await page.getByLabel('Search receiving items',{exact:true}).waitFor()
     const savedAttempt=await page.evaluate(id=>JSON.parse(localStorage.getItem('gh_receiving_draft_v1:00000000-0000-4000-8000-000000000002:'+id)||'null')?.attempt,poId)
     if(savedAttempt)await page.getByText('A receipt attempt is saved.',{exact:false}).waitFor()
     else await page.getByRole('button',{name:'✓ Mark All Remaining Received',exact:true}).click()
     await page.getByRole('button',{name:/^(Review receipt \(\d+\) →|Retry saved receipt)$/}).click()
     await page.getByRole('dialog',{name:'2. Review receipt',exact:true}).getByRole('button',{name:'Post receipt',exact:true}).click()
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
    await page.getByRole('button',{name:'Delete purchase order',exact:true}).click()
    const orderWarning=page.getByRole('alertdialog',{name:'Delete purchase order',exact:true})
    const confirmOrder=orderWarning.getByRole('button',{name:'Delete permanently',exact:true})
    await orderWarning.getByLabel('Warning confirmation',{exact:true}).fill('DELETE '+po.po_no)
    assert.equal(await confirmOrder.isDisabled(),true,'Clearing an order also requires a reason')
    await orderWarning.getByRole('button',{name:'Cancel',exact:true}).click()
    assert.equal(destructiveRequests.filter(r=>r.name==='proc_admin_delete_record_v1').length,0)
    await page.getByRole('button',{name:'Delete purchase order',exact:true}).click()
    await orderWarning.getByLabel('Warning confirmation',{exact:true}).fill('DELETE '+po.po_no)
    await orderWarning.getByLabel('Warning reason',{exact:true}).fill('Fixture order cleanup')
    await confirmOrder.click()
    await orderWarning.getByText('Fixture operation blocked',{exact:true}).waitFor()
    assert.equal(destructiveRequests.filter(r=>r.name==='proc_admin_delete_record_v1').length,1)
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
     await page.getByText('Automatic WhatsApp gateway · optional',{exact:true}).click()
     await page.getByRole('button',{name:'Automatic gateway send',exact:true}).click()
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
   {role:'receiver',grants:['procurement.orders.view','receiving.manage','receiving.view'],landing:'Receive'},
   {role:'document_assistant',grants:['price_lists.manage','price_lists.view'],landing:'Price Lists'},
   {role:'stock_checker',grants:['company_lists.view','items.view','stock.count.enter','stock.count.view','stock.search','urgent.manage','urgent.view'],landing:'Stock'},
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
