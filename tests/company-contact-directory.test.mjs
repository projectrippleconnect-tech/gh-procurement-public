import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeCompanyMobile,isCompleteCompanyContact} from '../lib/company-contact-directory.mjs'

test('Sri Lankan mobile formats are normalized without losing digits',()=>{
 assert.equal(normalizeCompanyMobile('076 360 9930'),'+94763609930')
 assert.equal(normalizeCompanyMobile('0771234567'),'+94771234567')
 assert.equal(normalizeCompanyMobile('+94 76 360 9930'),'+94763609930')
 assert.equal(normalizeCompanyMobile('94763609930'),'+94763609930')
})
test('invalid and partial numbers cannot be saved',()=>{
 for(const phone of ['076 360','+940763609930','12345','0111234567','',null,'+947636099301']){
  assert.equal(normalizeCompanyMobile(phone),null)
 }
 assert.equal(isCompleteCompanyContact('Contact','076 360 9930'),true)
 assert.equal(isCompleteCompanyContact('','076 360 9930'),false)
 assert.equal(isCompleteCompanyContact('Contact','076 360'),false)
})
