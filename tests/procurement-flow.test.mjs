import test from 'node:test'
import assert from 'node:assert/strict'
import {remainingDelivery,receivingValue,nextRequirementAction,poSendBlock} from '../lib/procurement-flow.js'
import {quoteSheetRows} from '../lib/rfq-sheet.js'

test('delivery balances count posted accepted stock and cancelled quantities only',()=>{
 assert.equal(remainingDelivery({qty:100,cancelled_qty:20,grn:[{accepted_qty:55,receipt:{status:'posted'}},{accepted_qty:10,receipt:{status:'draft'}}]}),25)
 assert.equal(remainingDelivery({qty:10,cancelled_qty:10}),0)
})
test('receiving enters quantity once, adjusts rejection and retains deliberate acceptance edits',()=>{
 let value=receivingValue({received:'',accepted:'',rejected:'0'},'received','60')
 assert.equal(value.accepted,'60')
 value=receivingValue(value,'rejected','5');assert.equal(value.accepted,'55')
 value=receivingValue(value,'received','70');assert.equal(value.accepted,'55')
})
test('item next actions distinguish review, prices and deliveries',()=>{
 assert.match(nextRequirementAction({approval_status:'pending_review'}),/Review/)
 assert.match(nextRequirementAction({remaining_to_order:40,has_active_rfq:false}),/Request/)
 assert.match(nextRequirementAction({remaining_to_order:0,ordered_not_received:15}),/delivery/)
})
test('send buttons explain approval, supplier, gateway and duplicate attempt blocks',()=>{
 const state={po:{status:'approved',supplier:{phone:'+94770000000'}},canEdit:true,ready:true,gateway:{connected:true,sendingEnabled:true,dispatches:[]}}
 assert.equal(poSendBlock(state),'')
 assert.match(poSendBlock({...state,po:{...state.po,status:'pending_approval'}}),/Approve/)
 assert.match(poSendBlock({...state,po:{...state.po,supplier:{}}}),/number/)
 assert.match(poSendBlock({...state,gateway:{...state.gateway,dispatches:[{status:'unknown'}]}}),/attempt/)
})
test('comparison filters find sparse quotes, exclusions and limited availability',()=>{
 const items=[{id:'a',requested_qty:10},{id:'b',requested_qty:10,selected_for_po:false},{id:'c',requested_qty:10}]
 const quotes=[{rfq_item_id:'a',unit_price:50,available_qty:5},{rfq_item_id:'b',unit_price:40,available_qty:null}]
 assert.equal(quoteSheetRows(items,quotes,'','single').length,2)
 assert.equal(quoteSheetRows(items,quotes,'','excluded')[0].row.id,'b')
 assert.equal(quoteSheetRows(items,quotes,'','limited')[0].row.id,'a')
 assert.equal(quoteSheetRows(items,quotes,'','missing')[0].row.id,'c')
})
