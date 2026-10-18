import test from 'node:test'
import assert from 'node:assert/strict'
import {supplierSetupPlan} from '../lib/company-supplier-setup.mjs'
import {companySubmissionNext,poNextStep} from '../lib/purchasing-next-step.mjs'
const suppliers=[{id:'one',phone:'+94771234567'},{id:'two',whatsapp:'+94777654321'}]
test('manual review needs no contact and never enables automatic sending',()=>{
 assert.deepEqual(supplierSetupPlan({mode:'manual'}),{valid:true,assigned:[],recipients:[],mode:'manual'})
})
test('direct orders allow several designated suppliers with exactly one selected recipient',()=>{
 assert.equal(supplierSetupPlan({mode:'direct',assigned:['one','two'],recipients:['one'],suppliers}).valid,true)
 assert.deepEqual(supplierSetupPlan({mode:'direct',assigned:['one','two'],recipients:['one'],suppliers}).assigned,['one','two'])
 assert.equal(supplierSetupPlan({mode:'direct',assigned:['one','two'],recipients:['one','two'],suppliers}).valid,false)
 assert.equal(supplierSetupPlan({mode:'rfq',assigned:['one'],recipients:['two'],suppliers}).valid,false)
 assert.equal(supplierSetupPlan({mode:'direct',assigned:['one'],recipients:['one'],suppliers}).valid,true)
})
test('automatic routes reject unavailable suppliers and invalid numbers',()=>{
 assert.equal(supplierSetupPlan({mode:'rfq',assigned:['missing'],recipients:['missing'],suppliers}).valid,false)
 assert.equal(supplierSetupPlan({mode:'rfq',assigned:['one'],recipients:['one'],suppliers:[{id:'one',phone:'0771234567'}]}).valid,false)
})
test('stock outcomes choose review, new documents or existing-order tracking',()=>{
 assert.equal(companySubmissionNext({stock_outcomes:[{needs_review:true}],purchase_orders:[{id:'po'}]}).view,'requirements')
 assert.equal(companySubmissionNext({purchase_orders:[{id:'po'}]}).filter,'po')
 assert.equal(companySubmissionNext({rfqs:[{rfq_id:'rfq'}]}).filter,'rfq')
 assert.equal(companySubmissionNext({stock_outcomes:[{uncovered_qty:5}]}).label,'Review shortages')
 assert.equal(companySubmissionNext({stock_outcomes:[{orders:[{id:'existing'}]}]}).label,'Track existing purchase order')
 assert.equal(companySubmissionNext({stock_outcomes:[{shortage_qty:0}]}),null)
 assert.equal(companySubmissionNext({stock_outcomes:[{uncovered_qty:5,needs_review:false,rfqs:[{id:'active-request'}]}]}).filter,'active-request')
})
test('PO guidance distinguishes approval, sending, receiving and closure',()=>{
 assert.match(poNextStep('approved'),/Send/);assert.match(poNextStep('sent'),/delivery/)
 assert.match(poNextStep('partially_received'),/remaining/);assert.equal(poNextStep('closed'),'Order closed')
})
