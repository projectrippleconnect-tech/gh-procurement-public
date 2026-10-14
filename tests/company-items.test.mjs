import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCompanySheet,reorderFor,companySuggested,validateCompanyImport,groupCompanyRows,companyCompactMeta,COMPANY_ITEM_COLUMNS,defaultCompanyFields} from '../lib/company-items.mjs'
test('company maximum preserves zero and missing review; fractional reorder is exact',()=>{assert.equal(reorderFor(3),1.5);assert.equal(reorderFor(null),null);assert.equal(companySuggested({target_stock:30},10),20);assert.equal(companySuggested({target_stock:30},16),0);assert.equal(companySuggested({target_stock:30},'',true),0);assert.equal(companySuggested({max_stock_review:true},2),null)})
test('Fevicol rain coat applies the maximum independently to each colour',()=>{const rows=parseCompanySheet({title:'FEVICOL ',sheetId:12,values:[['FEVICOL'],['RAIN COAT 1 LTR ALL COLOUR','GREEN','6'],['','WHITE'],['','GREY'],['','BLUE'],['RAIN COAT 4 LTR ALL COLOUR','GREEN','3'],['','WHITE']]});assert.deepEqual(rows.map(r=>r.max_stock),[6,6,6,6,3,3]);assert.deepEqual(rows.map(r=>r.colour),['GREEN','WHITE','GREY','BLUE','GREEN','WHITE'])})
test('wire brand matrix produces distinct items including blank maxima',()=>{const rows=parseCompanySheet({title:'WIRE CABLES',sheetId:1,values:[['','SR','SUPER PVC ACL'],['1044 WIRE BLUE','20','10'],['BOBBIN','1','']]});assert.equal(rows.length,4);assert.equal(rows[1].brand,'SUPER PVC ACL');assert.equal(rows[1].subgroup,'SUPER PVC ACL');assert.equal(rows[3].max_stock_review,true)})
test('matrix thickness/length and KG quantities stay distinct',()=>{const rows=parseCompanySheet({title:'BOLT & NUTS',sheetId:2,values:[['YP BOLT'],['','5mm','6mm'],['1/2"','1kg','2kg']]});assert.equal(rows.length,2);assert.equal(rows[0].uom,'KG');assert.equal(rows[0].size,'5mm');assert.equal(rows[0].variation,'1/2"')})
test('blank quantities are review records, not zeros',()=>{const rows=parseCompanySheet({title:'WURTH',sheetId:2,values:[['WURTH'],['SILICON CLEAR','0'],['WEATHER SHIELD','']]});assert.equal(rows[0].max_stock,0);assert.equal(rows[1].max_stock,null);assert.equal(rows[1].max_stock_review,true);assert.equal(validateCompanyImport(rows),rows)})

test('numeric thickness and washer headers remain variation axes',()=>{const board=parseCompanySheet({title:'BOARD ITEMS',sheetId:2,values:[['BOARD'],['DESCRIPTION','','1/2"','1'],['PLYWOOD','','30','3']]});assert.equal(board.length,2);assert.equal(board[0].description,'PLYWOOD');assert.equal(board[1].size,'1');const washer=parseCompanySheet({title:'BOLT & NUTS',sheetId:3,values:[['YP Washer'],['','1/2','1'],['5mm','1kg','']]});assert.equal(washer.length,2);assert.equal(washer[1].max_stock_review,true)})
test('hose column headings create lengths without a spurious header item',()=>{const rows=parseCompanySheet({title:'ALCATHINE',sheetId:2,values:[[],['ALCATHINE HOSE'],['SIZE','100 FT','200 FT'],['1/2"','20','10']]});assert.equal(rows.length,2);assert.equal(rows[0].description,'ALCATHINE HOSE 1/2"');assert.equal(rows[0].size,'100 FT')})

test('source identity survives inserted sheet rows without duplicating items',()=>{const a=parseCompanySheet({title:'WURTH',sheetId:8,values:[['WURTH'],['SILICON CLEAR','50']]});const b=parseCompanySheet({title:'WURTH',sheetId:8,values:[['WURTH'],['RUST OFF','6'],['SILICON CLEAR','50']]});assert.equal(a[0].source_key,b[1].source_key)})
test('conflicting duplicate maxima are held for review',()=>{const rows=parseCompanySheet({title:'WURTH',sheetId:8,values:[['WURTH'],['RUST OFF','6'],['RUST OFF','10']]});assert.equal(rows.length,1);assert.equal(rows[0].max_stock,null)})

test('company stock rows are grouped naturally without merging duplicate names',()=>{
 const rows=[
  {id:'r3',item:{category:'GENERAL',subgroup:'Panel',description:'24W',size:'24W'}},
  {id:'r2',item:{category:'ELECTRICAL',subgroup:'Lights',description:'12 FEET',size:'12 FEET'}},
  {id:'r1',item:{category:'GENERAL',subgroup:'Panel',description:'24W',size:'24W'}}
 ]
 const groups=groupCompanyRows(rows)
 assert.deepEqual(groups.map(g=>g.title),['ELECTRICAL / Lights','GENERAL / Panel'])
 assert.deepEqual(groups.flatMap(g=>g.items.map(x=>x.id)),['r2','r1','r3'])
 assert.equal(groups[1].items.length,2)
 assert.deepEqual(companyCompactMeta(rows[0].item,{size:true,uom:true}),[],'Repeat 24W is hidden in metadata')
 assert.deepEqual(companyCompactMeta({description:'Spotlight',size:'24W',uom:'PCS'},{size:true,uom:true}).map(x=>x.value),['24W','PCS'])
})

test('company inventory omits movement from row display and configurable columns',()=>{
 const {movement,...item}={description:'Bixton LED panel light',size:'12W',movement:'FAST',uom:'PCS'}
 assert.equal(movement,'FAST','underlying stock movement is not changed')
 assert.equal(COMPANY_ITEM_COLUMNS.includes('movement'),false)
 assert.equal('movement' in defaultCompanyFields,false)
 assert.equal(companyCompactMeta({...item,movement:'FAST'},{movement:true}).some(x=>x.key==='movement'),false)
})
