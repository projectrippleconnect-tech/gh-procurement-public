import test from 'node:test'
import assert from 'node:assert/strict'
import {encodeSupplierQuoteNotes,decodeSupplierQuoteNotes,validateSupplierQuoteVariants,normalizePriceInput} from '../lib/quote-line-notes.js'
test('size quantity and price survive saving and reopening, including legacy reference sizes',()=>{
 const v={size:'2 feet',price:'40',quantity:'6',remarks:'Extra'}
 const decoded=decodeSupplierQuoteNotes(encodeSupplierQuoteNotes({variants:[v]})).variants[0]
 assert.equal(decoded.quantity,'6');assert.equal(Number(decoded.price)*Number(decoded.quantity),240)
 assert.equal(validateSupplierQuoteVariants([v]),true)
 assert.equal(validateSupplierQuoteVariants([{...v,quantity:'0'}]),false)
 assert.equal(validateSupplierQuoteVariants([{...v,quantity:'-2'}]),false)
 assert.equal(validateSupplierQuoteVariants([{...v,quantity:'Infinity'}]),false)
 assert.equal(decodeSupplierQuoteNotes('GH_QUOTE_NOTES_V1:{"variants":[{"size":"2 feet","price":"40"}]}').variants[0].quantity,'')
})
test('price typing removes integer leading zeros without damaging decimal prices',()=>{
 for(const [input,expected] of [['05','5'],['00040','40'],['0.5','0.5'],['00.5','0.5'],['0','0'],['','']])assert.equal(normalizePriceInput(input),expected)
})
