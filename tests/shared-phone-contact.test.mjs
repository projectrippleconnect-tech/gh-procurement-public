import test from 'node:test'
import assert from 'node:assert/strict'
import {parseSharedPhoneContact} from '../lib/shared-phone-contact.mjs'

test('Android Contacts share uses vCard content behind the scenes without manual file export',()=>{
 const data=parseSharedPhoneContact({cards:['BEGIN:VCARD\nVERSION:3.0\nFN:Supplier Board House\nTEL;TYPE=CELL:0771234567\nEND:VCARD']})
 assert.deepEqual(data,[{name:'Supplier Board House',phone:'+94771234567'}])
})
test('Android shared contact text can contain a name and number',()=>{
 const data=parseSharedPhoneContact({title:'Lanka Supplier',text:'Lanka Supplier\nMobile: 077 123 4567'})
 assert.deepEqual(data,[{name:'Lanka Supplier',phone:'+94771234567'}])
})
test('invalid and foreign-only phone shares are ignored',()=>{
 assert.deepEqual(parseSharedPhoneContact({text:'Unavailable contact'}),[])
 assert.deepEqual(parseSharedPhoneContact({title:'Foreign',text:'Phone +1 650 123 4567'}),[])
})
test('only unique valid contacts are offered for manual selection, not auto-saved',()=>{
 const data=parseSharedPhoneContact({cards:[
  'BEGIN:VCARD\nVERSION:3.0\nFN:A\nTEL:0771234567\nEND:VCARD',
  'BEGIN:VCARD\nVERSION:3.0\nFN:A\nTEL:+94771234567\nEND:VCARD'
 ]})
 assert.equal(data.length,1)
})
