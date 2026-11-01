import test from 'node:test'
import assert from 'node:assert/strict'
import {deduplicatedReads} from '../lib/read-request-dedup.mjs'
const root='https://db.example.invalid/rest/v1/'
test('simultaneous identical authenticated reads share one request and independent responses',async()=>{
 let count=0,release
 const gate=new Promise(r=>{release=r})
 const fetcher=deduplicatedReads(async()=>{count++;await gate;return Response.json({ok:true})})
 const a=fetcher(root+'proc_items',{headers:{Authorization:'Bearer one'}}),b=fetcher(root+'proc_items',{headers:{Authorization:'Bearer one'}})
 await Promise.resolve();assert.equal(count,1);release()
 assert.deepEqual(await (await a).json(),{ok:true});assert.deepEqual(await (await b).json(),{ok:true})
 await fetcher(root+'proc_items',{headers:{Authorization:'Bearer one'}});assert.equal(count,2,'completed responses are never cached')
})
test('accounts, range/representation headers and writes never share requests',async()=>{
 let count=0
 const fetcher=deduplicatedReads(async()=>{count++;return Response.json([])})
 await Promise.all([
  fetcher(root+'proc_items',{headers:{Authorization:'Bearer one'}}),fetcher(root+'proc_items',{headers:{Authorization:'Bearer two'}}),
  fetcher(root+'proc_items',{headers:{Authorization:'Bearer one',Accept:'application/vnd.pgrst.object+json'}}),
  fetcher(root+'proc_items',{method:'POST',body:'{}'}),fetcher(root+'proc_items',{method:'POST',body:'{}'}),
  fetcher(root+'rpc/proc_submit_stock_and_continue_v3',{method:'POST',body:'{}'}),fetcher(root+'rpc/proc_submit_stock_and_continue_v3',{method:'POST',body:'{}'})
 ]);assert.equal(count,7)
})
test('cancelled requests keep their own signal and failures are not retained',async()=>{
 let count=0;const controller=new AbortController()
 const fetcher=deduplicatedReads(async(_input,init)=>{count++;if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');if(count===3)throw Error('offline');return Response.json([])})
 await Promise.all([fetcher(root+'proc_items',{signal:controller.signal}),fetcher(root+'proc_items',{signal:controller.signal})]);assert.equal(count,2)
 await assert.rejects(fetcher(root+'proc_items'),/offline/);await fetcher(root+'proc_items');assert.equal(count,4)
})
