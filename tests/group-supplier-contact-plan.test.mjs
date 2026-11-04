import test from 'node:test'
import assert from 'node:assert/strict'
import {planGroupSupplierSave} from '../lib/group-supplier-contact-plan.mjs'

const saved=[
 {id:'s1',name:'Existing supplier',phone:'+94771234567',whatsapp:'+94771234567'},
 {id:'s2',name:'Second supplier',phone:'0112345678',whatsapp:'0112345678'}
]
test('a selected phone contact is normalized before saving as a new supplier',()=>{
 assert.deepEqual(planGroupSupplierSave({name:' Regional  Sales ',phone:'077 987 6543',suppliers:saved}),
  {valid:true,action:'create',name:'Regional  Sales',phone:'+94779876543'})
})
test('imported contact with a previously saved number is reused without changing its name',()=>{
 assert.deepEqual(planGroupSupplierSave({name:'Different imported display name',phone:'0771234567',suppliers:saved}),
  {valid:true,action:'reuse',id:'s1',name:'Existing supplier',phone:'+94771234567'})
})
test('editing a saved supplier supports renaming or correcting its number',()=>{
 assert.deepEqual(planGroupSupplierSave({name:'Main dealer',phone:'077 765 4321',editingId:'s1',suppliers:saved}),
  {valid:true,action:'update',id:'s1',name:'Main dealer',phone:'+94777654321'})
})
test('editing cannot claim another saved supplier number',()=>{
 const plan=planGroupSupplierSave({name:'A',phone:'0112345678',editingId:'s1',suppliers:saved})
 assert.equal(plan.valid,false)
 assert.match(plan.error,/already belongs to/)
})
test('saving a blank, invalid, overseas or stale contact is rejected',()=>{
 assert.equal(planGroupSupplierSave({name:' ',phone:'0771234567'}).valid,false)
 assert.equal(planGroupSupplierSave({name:'New',phone:'abc'}).valid,false)
 assert.equal(planGroupSupplierSave({name:'New',phone:'+15551234567'}).valid,false)
 assert.equal(planGroupSupplierSave({name:'New',phone:'0771234567',editingId:'missing',suppliers:saved}).valid,false)
})
