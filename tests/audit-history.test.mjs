import test from 'node:test'
import assert from 'node:assert/strict'
import {completeAuditExport,auditQuery} from '../lib/audit-history.mjs'
test('exports beyond the old 100-row cap and freezes the newest ID between batches',async()=>{
 const original=Array.from({length:1257},(_,i)=>({id:1257-i}));let calls=0
 const result=await completeAuditExport(async({cursor,ceiling,pageSize})=>{
  calls++;if(calls>1)assert.equal(ceiling,'1257')
  return {data:original.filter(r=>(!cursor||r.id<Number(cursor))&&(!ceiling||r.id<=Number(ceiling))).slice(0,pageSize)}
 })
 assert.equal(result.length,1257);assert.equal(result.at(-1).id,1);assert.equal(calls,3)
})
test('failed later page cannot produce a partial export',async()=>{
 let count=0
 await assert.rejects(completeAuditExport(async()=>++count===1?{data:[{id:2}]}:{error:Error('Connection lost')},{pageSize:1}),/Connection lost/)
})
test('repeated cursor fails instead of looping or silently duplicating entries',async()=>{
 await assert.rejects(completeAuditExport(async()=>({data:[{id:7}]}),{pageSize:1}),/order changed/)
})
test('search validates record IDs and uses shop-day boundaries',()=>{
 const calls=[];const q=new Proxy({}, {get:(_,k)=>(...args)=>{calls.push([k,...args]);return q}})
 auditQuery({from:()=>q},{from:'2026-11-01',to:'2026-11-04',area:'proc_items'})
 assert.ok(calls.some(c=>c[0]==='gte'&&c[2]==='2026-11-01T00:00:00+05:30'))
 assert.ok(calls.some(c=>c[0]==='lt'&&c[2]==='2026-11-05T00:00:00+05:30'))
 assert.throws(()=>auditQuery({from:()=>q},{record:'invalid'}),/valid record ID/)
})
