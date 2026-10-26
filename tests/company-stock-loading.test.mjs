import test from 'node:test'
import assert from 'node:assert/strict'
import {loadCompanyStockCatalogue,loadCompanyStockMarkers} from '../lib/company-stock-loading.mjs'

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}
function catalogueClient(responses,calls){
 return {from(table){
  const q={select(){return q},in(key,ids){calls.push({table,ids});return q},abortSignal(signal){q.signal=signal;return q},eq(){return q},order(){return q},range(start,end){return responses(table,start,end,q.signal)}}
  return q
 }}
}
test('items and sections start together and all item pages are retained',async()=>{
 const items=deferred(),sections=deferred(),calls=[],pages=[]
 const client=catalogueClient(async(table,start,end,signal)=>{
  pages.push({table,start,end,signal})
  if(table==='proc_company_sections')return sections.promise
  return start===0?items.promise:{data:[{id:'last-item'}]}
 },calls)
 const signal=new AbortController().signal
 const pending=loadCompanyStockCatalogue(client,['a','b'],signal)
 assert.equal(pages.length,2,'sections must start before the first item page completes')
 sections.resolve({data:[{id:'section'}]})
 items.resolve({data:Array.from({length:500},(_,id)=>({id}))})
 const result=await pending
 assert.equal(result.rows.length,501)
 assert.deepEqual(result.sections,[{id:'section'}])
 assert.deepEqual(pages.filter(p=>p.table==='proc_company_list_items').map(p=>p.start),[0,500])
 assert.ok(pages.every(p=>p.signal===signal))
 assert.ok(calls.every(c=>c.ids.join(',')==='a,b'))
})
test('empty scope does not query; errors never return an incomplete catalogue',async()=>{
 const calls=[]
 assert.deepEqual(await loadCompanyStockCatalogue({},[],null),{rows:[],sections:[]})
 const client=catalogueClient(async()=>({error:new Error('timed out')}),calls)
 await assert.rejects(loadCompanyStockCatalogue(client,['a'],null),/timed out/)
})
test('company history runs at most four requests concurrently and never mixes companies',async()=>{
 const gates=[],calls=[]
 const client={rpc(_name,params){const gate=deferred();gates.push(gate);calls.push(params);return gate.promise}}
 const rows=Array.from({length:7},(_,n)=>({company_id:'c'+n,item_id:'shared-item'}))
 const pending=loadCompanyStockMarkers(client,rows)
 assert.equal(calls.length,4)
 for(let n=0;n<7;n++){
  gates[n].resolve({data:[{item_id:'shared-item',count_no:calls[n].p_company_id}]})
  // Let the completed worker obtain the next company.
  await new Promise(resolve=>setImmediate(resolve))
 }
 const result=await pending
 assert.equal(calls.length,7)
 assert.equal(Object.keys(result).length,7)
 assert.equal(result['c0|shared-item'].count_no,'c0')
 assert.equal(result['c6|shared-item'].count_no,'c6')
})
test('failed company history rejects instead of returning partial success',async()=>{
 await assert.rejects(loadCompanyStockMarkers({rpc:async()=>({error:new Error('denied')})},[{company_id:'a',item_id:'b'}]),/denied/)
})
