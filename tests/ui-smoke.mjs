// Isolated rendering tests: fake browser session and intercepted Supabase responses.
// Never signs in to production or changes production records.
import {chromium} from 'playwright'
import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
const root='http://127.0.0.1:3100'
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3100'],{stdio:'inherit'})
let browser
try{
 for(let attempt=0;attempt<100;attempt++){
  try{if((await fetch(root)).ok)break}catch{}
  if(attempt===99)throw new Error('Test server unavailable')
  await new Promise(r=>setTimeout(r,100))
 }
 await mkdir('test-results',{recursive:true})
 browser=await chromium.launch({headless:true})
 const id='00000000-0000-4000-8000-000000000002'
 const user={id,email:'fixture@example.invalid',app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated'}
 const profile={id,display_name:'Fixture Administrator',role:'admin',role_key:'admin',active:true,language:'en'}
 const permissions=['dashboard.view','stock.count.view','stock.count.enter','items.view','items.edit','stock.search',
  'procurement.requirements.view','procurement.requirements.manage','procurement.rfq.view','procurement.rfq.manage',
  'procurement.orders.view','procurement.orders.edit','procurement.orders.create','receiving.view','receiving.manage']
 const item={id:'00000000-0000-4000-8000-000000000003',item_id:'00000000-0000-4000-8000-000000000003',
  category:'GENERAL',description:'Fixture hardware item with a long description',size:'2 inch',uom:'PCS',
  movement:'FAST',max_stock:20,reorder_level:10,current_stock:10,active:true,is_due:true}
 const requirement={...item,id:'00000000-0000-4000-8000-000000000004',requirement_no:'REQ-FIXTURE',
  adjusted_qty:10,remaining_to_order:10,ordered_qty:0,ordered_not_received:0,status:'open',
  approval_status:'pending_review',source_type:'stock_count',priority:'normal',created_at:new Date().toISOString()}
 for(const width of [320,390,768,1366]){
  const context=await browser.newContext({viewport:{width,height:844}})
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await context.route('https://*.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop()
   let data=[]
   if(url.pathname.includes('/auth/'))data=user
   else if(name==='proc_profiles')data=[profile]
   else if(name==='proc_my_permissions_v1')data=permissions
   else if(name==='proc_v_dashboard')data={active_items:1,open_requirements:1,still_to_order:1,awaiting_receipt:0,open_pos:0,po_value:0}
   else if(name==='proc_v_requirements')data=[requirement]
   else if(name==='proc_items'||name==='proc_v_stock_check_due'||name==='proc_search_stock_items_v1')data=[item]
   else if(name==='proc_item_filter_options_v1')data={categories:['GENERAL'],main_groups:[]}
   else if(name==='proc_begin_stock_count_session_v1')data=new Date().toISOString()
   else if(name==='proc_settings')data=[{key:'company_profile',value:{name:'General Hardware',town:'Nawalapitiya'}}]
   else if(name==='proc_stock_count_drafts')data=[]
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
  await page.goto(root)
  await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
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
  for(const [label,heading] of [['✓ Stock Entry','Stock Entry'],['≡ Review','Review'],['Q RFQs & Quotes','RFQs & Quotes'],['PO Orders','Orders'],['⇩ Receive Goods','Receive Goods']]){
   await navigate(label)
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
   await page.screenshot({path:'test-results/'+width+'-'+heading.replaceAll(' ','-')+'.png',fullPage:true})
   const dimensions=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:window.innerWidth}))
   assert.ok(dimensions.scroll<=dimensions.width+1,heading+' overflows at '+width+': '+JSON.stringify(dimensions))
  }
  assert.deepEqual(errors,[],'Browser errors at '+width)
  console.log('PASS four-stage navigation and no horizontal overflow at '+width+'px')
  await context.close()
 }
}finally{
 if(browser)await browser.close()
 server.kill('SIGTERM')
}
