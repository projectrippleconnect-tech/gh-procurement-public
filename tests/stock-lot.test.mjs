import test from 'node:test'
import assert from 'node:assert/strict'
import {stockLotReview} from '../lib/stock-lot.mjs'

test('three saved entries plus five later edits remain one eight-item lot',()=>{
 const entry={a:'0',b:'1',c:'2'}
 for(let i=0;i<5;i++)entry['next'+i]=String(i+3)
 const lot=stockLotReview(entry,{})
 assert.equal(lot.count,8)
 entry.a='7'
 assert.equal(stockLotReview(entry,{}).count,8)
 assert.equal(stockLotReview(entry,{}).rows.find(x=>x.id==='a').quantity,'7')
})
test('sufficient and exact stock cannot double count one item; zero counts',()=>{
 const lot=stockLotReview({x:'0',y:'9'},{y:true,z:true})
 assert.equal(lot.count,3)
 assert.equal(lot.rows.find(x=>x.id==='x').quantity,'0')
 assert.equal(lot.rows.find(x=>x.id==='y').quantity,null)
})
test('previously finalized item needs explicit recount while draft items remain editable',()=>{
 const marker={x:{count_no:'ST-001',submitted_at:'2026-10-18'}}
 const initial=stockLotReview({x:'5',y:'3'},{},{},marker)
 assert.equal(initial.blocked.length,1)
 assert.equal(initial.ready,1)
 const recount=new Set(['x'])
 const waiting=stockLotReview({y:'3'},{},{},marker,recount)
 assert.equal(waiting.count,2)
 assert.deepEqual(waiting.incomplete.map(row=>row.id),['x'])
 assert.equal(waiting.ready,1)
 assert.equal(stockLotReview({x:'0',y:'3'},{},{},marker,recount).ready,2)
 assert.equal(stockLotReview({x:'.',y:'3'},{},{},marker,recount).ready,1)
 assert.equal(stockLotReview({y:'3'},{x:true},{},marker,recount).ready,2)
})
test('a single final lot refuses silently splitting after server maximum',()=>{
 const entry=Object.fromEntries(Array.from({length:1001},(_,i)=>['item'+i,'0']))
 const lot=stockLotReview(entry,{})
 assert.equal(lot.count,1001)
 assert.equal(lot.rows.length,1001)
 assert.equal(lot.overLimit,true)
})
