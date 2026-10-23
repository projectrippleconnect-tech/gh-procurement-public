// Local production build + intercepted supplier API; no production writes or supplier messages.
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import sharp from 'sharp'
const root='http://127.0.0.1:3102',token='a'.repeat(64)
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3102'],{stdio:'ignore'})
let browser
const results=[]
try{
 for(let i=0;i<150;i++){try{if((await fetch(root)).ok)break}catch{}if(i===149)throw Error('Local server unavailable');await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true,executablePath:process.env.GH_UI_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']})
 const context=await browser.newContext({viewport:{width:390,height:844}})
 let revision=0,response=[],status='draft',saves=[]
 const items=[{id:'00000000-0000-4000-8000-000000000001',description:'GI PIPE WITH A VERY LONG DESCRIPTION FOR MOBILE WRAPPING',size:'2 inch',uom:'PCS',requested_qty:10},{id:'00000000-0000-4000-8000-000000000002',description:'CYCLE LOCK',size:'2 ft',uom:'PCS',requested_qty:6}]
 let verified=false
 await context.route(root+'/api/supplier/portal',async route=>{
  const request=route.request(),input=request.postDataJSON(),name=input.action==='read'?'proc_portal_read_v1':input.action==='submit'?'proc_portal_submit_v1':input.action
  const body={p_token:input.token,p_response:input.response,p_expected_revision:input.revision,p_confirm:input.confirm}
  if(name==='request'){assert.equal(input.phone,'0771234567');return route.fulfill({json:{ok:true,challenge:'qa-challenge',masked_phone:'+94 ••• •• 4567'}})}
  if(name==='verify'){assert.equal(input.code,'123456');verified=true;return route.fulfill({json:{ok:true}})}
  if(!verified)return route.fulfill({status:401,json:{verification_required:true,error:'Verify your registered phone number to continue.'}})
  if(name==='proc_portal_read_v1')return route.fulfill({json:{data:{rfq_no:'RFQ-PORTAL-QA',supplier_name:'Fixture supplier',closes_at:new Date(Date.now()+21600000).toISOString(),server_now:new Date().toISOString(),can_edit:true,revision,response,status,items}}})
  if(name==='proc_portal_submit_v1'){
   if(body.p_expected_revision!==revision)return route.fulfill({status:409,json:{error:'Quotation was changed in another window. Reload before saving',code:'PT409'}})
   assert.equal(body.p_token,token);response=body.p_response;revision++;status=body.p_confirm?'confirmed':'draft';saves.push(body)
   return route.fulfill({json:{data:{revision,status}}})
  }
  throw Error('Unexpected external API: '+name)
 })
 const page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto(root+'/supplier/quote#token='+token)
 await page.getByLabel('Registered mobile number',{exact:true}).fill('0771234567')
 assert.equal(await page.locator('.sq-row').count(),0,'No quotation visible before verification')
 await page.getByRole('button',{name:'Send verification code',exact:true}).click()
 await page.getByLabel('Verification code',{exact:true}).fill('123456')
 await page.getByRole('button',{name:'Verify and open quotation',exact:true}).click()
 await page.getByText('RFQ-PORTAL-QA · Fixture supplier',{exact:true}).waitFor()
 assert.equal(new URL(page.url()).search,'','Tokens stay out of server query strings')
 assert.equal(await page.locator('.sq-row').count(),2,'Two compact quotation bill rows')
 await page.locator('.sq-row').first().getByRole('button',{name:'+ Variation',exact:true}).click()
 await page.getByRole('button',{name:'Save draft',exact:true}).click()
 await page.getByRole('status').getByText(/Draft saved/).waitFor()
 assert.equal(saves[0].p_confirm,false);assert.equal(saves[0].p_response[0].variations[0].name,'')
 await page.getByRole('button',{name:'Mark in stock for '+items[0].description,exact:true}).click()
 await page.getByLabel('Price for '+items[0].description,{exact:true}).fill('100')
 await page.getByLabel('Quantity for '+items[0].description,{exact:true}).fill('4')
 await page.getByLabel('Delivery days (all items)',{exact:true}).fill('2')
 await page.getByLabel('Valid through (all items)',{exact:true}).fill('2030-01-01')
 
 await page.getByLabel('Variation description',{exact:true}).fill('Different size 3 inch')
 await page.getByLabel('Variation price',{exact:true}).fill('125')
 await page.getByLabel('Variation quantity',{exact:true}).fill('5')
 const image=await sharp({create:{width:40,height:40,channels:3,background:'#006633'}}).png().toBuffer()
 await page.locator('input[type=file]').first().setInputFiles({name:'product.png',mimeType:'image/png',buffer:image})
 await page.getByAltText('Quoted product',{exact:true}).waitFor()
 await page.getByRole('button',{name:'No stock for '+items[1].description,exact:true}).click()
 await page.locator('.sq-row').nth(1).getByRole('button',{name:'+ Variation',exact:true}).click()
 await page.getByLabel('Variation description',{exact:true}).nth(1).fill('Cycle lock 3 ft')
 await page.getByLabel('Variation price',{exact:true}).nth(1).fill('40')
 await page.getByLabel('Variation quantity',{exact:true}).nth(1).fill('6')
 
 await page.getByLabel(/I confirm the exact items and units/).check()
 await page.getByRole('button',{name:'Final confirm',exact:true}).click()
 await page.getByRole('status').getByText(/Quotation confirmed/).waitFor()
 assert.equal(saves.at(-1).p_confirm,true);assert.match(saves.at(-1).p_response[0].image,/^data:image\/jpeg;base64,/)
 assert.equal(saves.at(-1).p_response[0].uom,'PCS');assert.equal(saves.at(-1).p_response[0].terms_confirmed,true)
 assert.equal(saves.at(-1).p_response[0].lead_days,'2','One delivery field applied to all lines')
 assert.equal(saves.at(-1).p_response[0].valid_until,'2030-01-01')
 assert.equal(saves.at(-1).p_response[1].status,'no_stock')
 await page.reload();await page.getByLabel('Price for '+items[0].description,{exact:true}).waitFor()
 assert.equal(await page.getByLabel('Price for '+items[0].description,{exact:true}).inputValue(),'100')
 for(const width of [320,360,390,768,1280]){
  await page.setViewportSize({width,height:844})
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}))
  assert.ok(layout.scroll<=layout.width+1,'No horizontal overflow at '+width+'px: '+JSON.stringify(layout))
  await mkdir('test-results',{recursive:true});const overflow=await page.locator('input,button,section').evaluateAll(nodes=>nodes.filter(n=>{const b=n.getBoundingClientRect();return b.width&& (b.right>innerWidth+1||b.left< -1)}).map(n=>({tag:n.tagName,label:n.getAttribute('aria-label'),right:n.getBoundingClientRect().right})));assert.deepEqual(overflow,[],'Every control fits the mobile viewport');
  await page.screenshot({path:'test-results/portal-'+width+'.png',fullPage:true})
  results.push({width,status:'passed'})
 }
 const second=await context.newPage();await second.goto(root+'/supplier/quote#token='+token);await second.getByLabel('Price for '+items[0].description,{exact:true}).waitFor()
 await page.getByLabel('Price for '+items[0].description,{exact:true}).fill('101');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').getByText(/Draft saved/).waitFor()
 await second.getByLabel('Price for '+items[0].description,{exact:true}).fill('102');await second.getByRole('button',{name:'Save draft',exact:true}).click();await second.getByRole('alert').getByText(/another window/).waitFor()
 assert.equal(await second.getByLabel('Price for '+items[0].description,{exact:true}).inputValue(),'102','Stale save preserves local edits')
 assert.deepEqual(errors,[])
 const gate=await fetch(root+'/api/supplier-portal/worker',{method:'POST'});assert.equal(gate.status,401)
 await writeFile('test-results/supplier-portal-ui.json',JSON.stringify({results,checks:['incomplete draft','price and commercial terms','compressed product image','alternative without stock','final confirmation','persistent reload','fragment tokens','two-window stale save','disabled worker endpoint']},null,2))
 console.log('PASS portal UI: 320/360/390/768/1280px, drafts, prices, photos, variations, confirmation, reload, stale edits and release gate')
}finally{await browser?.close();server.kill('SIGTERM')}
