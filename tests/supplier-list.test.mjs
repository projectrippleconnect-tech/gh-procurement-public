import test from 'node:test'
import assert from 'node:assert/strict'
import {supplierListRows} from '../lib/supplier-list.mjs'

const contacts=[
 {id:'b',name:'Zeta Ltd',supplier_kind:'general'},
 {id:'a',name:'alpha Ltd',supplier_kind:'general'},
 {id:'c',name:'ABC 10',supplier_kind:'company'},
 {id:'d',name:'ABC 2',supplier_kind:'company'},
 {id:'a',name:'alpha Ltd',supplier_kind:'general'},
 {id:'e',name:'Beta',supplier_kind:'general'},
]
test('A-Z supplier list is unique and preserves distinct supplier IDs',()=>{
 assert.deepEqual(supplierListRows(contacts,'all').map(s=>s.id),['d','c','a','e','b'])
})
test('supplier type and case-insensitive search work together',()=>{
 assert.deepEqual(supplierListRows(contacts,'company','abc').map(s=>s.id),['d','c'])
 assert.deepEqual(supplierListRows(contacts,'general','ALPHA').map(s=>s.id),['a'])
})
test('blank names and missing kinds do not break the list',()=>{
 const list=supplierListRows([{id:'x',name:'',supplier_kind:null},{id:'y',name:'Main'}],'general')
 assert.equal(list.length,2)
})
