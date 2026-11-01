// Browser UX acceptance uses intercepted RPCs; database ownership/OTP rules are
// exercised against the real isolated schema in supplier-verified-access.test.mjs.
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir} from 'node:fs/promises'
import assert from 'node:assert/strict'
const root='http://127.0.0.1:3103',token='a'.repeat(64),session='b'.repeat(64),account='c'.repeat(64)
const cid='00000000-0000-4000-8000-000000000010',sid='00000000-0000-4000-8000-000000000011',iid='00000000-0000-4000-8000-000000000012',inv='00000000-0000-4000-8000-000000000013',pid='00000000-0000-4000-8000-000000000014'
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3103'],{stdio:'ignore'})
let browser
try{
 for(let i=0;i<150;i++){try{if((await fetch(root)).ok)break}catch{}if(i===149)throw Error('Local server unavailable');await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true,executablePath:process.env.GH_UI_BROWSER_EXECUTABLE||process.env.GH_UI_BROWSER_PATH,args:['--no-sandbox','--disable-dev-shm-usage']})
 const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[]
 let quoteRevision=0,quoteResponse=[],standing=[],saved=[],deliveryRecorded=false
 const quote=()=>({rfq_no:'RFQ-VERIFIED-QA',supplier_name:'Fixture supplier',server_now:new Date().toISOString(),closes_at:new Date(Date.now()+21600000).toISOString(),can_edit:true,revision:quoteRevision,status:'draft',response:quoteResponse,items:[{id:iid,description:'BRASS ELBOW',size:'2 inch',uom:'PCS',requested_qty:10}]})
 const home=()=>({supplier:'Fixture supplier',requests:[{invitation:inv,number:'RFQ-VERIFIED-QA',status:'sent',revoked:false}],items:[{id:iid,description:'BRASS ELBOW',size:'2 inch',uom:'PCS'}],standing})
 await context.route('https://*.supabase.co/**',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').at(-1),body=route.request().postDataJSON();let data
  if(name==='proc_portal_read_v1')data={verification_required:true}
  else if(name==='proc_supplier_request_code_v1'){assert.match(body.p_phone,/0770000123/);data={ok:true,challenge_id:cid,expires_in:300}}
  else if(name==='proc_supplier_verify_code_v1'){assert.equal(body.p_code,'123456');data={ok:true,session}}
  else if(name==='proc_supplier_quote_read_v1'){assert.equal(body.p_session,session);data=quote()}
  else if(name==='proc_supplier_quote_submit_v1'){assert.equal(body.p_session,session);assert.equal(body.p_expected_revision,quoteRevision);quoteResponse=body.p_response;quoteRevision++;data={revision:quoteRevision,status:body.p_confirm?'confirmed':'draft'}}
  else if(name==='proc_supplier_account_read_v1'){assert.equal(body.p_session,session);data=home()}
  else if(name==='proc_supplier_standing_save_v1'){assert.equal(body.p_session,session);assert.equal(body.p_lines[0].uom,'PCS');saved.push(body);data={id:pid,supplier_id:sid,revision:(body.p_expected_revision||0)+1,state:body.p_confirm?'submitted':'draft',valid_until:body.p_valid_until,lines:body.p_lines,snapshots:[{item_id:iid,description:'BRASS ELBOW',size:'2 inch',uom:'PCS'}],updated_at:new Date().toISOString()};standing=[data]}
  else if(name==='proc_supplier_access_staff_v1')data={suppliers:[{id:sid,name:'Fixture supplier',phone:'+94770000123',account_id:null}],challenges:[{id:cid,supplier:'Fixture supplier',phone:'+94770000123',issued:false,sent:deliveryRecorded,expires_at:new Date(Date.now()+300000).toISOString()}],standing:standing.map(p=>({...p,supplier_name:'Fixture supplier'})),reuse_requests:[{id:inv,supplier_id:sid,number:'RFQ-VERIFIED-QA',revision:0}]}
  else if(name==='proc_supplier_issue_code_v1')data={challenge_id:cid,phone:'+94770000123',code:'123456',expires_at:new Date(Date.now()+300000).toISOString()}
  else if(name==='proc_supplier_mark_code_sent_v1'){deliveryRecorded=true;data=true}
  else if(name==='proc_supplier_account_issue_v1')data={id:sid}
  else if(name==='proc_supplier_standing_review_v1'){standing[0]={...standing[0],state:body.p_approve?'approved':'rejected'};data=standing[0]}
  else if(name==='proc_supplier_standing_reuse_v1'){assert.equal(body.p_invitation,inv);data={status:'draft',revision:1}}
  else throw Error('Unexpected supplier verification API: '+name)
  await route.fulfill({json:data})
 })
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
 await page.goto(root+'/supplier/quote#token='+token)
 await page.getByRole('heading',{name:'Verify your phone',exact:true}).waitFor()
 assert.equal(await page.locator('.sq-row').count(),0,'No quote details before phone verification')
 await page.getByLabel('Supplier directory phone number',{exact:true}).fill('0770000123')
 await page.getByRole('button',{name:'Request code',exact:true}).click()
 await page.getByLabel('6-digit code',{exact:true}).fill('123456')
 await page.getByRole('button',{name:'Verify phone',exact:true}).click()
 await page.getByLabel('Price for BRASS ELBOW',{exact:true}).fill('35')
 await page.getByLabel('Quantity for BRASS ELBOW',{exact:true}).fill('8')
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').getByText(/Draft saved/).waitFor()
 assert.equal(new URL(page.url()).hash,'','Bearer links leave the address bar after initialization')
 await page.goto(root+'/supplier/portal#account='+account)
 await page.getByRole('heading',{name:'Verify your phone',exact:true}).waitFor()
 await page.getByLabel('Supplier directory phone number',{exact:true}).fill('0770000123');await page.getByRole('button',{name:'Request code',exact:true}).click()
 await page.getByLabel('6-digit code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify phone',exact:true}).click()
 await page.getByRole('button',{name:'New price version',exact:true}).waitFor()
 await page.getByLabel('Valid until',{exact:true}).fill(new Date(Date.now()+86400000).toISOString().slice(0,10))
 await page.getByRole('checkbox').check();await page.getByLabel('Standing rate BRASS ELBOW',{exact:true}).fill('40');await page.getByLabel('Standing quantity BRASS ELBOW',{exact:true}).fill('10')
 await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').getByText('Draft saved.',{exact:true}).waitFor();assert.equal(saved[0].p_confirm,false)
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Final confirm',exact:true}).click();await page.getByRole('status').getByText(/Version submitted/).waitFor();assert.equal(saved[1].p_confirm,true)
 await mkdir('test-results',{recursive:true})
 for(const width of [320,390,768]){
  await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Reusable portal fits '+width)
  await page.screenshot({path:'test-results/verified-supplier-portal-'+width+'.png',fullPage:true})
 }
 await page.getByRole('button',{name:'தமிழ்',exact:true}).click();await page.getByRole('heading',{name:'சப்ளையர் தளம்',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
 await page.screenshot({path:'test-results/verified-supplier-portal-tamil.png',fullPage:true})
 await page.getByRole('link',{name:'விலைகளை உள்ளிடுக',exact:true}).click();await page.getByLabel('Price for BRASS ELBOW',{exact:true}).waitFor()
 await page.goto(root+'/supplier-access');await page.getByRole('heading',{name:'Supplier access',exact:true}).waitFor()
 await page.getByRole('button',{name:'Generate code',exact:true}).click();await page.getByText('123456',{exact:true}).waitFor()
 await page.getByRole('button',{name:'I sent this code to the directory number',exact:true}).click();await page.getByRole('status').getByText(/Delivery recorded/).waitFor()
 await page.getByRole('button',{name:'Generate reusable link',exact:true}).click();await page.getByLabel('New reusable supplier link',{exact:true}).waitFor()
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Approve version',exact:true}).click();await page.getByRole('button',{name:'Choose for draft reuse',exact:true}).click()
 await page.getByLabel('Choose an open, empty request for this supplier',{exact:true}).selectOption(inv)
 await page.getByRole('button',{name:'Copy into empty supplier draft',exact:true}).click();await page.getByRole('status').getByText(/Standing prices copied/).waitFor()
 await page.screenshot({path:'test-results/verified-supplier-staff.png',fullPage:true})
 assert.deepEqual(errors,[])
 console.log('PASS verified quotation gate, reusable account, standing draft/final confirmation, EN/TA mobile layouts, staff code delivery and approved draft reuse; mocked RPCs')
}finally{await browser?.close();server.kill('SIGTERM')}
