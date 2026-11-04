// Browser requests use actual local PostgREST responses. Only the test credential
// and API origin are substituted; no production request is permitted through.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
export async function portalBrowserDatabase({base,fixture,authorization,value,executablePath}){
 const app='http://127.0.0.1:3156'
 const next=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3156'],{env:{...process.env,GH_PORTAL_PROCESSING_ENABLED:'false',GH_PORTAL_DISPATCH_ENABLED:'false'},stdio:'ignore'})
 let browser
 try{
  let ready=false
  for(let i=0;i<100;i++){try{if((await fetch(app+'/supplier/quote')).ok){ready=true;break}}catch{}await delay(200)}
  assert.ok(ready,'Local production build unavailable')
  browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage']})
  const context=await browser.newContext({viewport:{width:390,height:844}})
  await context.route('https://*.supabase.co/**',async route=>{
   const request=route.request(),path=new URL(request.url()).pathname
   assert.ok(path.startsWith('/rest/v1/rpc/'),'Unexpected external Supabase operation: '+path)
   const response=await fetch(base+path,{method:request.method(),headers:{Authorization:authorization,'Content-Type':'application/json'},body:request.postData(),signal:AbortSignal.timeout(20000)})
   await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()})
  })
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(app+'/supplier/quote#token='+fixture.token)
  const price=page.getByLabel(/^Price for /).first();await price.waitFor();await price.fill('51')
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').getByText(/Draft saved/).waitFor()
  assert.equal(await value('select count(*)::int v from public.proc_quote_lines where rfq_item_id=$1',[fixture.item]),0)
  const agree='I confirm the prices, available quantities and item variations entered here are correct.'
  await page.getByLabel(/I confirm this exact/).check();await page.getByLabel(agree,{exact:true}).check();await page.getByRole('button',{name:'Final confirm',exact:true}).click();await page.getByRole('status').getByText(/Quotation confirmed/).waitFor()
  assert.equal(Number(await value('select unit_price v from public.proc_quote_lines where rfq_item_id=$1',[fixture.item])),51)
  await page.reload();await price.waitFor();assert.equal(await price.inputValue(),'51')
  for(const width of [320,390]){
   await page.setViewportSize({width,height:844})
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
  }
  const second=await context.newPage();await second.goto(app+'/supplier/quote#token='+fixture.token)
  const secondPrice=second.getByLabel(/^Price for /).first();await secondPrice.waitFor()
  await price.fill('52');await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').getByText(/Draft saved/).waitFor()
  await secondPrice.fill('53');await second.getByRole('button',{name:'Save draft',exact:true}).click();await second.getByRole('alert').getByText(/another window/).waitFor()
  assert.equal(await secondPrice.inputValue(),'53','A real HTTP conflict erased unsaved browser edits')
  await page.getByLabel(/I confirm this exact/).check();await page.getByLabel(agree,{exact:true}).check();await page.getByRole('button',{name:'Final confirm',exact:true}).click();await page.getByRole('status').getByText(/Quotation confirmed/).waitFor()
  assert.equal(Number(await value('select unit_price v from public.proc_quote_lines where rfq_item_id=$1',[fixture.item])),52)
  assert.deepEqual(errors,[])
 }finally{await browser?.close();next.kill('SIGTERM')}
}
