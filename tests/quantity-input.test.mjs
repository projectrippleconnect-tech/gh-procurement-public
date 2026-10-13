import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeQuantityInput,isQuantityInput,normalizeQuantityDraft} from '../lib/quantity-input.mjs'
test('stock quantities remove leading zeroes while retaining meaningful zeroes and decimals',()=>{
 for(const [source,result] of [['001','1'],['00101','101'],['000','0'],['0','0'],['01','1'],['000.125','0.125'],['.5','0.5'],['0.','0.'],['','']])assert.equal(normalizeQuantityInput(source),result)
})
test('malformed, signed, exponential and infinite stock values are not interpreted as valid counts',()=>{
 for(const value of ['0 1','1e3','0x10','-1','+1','1..2','NaN','Infinity','1,000','9'.repeat(400)])assert.equal(isQuantityInput(value),false,value)
 assert.equal(isQuantityInput('.'),false);assert.equal(isQuantityInput(''),false)
 assert.equal(isQuantityInput('0'),true);assert.equal(isQuantityInput('0.125'),true)
})
test('restored drafts normalize counts without losing invalid values or untouched entries',()=>{
 assert.deepEqual(normalizeQuantityDraft({a:'001',b:'',c:undefined,d:'1e2',e:'00.20'}),{a:'1',b:'',c:undefined,d:'1e2',e:'0.20'})
})
