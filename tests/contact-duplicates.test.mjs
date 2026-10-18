import test from 'node:test'
import assert from 'node:assert/strict'
import {contactNameKey,matchContactPhone,duplicateContactNumbers} from '../lib/contact-duplicates.mjs'

test('finds identical numbers in 07, 947 and +94 formats with different names',()=>{
 const rows=[
  {id:'a',company_id:'c1',supplier_id:'s1',name:'Wahid Nana',phone:'077 123 4567'},
  {id:'b',company_id:'c2',supplier_id:'s2',name:'Shivantha',whatsapp:'+94 77 123 4567'},
 ]
 const groups=duplicateContactNumbers(rows)
 assert.equal(groups.length,1)
 assert.equal(groups[0].phone,'+94771234567')
 assert.equal(groups[0].differentNames,true)
 assert.equal(matchContactPhone(rows,'94771234567').length,2)
})
test('same normalized name is a repeated contact and never automatically deleted',()=>{
 const rows=[
  {company_id:'one',supplier_id:'s',name:'  Hasan  Ali ',phone:'0771234567'},
  {company_id:'two',supplier_id:'s',name:'hasan ali',phone:'+94771234567'},
 ]
 const groups=duplicateContactNumbers(rows)
 assert.equal(contactNameKey(' HASAN   ALI '), 'hasan ali')
 assert.equal(groups[0].type,'same-name')
 assert.equal(groups[0].contacts.length,2)
})
test('phone and WhatsApp on one supplier do not self-trigger a duplicate',()=>{
 assert.deepEqual(duplicateContactNumbers([{id:'s',name:'Single',phone:'0771234567',whatsapp:'+94771234567'}]),[])
})
test('ignores invalid and blank phone numbers',()=>{
 assert.deepEqual(duplicateContactNumbers([{id:'a',name:'A',phone:'1234'},{id:'b',name:'B',phone:'1234'}]),[])
 assert.deepEqual(matchContactPhone([{id:'a',phone:'0771234567'}],'07712'),[])
})
test('distinguishes separate suppliers even within one company',()=>{
 const rows=[{company_id:'a',supplier_id:'one',name:'K',phone:'0771234567'},{company_id:'a',supplier_id:'two',name:'M',phone:'0771234567'}]
 assert.equal(duplicateContactNumbers(rows)[0].contacts.length,2)
})
