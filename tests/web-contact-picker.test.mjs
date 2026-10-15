import test from 'node:test'
import assert from 'node:assert/strict'
import {openWebContactPicker} from '../lib/web-contact-picker.mjs'
import {contactPickerOutcome} from '../lib/contact-picker-outcome.mjs'

function fixture(select){const win={isSecureContext:true};win.top=win;win.self=win;return {navigator:{contacts:{select}},window:win}}
test('picker opens during the click, before any promise continuation, preserving browser activation',async()=>{
 let called=false
 const input=fixture((fields,options)=>{called=true;assert.deepEqual(fields,['name','tel']);assert.deepEqual(options,{multiple:false});return Promise.resolve([{name:['Supplier'],tel:['0771234567']}])})
 const promise=openWebContactPicker(input)
 assert.equal(called,true)
 assert.equal(contactPickerOutcome({selection:await promise}).contacts[0].phone,'+94771234567')
})
test('phone-number-only retry works when name sharing is unsupported and normalizes multiple numbers',async()=>{
 const input=fixture(fields=>{assert.deepEqual(fields,['tel']);return Promise.resolve([{tel:['0771234567','0112345678']}])})
 assert.equal(contactPickerOutcome({selection:await openWebContactPicker({...input,numberOnly:true})}).contacts.length,2)
 await openWebContactPicker({...input,properties:['tel']})
})
test('unsupported, insecure and embedded contexts never invoke a contact request',async()=>{
 const input=fixture(()=>assert.fail('must not call picker'))
 await assert.rejects(openWebContactPicker({...input,navigator:{}}),{name:'NotSupportedError'})
 input.window.isSecureContext=false
 await assert.rejects(openWebContactPicker(input),{name:'SecurityError'})
 input.window.isSecureContext=true;input.window.top={}
 await assert.rejects(openWebContactPicker(input),{name:'SecurityError'})
})
test('unsupported telephone capability fails explicitly',async()=>{
 await assert.rejects(openWebContactPicker({...fixture(()=>assert.fail()),properties:['email']}),{name:'NotSupportedError'})
})
