import test from 'node:test'
import assert from 'node:assert/strict'
import {contactPickerOutcome} from '../lib/contact-picker-outcome.mjs'

test('a native Android picker with zero results provides a fallback without discarding draft data',()=>{
 const result=contactPickerOutcome({selection:[]})
 assert.equal(result.ok,false)
 assert.equal(result.code,'empty')
 assert.match(result.message,/Pick phone number only/)
 assert.doesNotMatch(result.message,/vcf/i)
})
test('back, cancellation and OS picker failures do not appear as validation errors',()=>{
 assert.equal(contactPickerOutcome({error:{name:'AbortError'}}).code,'cancelled')
 assert.equal(contactPickerOutcome({error:{name:'NotAllowedError'}}).code,'denied')
 assert.equal(contactPickerOutcome({error:{name:'InvalidStateError'}}).code,'busy')
 assert.equal(contactPickerOutcome({error:{name:'SecurityError'}}).code,'blocked')
})
test('only the contacts explicitly selected by the user are prepared for import',()=>{
 assert.deepEqual(contactPickerOutcome({selection:[{name:['Supplier A'],tel:['0771234567','+94771234567']}]}),{
  ok:true,code:'selected',contacts:[{name:'Supplier A',phone:'+94771234567'}]
 })
})
test('null and malformed picker results do not crash the contact form',()=>{
 assert.equal(contactPickerOutcome({selection:null}).code,'empty')
 assert.equal(contactPickerOutcome({selection:[{name:'Supplier B',tel:[]}]}).code,'no_number')
})
