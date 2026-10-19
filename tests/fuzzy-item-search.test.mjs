import test from 'node:test'
import assert from 'node:assert/strict'
import {indexStockItems,searchStockItems,isApproximateItemMatch,stockItemLabel} from '../lib/stock-search.mjs'
import {normalizeItemSearch} from '../lib/fuzzy-item-search.mjs'

const catalogue=indexStockItems([
 {id:'nails',description:'CONCRETE NAILS',size:'2 inch',category:'GENERAL',movement:'FAST'},
 {id:'drill',description:'CONCRETE DRILL',size:'12mm',category:'GENERAL',movement:'SLOW'},
 {id:'wire',description:'COPPER WIRE',category:'ELECTRICAL',movement:'FAST'},
 {id:'pipe',description:'PVC PIPE',category:'GENERAL',movement:'NORMAL'},
 {id:'plate',description:'ALUMINIUM SHEET',category:'ALUMINIUM'},
 {id:'bit',description:'10mm',size:'10mm',subgroup:'CONCRETE BIT',category:'PE+',brand:'PE+'},
 {id:'bolt',description:'BOLT',size:'8mm',category:'GENERAL'}
])
const ids=(query,filters={},limit=30)=>searchStockItems(catalogue,query,filters,limit).map(x=>x.item_id)

test('misspellings and transposed letters find likely items',()=>{
 assert.deepEqual(ids('concret nals'),['nails'])
 assert.deepEqual(ids('coper wir'),['wire'])
 assert.deepEqual(ids('cnocrete'),['nails','drill','bit'])
 assert.deepEqual(ids('coppre'),['wire'])
})

test('recognises alternate shop spellings without changing stored item descriptions',()=>{
 assert.deepEqual(ids('paip'),['pipe'])
 assert.deepEqual(ids('bata'),['pipe'])
 assert.deepEqual(ids('alumunium'),['plate'])
 assert.equal(catalogue.find(r=>r.item_id==='pipe').description,'PVC PIPE')
})

test('prioritises exact visible items and displays probable suggestions as such',()=>{
 assert.deepEqual(ids('concrete'),['nails','drill','bit'])
 assert.equal(isApproximateItemMatch(catalogue[0],'concrete'),false)
 assert.equal(isApproximateItemMatch(catalogue[0],'concret nals'),true)
 assert.equal(stockItemLabel(catalogue[5]),'CONCRETE BIT · 10mm')
})

test('keeps structured filters and precise numeric item sizes',()=>{
 assert.deepEqual(ids('concret',{category:'PE+'}),['bit'])
 assert.deepEqual(ids('concret',{category:'GENERAL'}),['nails','drill'])
 assert.deepEqual(ids('concrete 2'),['nails'])
 assert.deepEqual(ids('8mm'),['bolt'])
 assert.deepEqual(ids(''),[])
})

test('short or unrelated misspellings cannot flood the list',()=>{
 assert.deepEqual(ids('zx'),[])
 assert.deepEqual(ids('xyzunrelated'),[])
 assert.deepEqual(ids('concrete',{category:'ELECTRICAL'}),[])
 assert.deepEqual(ids('c',{},1),['nails'])
})

test('stock count hold with complete exact results does not include approximate suggestions',()=>{
 const exact=indexStockItems([{id:'a',description:'CONCRETE NAILS'}, {id:'b',description:'CONCRETE NAIL'}])
 assert.deepEqual(searchStockItems(exact,'concrete nail',{},Infinity).map(r=>r.item_id),['a','b'])
 assert.deepEqual(searchStockItems(exact,'concret nals',{},Infinity).map(r=>r.item_id),['a'])
})

test('script-sensitive text keeps Sinhala and Tamil vowel signs intact',()=>{
 assert.equal(normalizeItemSearch('කම්බි බට'),'කම්බි බට')
 assert.equal(normalizeItemSearch('கம்பி குழாய்'),'கம்பி குழாய்')
})

test('large catalogue remains fast for exact searches',()=>{
 const large=indexStockItems(Array.from({length:20000},(_,n)=>({id:String(n),description:n%200===0?'Concrete nails':'Shelf bracket'})))
 const before=performance.now()
 for(const q of ['c','co','con','conc','concr'])assert.equal(searchStockItems(large,q).length,30)
 assert.ok(performance.now()-before<150)
})


test('Pad loc, Padloc, PAD LOCK and PADLOCK return identical items and ordering',()=>{
 const padlocks=indexStockItems([
  {id:'black32',description:'BLACK PADLOCK 32MM KOBE',category:'KOBE',movement:'NORMAL'},
  {id:'pad20',description:'PAD LOCK',size:'20MM',category:'GENERAL',movement:'FAST'},
  {id:'pad32',description:'PAD LOCK',size:'32MM',category:'GENERAL',movement:'FAST'},
  {id:'viro',description:'VIRO PADLOCK',size:'CYLINDER',category:'GENERAL',movement:'SLOW'},
  {id:'pad25',description:'PAD LOCK',size:'25MM',category:'GENERAL',movement:'FAST'},
  {id:'unrelated',description:'BOLT LOCK',category:'GENERAL'}
 ])
 const expected=['black32','pad20','pad32','viro','pad25']
 for(const query of ['Pad loc','Padloc','PAD LOCK','PADLOCK','pad lok']){
  assert.deepEqual(searchStockItems(padlocks,query).map(r=>r.item_id),expected,query)
  assert.deepEqual(searchStockItems(padlocks,query,{},3).map(r=>r.item_id),expected.slice(0,3),query+' limit')
  assert.deepEqual(searchStockItems(padlocks,query,{},Infinity).map(r=>r.item_id),expected,query+' held')
  assert.deepEqual(searchStockItems(padlocks,query,{movement:'FAST'}).map(r=>r.item_id),['pad20','pad32','pad25'])
 }
 assert.equal(isApproximateItemMatch(padlocks[1],'Padloc'),false,'Recognized alternate spellings are direct matches')
 assert.deepEqual(searchStockItems(padlocks,'pad loc 20').map(r=>r.item_id),['pad20'],'Item sizes remain distinct')
 assert.deepEqual(new Set(searchStockItems(padlocks,'lock',{},Infinity).map(r=>r.item_id)),new Set(expected.concat('unrelated')))
})

test('common hardware compound spacing keeps the same results',()=>{
 const rows=indexStockItems([
  {id:'screw',description:'SCREW DRIVER',size:'6MM'},
  {id:'screw2',description:'SCREWDRIVER',size:'8MM'},
  {id:'wash',description:'WASH BASIN'},
  {id:'wash2',description:'WASHBASIN'}
 ])
 assert.deepEqual(searchStockItems(rows,'screw driver').map(x=>x.item_id),['screw','screw2'])
 assert.deepEqual(searchStockItems(rows,'screwdriver').map(x=>x.item_id),['screw','screw2'])
 assert.deepEqual(searchStockItems(rows,'wash basin').map(x=>x.item_id),['wash','wash2'])
 assert.deepEqual(searchStockItems(rows,'washbasin').map(x=>x.item_id),['wash','wash2'])
})
