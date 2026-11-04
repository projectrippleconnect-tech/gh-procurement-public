import test from 'node:test'
import assert from 'node:assert/strict'
import {companyLotRows,companyLotGroups} from '../lib/company-stock-lot.mjs'

test('pause after three, then add five; review contains eight unique counts',()=>{
 const rows=Array.from({length:8},(_,i)=>({id:'c'+i,company_id:'companyA',item_id:'p'+i}))
 const entry=Object.fromEntries(rows.slice(0,3).map(r=>[r.id,'0']))
 assert.equal(companyLotRows(rows,entry).length,3)
 for(const r of rows.slice(3))entry[r.id]='5'
 entry.c0='8'
 assert.equal(companyLotRows(rows,entry).length,8)
 assert.equal(companyLotGroups(companyLotRows(rows,entry)).length,1)
})
test('same Item Master in two companies is not deduplicated across companies',()=>{
 const rows=[{id:'a',company_id:'companyA',item_id:'bolt'},{id:'b',company_id:'companyB',item_id:'bolt'}]
 const lot=companyLotRows(rows,{a:'0',b:'3'})
 assert.equal(lot.length,2)
 assert.equal(companyLotGroups(lot).length,2)
})
test('previously submitted items require explicit recount, not silent overwrites',()=>{
 const rows=[{id:'a',company_id:'A',item_id:'x'}]
 const prev={'A|x':{count_no:'COMPANY-123'}}
 assert.equal(companyLotRows(rows,{a:'3'},{},prev)[0].blocked,true)
 assert.equal(companyLotRows(rows,{a:'3'},{},prev,new Set(['a']))[0].blocked,false)
})
test('enough flag contributes exactly one line and does not fabricate quantity',()=>{
 const rows=[{id:'a',company_id:'A',item_id:'x'}]
 const result=companyLotRows(rows,{a:'18'},{a:true})
 assert.equal(result.length,1)
 assert.equal(result[0].quantity,null)
})
