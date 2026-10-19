import test from 'node:test'
import assert from 'node:assert/strict'
import {validateStockSubmission,isDisconnected} from '../lib/offline-stock.mjs'

const general={ownerId:'user-1',kind:'general',lines:[{item_id:'abc',current_stock:0,sufficient_stock:false}]}
const company={ownerId:'user-1',kind:'company',companyId:'company-1',lines:[{company_list_item_id:'abc',current_stock:null,sufficient_stock:true}]}
test('validates general, company and zero-stock operations',()=>{
 assert.equal(validateStockSubmission(general),true)
 assert.equal(validateStockSubmission(company),true)
})
test('rejects duplicate lines and unsafe quantities',()=>{
 assert.throws(()=>validateStockSubmission({...general,lines:[...general.lines,...general.lines]}),/duplicated/)
 assert.throws(()=>validateStockSubmission({...general,lines:[{item_id:'abc',current_stock:-1}]}),/Invalid counted/)
 assert.throws(()=>validateStockSubmission({...company,companyId:null}),/Choose a company/)
 assert.throws(()=>validateStockSubmission({...general,lines:[]}),/1–1000/)
})
test('does not incorrectly report offline in non-browser unit tests',()=>{
 assert.equal(isDisconnected(),false)
})


// Minimal IndexedDB transactional mock used only by the unit tests below.
// It executes every request asynchronously and resolves writes on tx.oncomplete.
function installOfflineDb(){
 const tables=new Map()
 const schedule=callback=>queueMicrotask(callback)
 const db={
  objectStoreNames:{contains:name=>tables.has(name)},
  createObjectStore:name=>tables.set(name,new Map()),
  transaction(name){
   const tx={oncomplete:null,onerror:null,onabort:null,abort(){schedule(()=>this.onabort?.())}}
   const request=(action,input)=>{
    const r={}
    schedule(()=>{
     const map=tables.get(name)
     try{
      if(action==='get')r.result=map.get(input)
      else if(action==='getAll')r.result=[...map.values()]
      else if(action==='delete'){map.delete(input);r.result=undefined}
      else{
       const key=input.id??input.key
       if(action==='add'&&map.has(key))throw new Error('Key already exists')
       map.set(key,input);r.result=key
      }
      r.onsuccess?.()
      schedule(()=>tx.oncomplete?.())
     }catch(e){r.error=e;r.onerror?.();tx.onerror?.()}
    })
    return r
   }
   tx.objectStore=()=>({
    get:key=>request('get',key),
    getAll:()=>request('getAll'),
    put:row=>request('put',row),
    add:row=>request('add',row),
    delete:key=>request('delete',key)
   })
   return tx
  }
 }
 globalThis.indexedDB={
  open(){
   const r={}
   schedule(()=>{r.result=db;r.onupgradeneeded?.();r.onsuccess?.()})
   return r
  }
 }
}

test('offline queue isolates accounts, keeps snapshots and retries failed requests',async()=>{
 installOfflineDb()
 const {enqueueStockSubmission,pendingStockCount,pendingStockSubmissions,synchronizeStockSubmissions,saveStockSnapshot,readStockSnapshot}=await import('../lib/offline-stock.mjs')
 const first=await enqueueStockSubmission({ownerId:'stock-a',kind:'general',lines:[{item_id:'test-item-a',current_stock:0,sufficient_stock:false}]})
 await enqueueStockSubmission({ownerId:'stock-b',kind:'general',lines:[{item_id:'test-item-b',current_stock:8,sufficient_stock:false}]})
 assert.equal(await pendingStockCount('stock-a'),1)
 assert.equal(await pendingStockCount('stock-b'),1)
 await saveStockSnapshot('stock-a','catalogue',[{item_id:'test-item-a'}])
 assert.equal((await readStockSnapshot('stock-a','catalogue')).value[0].item_id,'test-item-a')
 assert.equal(await readStockSnapshot('stock-b','catalogue'),null)

 const failed=await synchronizeStockSubmissions('stock-a',{rpc:async()=>{throw new Error('Connection lost')}})
 assert.match(failed.error,/Connection lost/)
 assert.equal(await pendingStockCount('stock-a'),1)

 const ok=await synchronizeStockSubmissions('stock-a',{rpc:async(_,payload)=>({data:{count_id:'confirmed',operation_id:payload.p_operation_id},error:null})})
 assert.equal(ok.completed,1)
 assert.equal(ok.receipts[first.id].count_id,'confirmed')
 assert.equal((await pendingStockSubmissions('stock-a')).length,0)
 assert.equal(await pendingStockCount('stock-b'),1)
 delete globalThis.indexedDB
})
