import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {getVisibleHelpTopics} from '../lib/help.js'
const file=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const view=(...routes)=>key=>routes.includes(key)

test('stock staff get only stock help and do not see procurement documentation',()=>{
 const titles=getVisibleHelpTopics('en',view('stock','urgent_actions')).map(x=>x.title)
 assert.ok(titles.includes('Fast Stock Entry'))
 assert.ok(titles.includes('Urgent Stock Items'))
 assert.ok(titles.includes('Movement filter'))
 assert.ok(!titles.includes('Reorder Level'))
 assert.ok(!titles.includes('Maximum Stock'))
 for(const s of ['Quotation Comparison','Purchase Order Approval','Goods Receiving','Roles & Permissions'])assert.ok(!titles.includes(s))
})
test('full procurement permissions preserve buyer help topics',()=>{
 const topics=getVisibleHelpTopics('en',view('stock','urgent_actions','rfq','po','receiving'),k=>k==='admin.roles.manage').map(x=>x.key)
 for(const k of ['quotation_comparison','po_approval','roles_permissions'])assert.ok(topics.includes(k))
})
test('restricted home replaces procurement dashboard and does not query sensitive tables',()=>{
 const app=file('components/procurement-app.jsx')
 const home=file('components/stock-only-home.jsx')
 assert.match(app,/isolatedStockRole\?<StockOnlyHome/)
 assert.doesNotMatch(home,/proc_v_dashboard|proc_purchase_orders|proc_rfqs|supplier comparison/)
 assert.match(home,/canNavigate\('stock'\)/)
})
test('restricted stock history does not render order column or requirements',()=>{
 const stock=file('components/modules-stock.jsx')
 assert.match(stock,/const canSeePurchaseHistory=canNavigate\('requirements'\)\|\|canNavigate\('po'\)/)
 assert.match(stock,/canSeePurchaseHistory&&<span>\{t\('stock.order'/)
 assert.match(stock,/canSeePurchaseHistory&&<b className=\{Number\(line.required_qty\)/)
})
test('urgent stock role cannot open procurement activity or read workflow status',()=>{
 const urgent=file('components/modules-urgent.jsx')
 assert.match(urgent,/canAutomation&&r.action_type==='existing_item'/)
 assert.match(urgent,/stockOnly\?'urgent_stock':'urgent_orders'/)
 assert.match(urgent,/!stockOnly&&<div className="priority-score"/)
 assert.match(urgent,/\.select\(stockOnly\?stockFields:'\*'\)/)
})
