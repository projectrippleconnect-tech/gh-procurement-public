import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCompanySheet,reorderFor,companySuggested,validateCompanyImport} from '../lib/company-items.mjs'
test('company maximum preserves zero and missing review; fractional reorder is exact',()=>{assert.equal(reorderFor(3),1.5);assert.equal(reorderFor(null),null);assert.equal(companySuggested({target_stock:30},10),20);assert.equal(companySuggested({target_stock:30},16),0);assert.equal(companySuggested({target_stock:30},'',true),0);assert.equal(companySuggested({max_stock_review:true},2),null)})
test('Fevicol rain coat applies the maximum independently to each colour',()=>{const rows=parseCompanySheet({title:'FEVICOL ',sheetId:12,values:[['FEVICOL'],['RAIN COAT 1 LTR ALL COLOUR','GREEN','6'],['','WHITE'],['','GREY'],['','BLUE'],['RAIN COAT 4 LTR ALL COLOUR','GREEN','3'],['','WHITE']]});assert.deepEqual(rows.map(r=>r.max_stock),[6,6,6,6,3,3]);assert.deepEqual(rows.map(r=>r.colour),['GREEN','WHITE','GREY','BLUE','GREEN','WHITE'])})
test('wire brand matrix produces distinct items including blank maxima',()=>{const rows=parseCompanySheet({title:'WIRE CABLES',sheetId:1,values:[['','SR','SUPER PVC ACL'],['1044 WIRE BLUE','20','10'],['BOBBIN','1','']]});assert.equal(rows.length,4);assert.equal(rows[1].brand,'SUPER PVC ACL');assert.equal(rows[1].subgroup,'SUPER PVC ACL');assert.equal(rows[3].max_stock_review,true)})
test('matrix thickness/length and KG quantities stay distinct',()=>{const rows=parseCompanySheet({title:'BOLT & NUTS',sheetId:2,values:[['YP BOLT'],['','5mm','6mm'],['1/2"','1kg','2kg']]});assert.equal(rows.length,2);assert.equal(rows[0].uom,'KG');assert.equal(rows[0].size,'5mm');assert.equal(rows[0].variation,'1/2"')})
test('blank quantities are review records, not zeros',()=>{const rows=parseCompanySheet({title:'WURTH',sheetId:2,values:[['WURTH'],['SILICON CLEAR','0'],['WEATHER SHIELD','']]});assert.equal(rows[0].max_stock,0);assert.equal(rows[1].max_stock,null);assert.equal(rows[1].max_stock_review,true);assert.equal(validateCompanyImport(rows),rows)})

test('numeric thickness and washer headers remain variation axes',()=>{const board=parseCompanySheet({title:'BOARD ITEMS',sheetId:2,values:[['BOARD'],['DESCRIPTION','','1/2"','1'],['PLYWOOD','','30','3']]});assert.equal(board.length,2);assert.equal(board[0].description,'PLYWOOD');assert.equal(board[1].size,'1');const washer=parseCompanySheet({title:'BOLT & NUTS',sheetId:3,values:[['YP Washer'],['','1/2','1'],['5mm','1kg','']]});assert.equal(washer.length,2);assert.equal(washer[1].max_stock_review,true)})
test('hose column headings create lengths without a spurious header item',()=>{const rows=parseCompanySheet({title:'ALCATHINE',sheetId:2,values:[[],['ALCATHINE HOSE'],['SIZE','100 FT','200 FT'],['1/2"','20','10']]});assert.equal(rows.length,2);assert.equal(rows[0].description,'ALCATHINE HOSE 1/2"');assert.equal(rows[0].size,'100 FT')})

test('source identity survives inserted sheet rows without duplicating items',()=>{const a=parseCompanySheet({title:'WURTH',sheetId:8,values:[['WURTH'],['SILICON CLEAR','50']]});const b=parseCompanySheet({title:'WURTH',sheetId:8,values:[['WURTH'],['RUST OFF','6'],['SILICON CLEAR','50']]});assert.equal(a[0].source_key,b[1].source_key)})
test('conflicting duplicate maxima are held for review',()=>{const rows=parseCompanySheet({title:'WURTH',sheetId:8,values:[['WURTH'],['RUST OFF','6'],['RUST OFF','10']]});assert.equal(rows.length,1);assert.equal(rows[0].max_stock,null)})

test('Bixton LED panel lights use complete descriptions without changing variant identities after sheet renaming',()=>{
 const before=parseCompanySheet({title:'BIXTON',sheetId:358620078,values:[
  ['BIXTON'],['','SUNK','SURFACE'],['6W','12','12'],[],['WARM WHITE'],['','SUNK','SURFACE'],['6W','6','6']
 ]})
 const after=parseCompanySheet({title:'BIXTON',sheetId:358620078,values:[
  ['BIXTON'],['','SUNK','SURFACE'],['BIXTON LED PANEL LIGHT 6W','12','12'],[],['WARM WHITE'],['','SUNK','SURFACE'],['BIXTON LED PANEL LIGHT 6W - WARM WHITE','6','6']
 ]})
 assert.equal(before.length,4)
 assert.deepEqual(before.map(x=>x.description),[
  'BIXTON LED PANEL LIGHT 6W','BIXTON LED PANEL LIGHT 6W',
  'BIXTON LED PANEL LIGHT 6W - WARM WHITE','BIXTON LED PANEL LIGHT 6W - WARM WHITE'
 ])
 assert.deepEqual(before.map(x=>x.source_key),after.map(x=>x.source_key))
 assert.deepEqual(before.map(x=>x.max_stock),[12,12,6,6])
 assert.deepEqual(before.map(x=>x.variation),['SUNK','SURFACE','SUNK','SURFACE'])
})
test('YP washer and nut descriptions remain stable after expanding supplier shorthand',()=>{
 const before=parseCompanySheet({title:'BOLT & NUTS',sheetId:16705802,values:[
  ['YP Washer'],['','1/2','1'],['5mm','1kg',''],[],['YP NUT'],['5mm','2kg']
 ]})
 const after=parseCompanySheet({title:'BOLT & NUTS',sheetId:16705802,values:[
  ['YELLOW-PLATED WASHER'],['','1/2','1'],['5mm','1kg',''],[],['YELLOW-PLATED NUT'],['5mm','2kg']
 ]})
 assert.deepEqual(before.map(x=>x.source_key),after.map(x=>x.source_key))
 assert.ok(after.some(x=>x.description.includes('YELLOW-PLATED WASHER')))
 assert.ok(after.some(x=>x.description==='YELLOW-PLATED NUT'))
})
