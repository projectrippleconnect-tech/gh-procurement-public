// UI contract test only. RPCs are mocked; SQL authorization is tested separately.
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import sharp from 'sharp'
const base='http://127.0.0.1:3102'
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3102'],{stdio:'ignore',env:{...process.env,GH_PORTAL_PROCESSING_ENABLED:'false',GH_PORTAL_DISPATCH_ENABLED:'false'}})
let browser
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/supplier/quote')).ok)break}catch{}await new Promise(r=>setTimeout(r,200))}
 browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.GH_UI_BROWSER_PATH?{executablePath:process.env.GH_UI_BROWSER_PATH}:{})})
 await mkdir('test-results',{recursive:true})
 for(const width of [360,390,768,1280]){
  const page=await browser.newPage({viewport:{width,height:844}}),errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  let data={rfq_no:'QA-001',supplier_name:'QA Supplier',items:[{id:'item1',description:'CONCRETE NAILS',size:'2 inch',uom:'PCS',requested_qty:10},{id:'item2',description:'HINGES',size:'3 inch',uom:'PCS',requested_qty:6}],closes_at:new Date(Date.now()+21600000).toISOString(),server_now:new Date().toISOString(),can_edit:true,status:'draft',revision:0,response:[]}
  await page.route('**/rest/v1/rpc/**',async route=>{
   const name=route.request().url().split('/').at(-1)
   if(name==='proc_portal_submit_v1'){const p=route.request().postDataJSON();assert.equal(p.p_expected_revision,data.revision);data={...data,response:p.p_response,revision:data.revision+1,status:p.p_confirm?'confirmed':'draft'}}
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)})
  })
  await page.goto(base+'/supplier/quote?token='+'a'.repeat(64))
  await page.getByText('CONCRETE NAILS 2 inch',{exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal overflow at '+width)
  await page.getByLabel('In stock',{exact:true}).first().check()
  await page.getByLabel('Price for CONCRETE NAILS',{exact:true}).fill('42')
  await page.getByLabel('Quantity for CONCRETE NAILS',{exact:true}).fill('6')
  await page.getByLabel('Delivery days for CONCRETE NAILS',{exact:true}).fill('2')
  await page.getByLabel('Valid through for CONCRETE NAILS',{exact:true}).fill('2030-01-01')
  await page.getByText('I confirm this exact 2 inch').click()
  await page.getByLabel('No stock',{exact:true}).last().check()
  await page.getByRole('button',{name:'+ Add alternative',exact:true}).click()
  await page.getByLabel('Alternative description',{exact:true}).fill('4 inch alternative')
  await page.getByLabel('Alternative price',{exact:true}).fill('55')
  await page.getByLabel('Alternative quantity',{exact:true}).fill('5')
  const png=await sharp({create:{width:20,height:20,channels:3,background:'#123456'}}).png().toBuffer()
  await page.getByLabel('Alternative photo',{exact:true}).setInputFiles({name:'qa.png',mimeType:'image/png',buffer:png})
  await page.getByRole('button',{name:'Save draft',exact:true}).click()
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Save draft'&&!b.disabled))
  await page.getByText('I confirm the prices, available quantities and item variations entered here are correct.',{exact:true}).click()
  await page.getByRole('button',{name:'Final confirm',exact:true}).click()
  await page.getByText('Quotation confirmed',{exact:true}).waitFor()
  assert.ok(data.response[1].variations[0].image.startsWith('data:image/jpeg;base64,'))
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Filled form overflow at '+width)
  assert.deepEqual(errors,[])
  await page.screenshot({path:'test-results/portal-mobile-'+width+'.png',fullPage:true});await page.close()
 }
 console.log('PASS mobile UI at 360/390/768/1280: prices, photos, alternatives, drafts and confirmation; mocked RPCs')
}finally{await browser?.close();server.kill('SIGTERM')}
