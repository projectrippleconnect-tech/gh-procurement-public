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
 browser=await chromium.launch({headless:true,...(process.env.GH_UI_BROWSER_CHANNEL?{channel:process.env.GH_UI_BROWSER_CHANNEL}:{})})
 const id='00000000-0000-4000-8000-000000000002'
 const user={id,email:'fixture@example.invalid',app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated'}
 const profile={id,display_name:'Fixture Administrator',role:'admin',role_key:'admin',active:true,language:'en'}
 const permissions=['dashboard.view','urgent.view','invoices.view','invoices.manage','stock.count.view','stock.count.enter','items.view','items.edit','stock.search',
  'procurement.requirements.view','procurement.requirements.manage','procurement.rfq.view','procurement.rfq.manage',
  'procurement.orders.view','procurement.orders.edit','procurement.orders.create','receiving.view','receiving.manage']
 const item={id:'00000000-0000-4000-8000-000000000003',item_id:'00000000-0000-4000-8000-000000000003',
  category:'GENERAL',description:'Fixture hardware item with a long description',size:'2 inch',uom:'PCS',
  movement:'FAST',max_stock:20,reorder_level:10,current_stock:10,active:true,is_due:true}
 const requirement={...item,id:'00000000-0000-4000-8000-000000000004',requirement_no:'REQ-FIXTURE',
  adjusted_qty:10,remaining_to_order:10,ordered_qty:0,ordered_not_received:0,status:'open',
  approval_status:'pending_review',source_type:'stock_count',priority:'normal',created_at:new Date().toISOString()}
 const supplier={id:'00000000-0000-4000-8000-000000000005',name:'Fixture supplier',phone:'+94779792078',whatsapp:'+94779792078',active:true}
 const newSupplier={...supplier,id:'00000000-0000-4000-8000-000000000010',name:'Newly registered supplier'}
 const rfq={id:'00000000-0000-4000-8000-000000000006',rfq_no:'RFQ-FIXTURE',status:'prepared',due_date:'2099-01-01'}
 const po={id:'00000000-0000-4000-8000-000000000007',po_no:'PO-FIXTURE',supplier_id:supplier.id,supplier,status:'sent',total:1000,po_date:'2099-01-01'}
 const otherPo={...po,id:'00000000-0000-4000-8000-000000000011',po_no:'PO-SECOND'}
 for(const width of [320,390,768,1366]){
  const context=await browser.newContext({viewport:{width,height:844}})
  const page=await context.newPage()
  const errors=[],queries=[],receipts=[]
  let grantedPermissions=permissions
  let directory=[supplier],invitations=[{id:'invite-fixture',rfq_id:rfq.id,supplier_id:supplier.id,status:'pending'}],addFailure=true,rfqStatus='prepared'
  page.on('pageerror',e=>errors.push(e.message))
  await context.route('https://*.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),name=url.pathname.split('/').pop()
   queries.push(url)
   let data=[]
   if(url.pathname.includes('/auth/'))data=user
   else if(name==='proc_profiles')data=[profile]
   else if(name==='proc_my_permissions_v1')data=grantedPermissions
   else if(name==='proc_v_dashboard')data={active_items:1,open_requirements:1,still_to_order:1,awaiting_receipt:0,open_pos:0,po_value:0}
   else if(name==='proc_v_requirements')data=[requirement]
   else if(name==='proc_rfqs')data=[{...rfq,status:rfqStatus}]
   else if(name==='proc_suppliers')data=directory
   else if(name==='proc_rfq_suppliers')data=invitations
   else if(name==='proc_add_rfq_supplier_v1'){
    assert.deepEqual(req.postDataJSON(),{p_rfq_id:rfq.id,p_supplier_id:newSupplier.id,p_scope_override_reason:null})
    if(addFailure){await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Fixture invitation failure'})});return}
    const invitation={id:'new-invite-fixture',rfq_id:rfq.id,supplier_id:newSupplier.id,status:'pending'}
    invitations=[...invitations,invitation]
    data={invitation,rfq_status:rfqStatus,added:true}
   }
   else if(name==='proc_rfq_items')data=Array.from({length:100},(_,i)=>({id:i===0?'00000000-0000-4000-8000-000000000008':'sheet-item-'+i,rfq_id:rfq.id,requirement_id:requirement.id,requirement:{...requirement,item:i===0?item:{...item,description:'Bathroom fixture '+i,category:'BATHROOM'}},requested_qty:10,selected_for_po:true}))
   else if(name==='proc_v_quote_comparison')data=[{rfq_item_id:'00000000-0000-4000-8000-000000000008',supplier_id:supplier.id,supplier_name:supplier.name,quote_line_id:'quote-fixture',unit_price:100,landed_unit_cost:100,landed_rank:1,available_qty:null,lead_days:null,moq:0,order_multiple:1}]
   else if(name==='proc_set_rfq_supplier_items_v1'){const p=req.postDataJSON();invitations=invitations.map(x=>x.supplier_id===p.p_supplier_id?{...x,requested_item_ids:p.p_item_ids}:x);data=invitations.find(x=>x.supplier_id===p.p_supplier_id)}
   else if(name==='proc_purchase_orders')data=[po,otherPo]
   else if(name==='proc_receive_po_v3'){receipts.push(req.postDataJSON());await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({message:'Fixture receipt retry'})});return}
   else if(name==='proc_supplier_invoices')data=[{id:'invoice-fixture',invoice_no:'INV-VARIANCE',status:'variance',total:1000,supplier,po}]
   else if(name==='proc_po_lines')data=[{id:'00000000-0000-4000-8000-000000000009',po_id:url.searchParams.get('po_id')?.slice(3)||po.id,item_id:item.id,item,qty:10,unit_price:100,line_total:1000}]
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
   await page.waitForFunction(()=>!document.querySelector('.login-shell'))
   await page.waitForTimeout(250)
   assert.ok(queries.some(u=>u.pathname.endsWith('/'+table)&&(!field||u.searchParams.get(field)===value)),card+' must query its matching records')
   if(card==='Stock checks due')assert.ok(queries.some(u=>u.pathname.endsWith('/'+table)&&u.searchParams.get('is_due')==='eq.true'&&!u.searchParams.has('category')&&!u.searchParams.has('movement')),'Due shortcut includes all categories and movements')
   await navigate('⌂ Home')
  }
  for(const [button,heading,table,field] of [['Overdue supplier requests','RFQs & Quotes','proc_rfqs','due_date'],['Overdue purchase orders','Orders','proc_purchase_orders','expected_date']]){
   await page.getByRole('button',{name:'Overdue actions',exact:true}).click()
   queries.length=0
   await page.getByRole('button',{name:new RegExp('^'+button)}).click()
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
   await page.waitForTimeout(250)
   assert.ok(queries.some(u=>u.pathname.endsWith('/'+table)&&u.searchParams.get(field)?.startsWith('lt.')&&u.searchParams.get('status')==='in.(sent,partially_received)'.replace('partially_received',table==='proc_rfqs'?'partially_quoted':'partially_received')),button+' must filter by due date and active status')
   await navigate('⌂ Home')
  }
  await page.screenshot({path:'test-results/'+width+'-Dashboard.png',fullPage:true})
  for(const [label,heading] of [['✓ Stock Entry','Stock Entry'],['≡ Review','Review'],['Q RFQs & Quotes','RFQs & Quotes'],['PO Orders','Orders'],['⇩ Receive Goods','Receive Goods']]){
   await navigate(label)
   await page.getByRole('heading',{name:heading,exact:true}).first().waitFor()
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
    await page.locator('summary').filter({hasText:'Choose request items'}).click()
    await page.getByLabel('Request category',{exact:true}).selectOption('BATHROOM')
    await page.getByRole('button',{name:'Use Visible Items Only',exact:true}).click()
    await page.getByRole('button',{name:'Save Request Items',exact:true}).click()
    await page.getByText('Supplier request items saved.',{exact:false}).waitFor()
    assert.equal(invitations[0].requested_item_ids.length,99,'A bathroom-only request saves every matching item')
    assert.ok(!invitations[0].requested_item_ids.includes('00000000-0000-4000-8000-000000000008'),'A bathroom-only request excludes general hardware')
    const newSelect=page.getByLabel('New supplier',{exact:true})
    const quoteSelect=page.getByLabel('Supplier',{exact:true})
    await quoteSelect.locator('option[value="'+supplier.id+'"]').waitFor({state:'attached'})
    assert.equal(await quoteSelect.locator('option').count(),1,'Directory suppliers are not implicitly invited')
    directory=[supplier,newSupplier]
    await page.getByRole('button',{name:'Refresh Suppliers',exact:true}).click()
    await newSelect.locator('option[value="'+newSupplier.id+'"]').waitFor({state:'attached'})
    const price=page.locator('input[placeholder="Price"],input[placeholder="Rs."]').filter({visible:true}).first()
    await price.fill('123.45')
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
    await quoteSelect.selectOption(newSupplier.id)
    await page.waitForTimeout(150)
    assert.equal(await price.inputValue(),'','The new supplier has a separate quotation')
    await page.screenshot({path:'test-results/'+width+'-RFQ-added-supplier.png',fullPage:true})
    grantedPermissions=permissions.filter(p=>p!=='procurement.rfq.manage')
    await page.reload()
    await page.getByRole('heading',{name:'Home',exact:true}).waitFor()
    await navigate('Q RFQs & Quotes')
    await page.getByRole('button',{name:/^RFQ-FIXTURE/}).click()
    await page.getByText('Only enter the supplier\'s unit price.',{exact:false}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Add to RFQ',exact:true}).count(),0,'Read-only users cannot add suppliers')
    grantedPermissions=permissions
   }
   if(heading==='Receive Goods'){
    page.on('dialog',dialog=>dialog.accept())
    const selector=page.getByLabel('Purchase Order',{exact:true})
    for(const poId of [po.id,otherPo.id,po.id]){
     await selector.selectOption(poId)
     await page.getByRole('button',{name:'✓ Mark All Remaining Received',exact:true}).click()
     await page.getByRole('button',{name:'Post GRN',exact:true}).click()
     await page.getByText('Fixture receipt retry',{exact:true}).waitFor()
     await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Posting…'))
     await page.waitForTimeout(100)
    }
    assert.equal(receipts.length,3,'Three receiving attempts were issued')
    assert.notEqual(receipts[0].p_receipt_key,receipts[1].p_receipt_key,'Different POs get different receipt keys')
    assert.equal(receipts[0].p_receipt_key,receipts[2].p_receipt_key,'Retrying the same PO reuses its receipt key')
   }
   if(heading==='Orders')await page.getByRole('button',{name:/^PO-FIXTURE/}).click()
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
  assert.deepEqual(errors,[],'Browser errors at '+width)
  console.log('PASS four-stage navigation and no horizontal overflow at '+width+'px')
  await context.close()
 }
}finally{
 if(browser)await browser.close()
 server.kill('SIGTERM')
}
