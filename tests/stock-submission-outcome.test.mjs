import test from 'node:test'
import assert from 'node:assert/strict'
import {stockSubmissionOutcome as outcome} from '../lib/stock-submission-outcome.mjs'
import {dashboardWorkLists} from '../lib/dashboard-actions.mjs'

test('above-reorder and sufficient stock share one no-purchase result',()=>{
 assert.equal(outcome({automation:{status:'no_requirements'}}).key,'saved')
 assert.equal(outcome({stock_outcomes:[{shortage_qty:0,uncovered_qty:0,sufficient_stock:true}]},{company:true}).title,'Stock sufficient')
})
test('normal review, RFQ, and direct PO with either approval rule share purchase needed',()=>{
 assert.equal(outcome({automation:{status:'review_required'}}).key,'purchase_needed')
 for(const result of [{rfqs:[{id:'q'}]},{purchase_orders:[{id:'p',status:'pending_approval'}]},{purchase_orders:[{id:'p',status:'approved'}]},{stock_outcomes:[{shortage_qty:10,uncovered_qty:0,committed_qty:10}]}]){
  assert.equal(outcome(result,{company:true}).key,'purchase_needed')
 }
})
test('missing route, failed sending, and changed counts requiring intervention surface attention',()=>{
 for(const result of [{},{automation_errors:[{error:'No supplier'}]},{dispatch:{ok:false}},{rfqDispatch:{ok:false}},{stock_outcomes:[{needs_review:true,shortage_qty:10}]}])assert.equal(outcome(result,{company:true}).key,'needs_attention')
 assert.equal(outcome({}).key,'needs_attention')
})
test('stock-only results remain neutral when the API redacts purchase data',()=>{
 assert.equal(outcome({automation:{status:'submitted'}}).title,'Saved')
 assert.equal(outcome({purchase_orders:[{id:'private'}]},{company:true,purchaseVisible:false}).title,'Saved')
})
test('three work lists preserve errors and do not add overlapping requirement and urgent counts',()=>{
 const ready=Object.fromEntries(['review','urgent','prices','approval','send','deliveries'].map(key=>[key,'ready']))
 const groups=dashboardWorkLists({canNavigate:()=>true,counts:{review:3,urgent:2,approval:1},states:ready})
 assert.deepEqual(groups.map(x=>x.label),['To Review','Awaiting Quotes','Orders'])
 assert.equal(groups[0].summary,'3 awaiting review · 2 urgent items')
 assert.match(groups[2].summary,/1 to approve/)
 assert.equal(dashboardWorkLists({canNavigate:()=>false}).length,0)
 assert.equal(dashboardWorkLists({canNavigate:()=>true,states:{...ready,prices:'error'}})[1].state,'error')
})

test('sufficient overrides preserve exact shortage and require an auditable reason',async()=>{
 const {sufficientStockOverrides:find,sufficientOverrideNotes:notes}=await import('../lib/stock-submission-outcome.mjs')
 const overrides=find({a:'0',b:'12',c:''},{a:true,b:true,c:true},[{item_id:'a',description:'SCREWS',reorder_level:5},{item_id:'b',reorder_level:10},{item_id:'c',reorder_level:10}])
 assert.deepEqual(overrides,[{id:'a',description:'SCREWS',quantity:0,reorder:5}])
 assert.throws(()=>notes(overrides,''),/reason/)
 const record=JSON.parse(notes(overrides,'Stock held in main stores').split('Sufficient-stock override: ')[1])
 assert.equal(record.items[0].quantity,0)
 assert.equal(record.reason,'Stock held in main stores')
 assert.equal(notes([],''),null)
})
