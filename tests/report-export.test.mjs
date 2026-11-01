import test from 'node:test'
import assert from 'node:assert/strict'
import {completeReport} from '../lib/report-export.mjs'
test('complete exports preserve every filtered page and do not truncate to screen size',async()=>{
 const rows=Array.from({length:1027},(_,id)=>({id})),calls=[]
 const result=await completeReport(async(offset,size)=>{calls.push(offset);return {data:rows.slice(offset,offset+size)}},500)
 assert.deepEqual(result,rows);assert.deepEqual(calls,[0,500,1000])
})
test('export fails rather than returning partial results when a later page fails',async()=>{
 await assert.rejects(completeReport(async offset=>offset?{error:Error('offline')}:{data:[1,2]},2),/offline/)
 await assert.rejects(completeReport(async()=>({data:[1,2]}),2,4),/100,000/)
})
