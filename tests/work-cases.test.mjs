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
test('returned partial quotations can be compared while delivery work remains visible',()=>{
 const c=purchasingCase({id:'need',status:'partially_received',approval_status:'approved',remaining_to_order:8,proc_work_documents:{rfqs:[{id:'q',status:'partially_quoted'}],orders:[{id:'po',status:'sent',remaining:4}]}},access)
 assert.equal(c.primaryAction.label,'Compare prices')
 assert.deepEqual(c.actions.map(a=>a.label),['Compare prices','Record delivery'])
 assert.equal(c.stillBuy,8);assert.equal(c.stillReceive,4)
})
test('existing reservations do not imply supplier dispatch and completed cases have no action',()=>{
 const row={id:'need',status:'ordered',approval_status:'approved',remaining_to_order:0,proc_work_documents:{orders:[{id:'po',status:'pending_approval',remaining:20}]}}
 const c=purchasingCase(row,access)
 assert.equal(c.stillReceive,0);assert.equal(c.reserved,20)
 assert.equal(c.primaryAction.label,'Approve order')
 const done=purchasingCase({...row,status:'received',proc_work_documents:{orders:[{id:'po',status:'received',remaining:0}]}},access)
 assert.equal(done.tab,'History');assert.equal(done.primaryAction,null)
})

test('primary actions prioritise a blocking review and overdue follow-up while preserving buying and receiving',()=>{
 const row={id:'need',status:'partially_received',approval_status:'approved',remaining_to_order:8,proc_work_documents:{rfqs:[{id:'new',status:'quoted'},{id:'late',status:'sent',due_date:'2000-01-01'}],orders:[{id:'sent',status:'partially_received',remaining:4}]}}
 const c=purchasingCase(row,access)
 assert.equal(c.primaryAction.filter,'late');assert.equal(c.secondaryAction.view,'receiving')
 assert.match(c.attention,/overdue/)
 const held=purchasingCase({...row,approval_status:'held',hold_reason:'Check recount'},access)
 assert.equal(held.primaryAction.label,'Review hold');assert.equal(held.secondaryAction.view,'receiving')
 assert.equal(held.attention,'Check recount')
})
test('unsent orders display a status distinct from their action and stay out of receipt balances',()=>{
 const c=purchasingCase({id:'need',status:'ordered',approval_status:'approved',remaining_to_order:0,proc_work_documents:{orders:[{id:'draft',status:'approved',remaining:12}]}},access)
 assert.equal(c.statusLabel,'Approved · not sent');assert.equal(c.primaryAction.label,'Send order')
 assert.equal(c.stillReceive,0);assert.equal(c.secondaryAction,null)
})

test('Work next actions open comparison and supplier tasks rather than the default screen stage',()=>{
 const base={id:'need',status:'open',approval_status:'approved',remaining_to_order:8,proc_work_documents:{rfqs:[],orders:[]}}
 const supplier=purchasingCase(base,access).primaryAction
 assert.equal(supplier.label,'Assign supplier');assert.equal(supplier.step,3)
 const prices=purchasingCase({...base,proc_work_documents:{rfqs:[{id:'quote',status:'quoted'}],orders:[]}},access).primaryAction
 assert.equal(prices.label,'Compare prices');assert.equal(prices.step,5)
 const request=purchasingCase({...base,proc_work_documents:{rfqs:[{id:'request',status:'prepared'}],orders:[]}},access).primaryAction
 assert.equal(request.label,'Prepare supplier request');assert.equal(request.step,3)
})

test('routine waiting lives in In progress while overdue follow-ups move to Needs me',()=>{
 const row={id:'need',status:'ordered',approval_status:'approved',remaining_to_order:0,proc_work_documents:{orders:[{id:'po',status:'sent',remaining:4,expected_date:'2099-01-01'}]}}
 const waiting=purchasingCase(row,access)
 assert.equal(waiting.tab,'In progress');assert.equal(waiting.primaryAction.label,'Record delivery')
 assert.equal(purchasingCase({...row,proc_work_documents:{orders:[{...row.proc_work_documents.orders[0],expected_date:'2000-01-01'}]}},access).tab,'Needs me')
 const quotes={...row,status:'quoting',remaining_to_order:8,proc_work_documents:{rfqs:[{id:'q',status:'sent',due_date:'2099-01-01'}],orders:[]}}
 assert.equal(purchasingCase(quotes,access).tab,'In progress')
 assert.equal(purchasingCase({...quotes,proc_work_documents:{rfqs:[{...quotes.proc_work_documents.rfqs[0],due_date:'2000-01-01'}]}},access).tab,'Needs me')
})
