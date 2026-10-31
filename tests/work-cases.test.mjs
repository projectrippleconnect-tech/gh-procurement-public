import test from 'node:test'
import assert from 'node:assert/strict'
import {purchasingCase,ORDER_STATES} from '../lib/work-cases.mjs'
import {scopePurchasingQuery} from '../lib/purchasing-workspace.mjs'
const access={can:()=>true,canNavigate:()=>true}
test('partial purchasing offers buying and receiving together without treating drafts as delivery',()=>{
 const c=purchasingCase({id:'need',status:'partially_received',approval_status:'approved',remaining_to_order:8,proc_work_documents:{rfqs:[],orders:[{id:'sent',status:'partially_received',remaining:4},{id:'draft',status:'draft',remaining:3}]}},access)
 assert.equal(c.stillBuy,8);assert.equal(c.stillReceive,4);assert.equal(c.reserved,3)
 assert.deepEqual(c.actions.map(a=>a.label),['Assign supplier','Record delivery','Review draft'])
 assert.equal(c.tab,'Needs me');assert.equal(c.id,'need')
})
test('every active quotation stays connected and role boundaries determine Needs me',()=>{
 const row={id:'need',status:'quoting',approval_status:'approved',remaining_to_order:8,proc_work_documents:{rfqs:[{id:'older',status:'sent'},{id:'newer',status:'quoted'}],orders:[]}}
 assert.deepEqual(purchasingCase(row,access).actions.map(a=>a.filter),['older','newer'])
 const viewer=purchasingCase(row,{can:()=>false,canNavigate:()=>true})
 assert.equal(viewer.tab,'In progress');assert.equal(viewer.actions.length,0)
})
test('held purchasing does not offer quotation actions; quantity-only orders name approval scope',()=>{
 const c=purchasingCase({id:'need',status:'open',approval_status:'held',remaining_to_order:4,proc_work_documents:{rfqs:[{id:'q',status:'quoted'}],orders:[{id:'po',status:'pending_approval',remaining:4,quantity_only:true}]}},access)
 assert.deepEqual(c.actions.map(a=>a.label),['Review hold'])
 assert.equal(ORDER_STATES.approved,'Approved — not sent')
})
test('All items never applies a General-only predicate',()=>{
 const q={eq:()=>{throw Error('unexpected filter')}}
 assert.equal(scopePurchasingQuery(q,'all','scope'),q)
})
