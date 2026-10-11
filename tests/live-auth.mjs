// Explicit opt-in integration test. The fixture must be a disposable account.
// Uses real Supabase responses; the fetch bridge only transports requests through
// this runtime's network proxy. No responses or sessions are simulated.
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const fixturePath=process.env.GH_LIVE_AUTH_FIXTURE
if(!fixturePath)throw new Error('GH_LIVE_AUTH_FIXTURE must identify a disposable test account file')
const fixture=JSON.parse(await readFile(fixturePath,'utf8'))
assert.match(fixture.email,/@example\.invalid$/,'Only disposable example.invalid accounts may run this test')
const root='http://127.0.0.1:3102'
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3102'],{stdio:'ignore'})
let browser,stage='startup'
try{
 for(let attempt=0;;attempt++){
  try{if((await fetch(root)).ok)break}catch{}
  if(attempt>=100)throw new Error('Local release server unavailable')
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 browser=await chromium.launch({headless:true,...(process.env.GH_UI_BROWSER_EXECUTABLE?{
  executablePath:process.env.GH_UI_BROWSER_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']
 }: {})})
 const context=await browser.newContext({viewport:{width:390,height:844}})
 await context.route('https://*.supabase.co/**',async route=>{
  const request=route.request()
  try{
   const response=await fetch(request.url(),{method:request.method(),headers:request.headers(),
    ...(request.postDataBuffer()?{body:request.postDataBuffer()}:{}),signal:AbortSignal.timeout(25000)})
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())})
  }catch{await route.abort('failed')}
 })
 const page=await context.newPage()
 const fragment=new URL(fixture.setup_link).hash
 if(fixture.new_invitation){
  stage='invitation acceptance'
  await page.goto(root+'/?recovery=1'+fragment,{waitUntil:'domcontentloaded'})
  await page.getByPlaceholder('New password (12+ with upper/lowercase, number & symbol)',{exact:true}).fill(fixture.password)
  await page.getByPlaceholder('Confirm new password',{exact:true}).fill(fixture.password)
  await page.getByRole('button',{name:'Update password',exact:true}).click()
  await page.getByRole('heading',{name:'Password updated',exact:true}).waitFor()
  console.log('PASS real invitation acceptance and password setup')
  await page.evaluate(()=>localStorage.clear())
 }
 stage='password login'
 await page.goto(root,{waitUntil:'domcontentloaded'})
 await page.getByPlaceholder('Email',{exact:true}).fill(fixture.email)
 await page.getByPlaceholder('Password',{exact:true}).fill(fixture.password)
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await page.getByRole('heading',{name:'Stock Entry',exact:true}).first().waitFor({timeout:45000})
 await page.getByText('Draft saved to your account.',{exact:true}).waitFor({timeout:30000})
 assert.ok(await page.locator('input[inputmode="decimal"]').count()>0)
 console.log('PASS real password login and populated assigned stock section')
 stage='session restoration'
 await page.reload()
 await page.getByRole('heading',{name:'Stock Entry',exact:true}).first().waitFor({timeout:30000})
 await page.getByText('Draft saved to your account.',{exact:true}).waitFor({timeout:30000})
 console.log('PASS real session restoration')
 stage='token replay'
 await page.evaluate(()=>localStorage.clear())
 await page.goto(root+'/?recovery=1'+fragment,{waitUntil:'domcontentloaded'})
 await page.getByRole('alert').filter({hasText:'expired, was already used'}).waitFor({timeout:30000})
 assert.equal(await page.getByRole('button',{name:'Update password',exact:true}).count(),0)
 console.log('PASS consumed real invitation token cannot be reused')
}catch(error){
 // Playwright error messages may include a one-time URL. Do not print them.
 console.error('FAIL real-auth '+stage+' ('+error.name+')')
 process.exitCode=1
}finally{
 await browser?.close()
 server.kill('SIGTERM')
}
