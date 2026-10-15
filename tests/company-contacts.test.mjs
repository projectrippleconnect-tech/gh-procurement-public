import test from 'node:test'
import assert from 'node:assert/strict'
import {toCompanyPhone,choicesFromPicker,uniqueChoices,parseCompanyVcards} from '../lib/company-contacts.mjs'

test('normalizes local, country-code and telephone URI numbers',()=>{
 assert.equal(toCompanyPhone('077 123 4567'),'+94771234567')
 assert.equal(toCompanyPhone('+94 (77) 123-4567'),'+94771234567')
 assert.equal(toCompanyPhone('94771234567'),'+94771234567')
 assert.equal(toCompanyPhone('0094 77 1234567'),'+94771234567')
 assert.equal(toCompanyPhone('tel:+94771234567'),'+94771234567')
 assert.equal(toCompanyPhone('011 234 5678'),'+94112345678')
 assert.equal(toCompanyPhone('abc'),null)
 assert.equal(toCompanyPhone('123'),null)
})
test('device picker uses only selected contacts and valid numbers',()=>{
 assert.deepEqual(choicesFromPicker([
  {name:['Sales Contact'],tel:['0771234567','+94 77 123 4567','not a phone']},
  {name:['Office'],tel:['0112345678']}
 ]),[{name:'Sales Contact',phone:'+94771234567'},{name:'Office',phone:'+94112345678'}])
})
test('parses vCard records, folded names, multiple numbers and telephone URI values',()=>{
 const csv='BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Area Sales\r\n Manager\r\nTEL;TYPE=CELL:0771234567\r\nTEL;TYPE=WORK:0112345678\r\nEND:VCARD\r\nBEGIN:VCARD\nVERSION:4.0\nFN:Other Person\nTEL;VALUE=uri:tel:+94779876543\nEND:VCARD'
 assert.deepEqual(parseCompanyVcards(csv),[
  {name:'Area SalesManager',phone:'+94771234567'},
  {name:'Area SalesManager',phone:'+94112345678'},
  {name:'Other Person',phone:'+94779876543'}
 ])
})
test('supports N field fallback and skips unsupported overseas telephone',()=>{
 const v='BEGIN:VCARD\nN:Perera;Nimal;;;\nTEL:+94711234567\nEND:VCARD\nBEGIN:VCARD\nFN:Foreign\nTEL:+15550123456\nEND:VCARD'
 assert.deepEqual(parseCompanyVcards(v),[{name:'Nimal Perera',phone:'+94711234567'}])
})
test('rejects bulk files and deduplicates chosen phone numbers',()=>{
 assert.throws(()=>parseCompanyVcards('BEGIN:VCARD\nEND:VCARD\nBEGIN:VCARD\nEND:VCARD',{maxCards:1}),/too large/)
 assert.deepEqual(uniqueChoices([{name:'A',phone:'0771234567'},{name:'B',phone:'+94771234567'}]),[{name:'A',phone:'+94771234567'}])
})

test('reads grouped Apple-style contact fields',()=>{
 const v='BEGIN:VCARD\nFN:Operations\nitem1.TEL;TYPE=CELL:0771234567\nEND:VCARD'
 assert.deepEqual(parseCompanyVcards(v),[{name:'Operations',phone:'+94771234567'}])
})


test('Android picker cancellation and malformed contacts do not crash supplier selection',()=>{
 assert.deepEqual(choicesFromPicker(null),[])
 assert.deepEqual(choicesFromPicker([null,{}, {name:'Store Contact',tel:'0771234567'}]),[{name:'Store Contact',phone:'+94771234567'}])
})
