import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizePriceInput} from '../lib/price-input.js'

test('price typing and pasted prices remove redundant leading zeros',()=>{
 for(const [input,expected] of [['05','5'],['00050','50'],['000','0'],['000.50','0.50'],['05.00','5.00']]){
  assert.equal(normalizePriceInput(input),expected)
 }
})

test('price editing preserves blank, zero, fractional precision and incomplete decimals',()=>{
 for(const value of ['', '0', '0.', '0.50', '.5', '5.', '5.00', '500']){
  assert.equal(normalizePriceInput(value),value)
 }
 assert.equal(normalizePriceInput(null),'')
})
