import test from 'node:test'
import assert from 'node:assert/strict'
import {stockCountBatch} from '../lib/stock-batch.mjs'

test('small and empty drafts preserve zero quantities and exclude untouched entries',()=>{
 assert.deepEqual(stockCountBatch({}).checked,[])
 assert.deepEqual(stockCountBatch({zero:'0',empty:'',untouched:undefined,counted:'3.5'}).checked,[['zero','0'],['counted','3.5']])
})
test('large drafts submit within server limits and retain every remaining entry',()=>{
 for(const total of [999,1000,1001,2500,10000]){
  const entry=Object.fromEntries(Array.from({length:total},(_,i)=>['item-'+i,String(i)]))
  const snapshot=JSON.stringify(entry),submitted=[]
  while(Object.keys(entry).length){
   const {checked,remaining}=stockCountBatch(entry)
   assert.ok(checked.length<=1000)
   assert.equal(checked.length+remaining,Object.keys(entry).length)
   for(const [id,value] of checked){submitted.push([id,value]);delete entry[id]}
  }
  assert.equal(submitted.length,total)
  assert.equal(JSON.stringify(Object.fromEntries(submitted)),snapshot)
 }
})


test('sufficient checks are included without inventing physical quantities or duplicating items',()=>{
 const batch=stockCountBatch({nails:'12',pipes:'',bolts:'4'},{bolts:true,pipes:true,other:false})
 assert.deepEqual(batch.counted,[['nails','12']])
 assert.deepEqual(batch.checked,[['nails','12'],['bolts',null],['pipes',null]])
 assert.equal(batch.remaining,0)
})

test('mixed exact and sufficient flags respect the 1000-item submission limit across batches',()=>{
 const entry=Object.fromEntries(Array.from({length:975},(_,n)=>['count-'+n,String(n)]))
 const sufficient=Object.fromEntries(Array.from({length:80},(_,n)=>['enough-'+n,true]))
 let n=0
 while(Object.keys(entry).length||Object.keys(sufficient).length){
  const {checked,remaining}=stockCountBatch(entry,sufficient)
  assert.ok(checked.length<=1000)
  assert.equal(checked.length+remaining,Object.keys(entry).length+Object.keys(sufficient).length)
  for(const [id,value] of checked){
   assert.equal(value===null,Boolean(sufficient[id]))
   delete entry[id];delete sufficient[id];n++
  }
 }
 assert.equal(n,1055)
})
