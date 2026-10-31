import test from 'node:test'
import assert from 'node:assert/strict'
import {parsePastedContact} from '../lib/pasted-contact.mjs'

test('extracts a copied contact with a local number or formatted country code',()=>{
 for(const text of ['Sales Rep\n077 123 4567','Sales Rep - +94 (77) 123-4567','Name: Sales Rep\nMobile: 0094 77 1234567']){
  assert.deepEqual(parsePastedContact(text),{ok:true,contacts:[{name:'Sales Rep',phone:'+94771234567'}]})
 }
})
test('a pasted number has no invented name and supports landlines and country-code variants',()=>{
 for(const text of ['0771234567','94771234567','771234567','tel:+94771234567'])assert.deepEqual(parsePastedContact(text).contacts,[{name:'',phone:'+94771234567'}])
 assert.equal(parsePastedContact('Office: 0112345678').contacts[0].phone,'+94112345678')
})
test('multiple numbers are offered without choosing one silently, duplicate formats collapse',()=>{
 assert.deepEqual(parsePastedContact('ABC Hardware\n0771234567\n0112345678\n+94771234567').contacts,[{name:'ABC Hardware',phone:'+94771234567'},{name:'ABC Hardware',phone:'+94112345678'}])
})
test('labels are removed without removing words inside a legitimate business name',()=>{
 for(const name of ['Home Hardware','Phone Shop','Mobile World','General Hardware'])assert.equal(parsePastedContact(name+'\n0771234567').contacts[0].name,name)
 assert.equal(parsePastedContact('Contact name: Office Rep\nPhone: 0771234567').contacts[0].name,'Office Rep')
})
test('Sinhala and Tamil contact names are preserved',()=>{
 for(const name of ['නිමල් පෙරේරා','ரிஃப்கி'])assert.equal(parsePastedContact(name+'\n0771234567').contacts[0].name,name)
})
test('overseas, malformed, long and incomplete numbers are not relabelled as Sri Lankan',()=>{
 for(const text of ['Foreign\n+61 412345678','Foreign\n+1 650 123 4567','077123456789','077123','Not a contact','abc','0771234567 0712345678'])assert.equal(parsePastedContact(text).ok,false,text)
})
test('ambiguous names, empty and oversized text fail without changing any form',()=>{
 assert.equal(parsePastedContact('First Person\nSecond Person\n0771234567').ok,false)
 assert.equal(parsePastedContact('').ok,false)
 assert.equal(parsePastedContact('x'.repeat(4001)).ok,false)
})
