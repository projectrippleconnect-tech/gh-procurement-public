import test from 'node:test'
import assert from 'node:assert/strict'
import {withOperationDeadline} from '../lib/operation-deadline.mjs'

test('completed and rejected worker operations retain their actual result',async()=>{
 assert.equal(await withOperationDeadline(Promise.resolve(12)),12)
 await assert.rejects(withOperationDeadline(Promise.reject(new Error('Worker failed'))),/Worker failed/)
})
test('stalled workers produce actionable errors and late workers are cleaned up',async()=>{
 let finish,terminated=false
 const work=new Promise(resolve=>{finish=resolve})
 await assert.rejects(withOperationDeadline(work,{milliseconds:5,message:'Enter prices manually',onLateResult:value=>{terminated=value}}),/Enter prices manually/)
 finish(true)
 await new Promise(resolve=>setTimeout(resolve,0))
 assert.equal(terminated,true)
})
