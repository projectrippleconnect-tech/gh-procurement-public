import test from 'node:test'
import assert from 'node:assert/strict'
import {withStartupDeadline} from '../lib/workspace-startup.mjs'

test('startup resolves promptly when access checks finish',async()=>{
 assert.deepEqual(await withStartupDeadline(Promise.resolve({active:true}),50),{active:true})
})
test('startup preserves an explicit disabled-access error',async()=>{
 await assert.rejects(withStartupDeadline(Promise.reject(new Error('Access disabled')),50),/Access disabled/)
})
test('a stalled startup becomes a retryable error rather than an endless loader',async()=>{
 await assert.rejects(withStartupDeadline(new Promise(()=>{}),10),/taking too long/)
})
test('a late access result cannot turn a timed-out startup into success',async()=>{
 let finish
 const work=new Promise(resolve=>{finish=resolve})
 const bounded=withStartupDeadline(work,10)
 await assert.rejects(bounded,/taking too long/)
 finish({active:true})
 await assert.rejects(bounded,/taking too long/)
})
