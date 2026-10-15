import test from 'node:test'
import assert from 'node:assert/strict'
import {buildReviewedPlan,legacySheetValues,reviewedNameAt,reviewedCategoriesAt} from '../lib/reviewed-company-sync.mjs'

test('sidecar columns do not get interpreted as stock quantities',()=>{
 const data=[['','SR','ACL','','','','FULL NAME','CATEGORY'],['1044','20','10','','','','1044 WIRE SR','1044 WIRES']]
 assert.deepEqual(legacySheetValues('WIRE CABLES',data),[['','SR','ACL','','',''],['1044','20','10','','','']])
})
test('reviewed names map to exact sidecar cells for matrices',()=>{
 let b=Array(17).fill(null).map(()=>[])
 b[3][6]='YELLOW-PLATED BOLT 5MM X 1/2IN'
 b[3][10]='YELLOW-PLATED BOLT 12MM X 1/2IN'
 assert.equal(reviewedNameAt('BOLT & NUTS',b,3,1),'YELLOW-PLATED BOLT 5MM X 1/2IN')
 assert.equal(reviewedNameAt('BOLT & NUTS',b,3,5),'YELLOW-PLATED BOLT 12MM X 1/2IN')
 let k=Array(20).fill(null).map(()=>[])
 k[15][3]='LED FLOODLIGHT 10W DL KOBE';k[15][4]='LED FLOODLIGHT 10W WW KOBE'
 k[4][4]='WHEELBARROW KOBE'
 assert.equal(reviewedNameAt('KOBE',k,15,1),'LED FLOODLIGHT 10W DL KOBE')
 assert.equal(reviewedNameAt('KOBE',k,15,2),'LED FLOODLIGHT 10W WW KOBE')
 assert.equal(reviewedNameAt('KOBE',k,4,2),'WHEELBARROW KOBE')
 let board=Array(20).fill(null).map(()=>[])
 board[13][9]='CLADDING BOARD WHITE';board[3][9]='PLYWOOD BOARD LOCAL 1/8IN'
 assert.equal(reviewedNameAt('BOARD ITEMS',board,13,3),'CLADDING BOARD WHITE')
 assert.equal(reviewedNameAt('BOARD ITEMS',board,3,2),'PLYWOOD BOARD LOCAL 1/8IN')
})
test('modular categories stay independent of source stock and do not rewrite keys',()=>{
 const values=Array(4).fill(null).map(()=>[])
 values[2][3]='SWITCHES';values[2][4]='AKOYA';values[2][6]='MODULAR'
 assert.deepEqual(reviewedCategoriesAt('ORANGE',values,2),{main_group:'SWITCHES',subgroup:'AKOYA'})
})
test('exact source key edits existing item ID only; never quantity',()=>{
 const v=[[],[]];v[1][3]='LED PANEL LIGHT 6W SUNK DL BIXTON'
 const item={id:'item1',source:'COMPANY SHEET',description:'6W',main_group:'BIXTON',subgroup:'BIXTON'}
 const links=[{id:'link1',item_id:'item1',active:true,source_key:'same-hash',target_stock:12,item}]
 const r=buildReviewedPlan({title:'BIXTON',sheetId:358,values:v,parsedRows:[{source_key:'same-hash',source_position:'358:2:2'}],links})
 assert.equal(r.stats.changes,1)
 assert.equal(r.stats.matched,1)
 assert.deepEqual(r.changes[0].patch,{description:'LED PANEL LIGHT 6W SUNK DL BIXTON'})
 assert.equal(Object.hasOwn(r.changes[0].patch,'target_stock'),false)
})
test('modified source key never silently matches by order or quantity',()=>{
 const v=[[],[]];v[1][3]='LED PANEL LIGHT 6W SUNK DL BIXTON'
 const item={id:'item1',source:'COMPANY SHEET',description:'6W'}
 const links=[{id:'link1',item_id:'item1',active:true,source_key:'legacy-hash',target_stock:12,item}]
 const result=buildReviewedPlan({title:'BIXTON',sheetId:358,values:v,parsedRows:[{source_key:'new-hash',source_position:'358:2:2'}],links})
 assert.equal(result.stats.changes,0)
 assert.equal(result.stats.unmatched,1)
})
