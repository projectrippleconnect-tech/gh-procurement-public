import test from 'node:test'
import assert from 'node:assert/strict'
import {interpretContactPickerResult,contactPickerStatusMessage} from '../lib/device-contact-picker.mjs'

test('native contact search cancellation is recoverable and does not become a saved supplier',()=>{
 for(const name of ['AbortError','NotAllowedError','InvalidStateError','SecurityError']){
  const outcome=interpretContactPickerResult({error:{name}})
  assert.equal(outcome.status,'dismissed')
  assert.equal(outcome.showFallback,true)
  assert.deepEqual(outcome.choices,[])
 }
 assert.match(contactPickerStatusMessage('dismissed'),/unchanged/)
})
test('empty result and OS errors prompt local file import rather than a blank form',()=>{
 assert.equal(interpretContactPickerResult({selected:[]}).status,'empty')
 assert.equal(interpretContactPickerResult({error:new Error('native picker failed')}).status,'failed')
 assert.match(contactPickerStatusMessage('empty'),/vcf/)
})
test('supported browser is not a guarantee of access to phone contacts',()=>{
 assert.equal(interpretContactPickerResult({supported:false}).status,'unsupported')
 const outcome=interpretContactPickerResult({selected:[{name:['Supplier'],tel:['0771234567','+94771234567']}]})
 assert.equal(outcome.status,'selected')
 assert.deepEqual(outcome.choices,[{name:'Supplier',phone:'+94771234567'}])
})
