import test from 'node:test'
import assert from 'node:assert/strict'
import {toCompanyPhone} from '../lib/company-contacts.mjs'

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
