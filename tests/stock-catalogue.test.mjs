import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadStockCatalogue,isTransientStockQueryError,STOCK_CATALOGUE_PAGE_SIZE} from '../lib/stock-catalogue.mjs'

test('catalogue loads in bounded pages, without missing held-search items',async()=>{
 const pages=[],progress=[]
 const source=Array.from({length:601},(_,n)=>({id:String(n)}))
 const rows=await loadStockCatalogue({
  pageSize:250,
  fetchPage:async(start,end)=>{pages.push([start,end]);return source.slice(start,end+1)},
  onPage:items=>progress.push(items.length)
 })
 assert.equal(STOCK_CATALOGUE_PAGE_SIZE,250)
 assert.deepEqual(pages,[[0,249],[250,499],[500,749]])
 assert.deepEqual(progress,[250,500,601])
 assert.equal(rows.length,601)
 assert.equal(new Set(rows.map(x=>x.id)).size,601)
})

test('timeout retries only the failing page and preserves previous pages',async()=>{
 let call=0
 const waited=[]
 const ids=Array.from({length:5},(_,id)=>({id}))
 const result=await loadStockCatalogue({
  pageSize:3,
  fetchPage:async(start,end)=>{
   call++
   if(start===3&&call===2)throw {code:'57014',message:'canceling statement due to statement timeout'}
   return ids.slice(start,end+1)
  },
  wait:async ms=>waited.push(ms)
 })
 assert.equal(call,3)
 assert.deepEqual(waited,[200])
 assert.deepEqual(result,ids)
 assert.equal(isTransientStockQueryError({code:'57014'}),true)
})

test('persistent timeout does not pretend the incomplete catalogue is complete',async()=>{
 let calls=0
 await assert.rejects(()=>loadStockCatalogue({
  pageSize:2,maxRetries:2,wait:async()=>{},
  fetchPage:async(start)=>{
   calls++
   if(start===2)throw {code:'57014',message:'statement timeout'}
   return [{id:0},{id:1}]
  }
 }),{code:'57014'})
 assert.equal(calls,4)
})

test('permissions errors are never retried and aborted loads stop fetching',async()=>{
 let calls=0
 await assert.rejects(()=>loadStockCatalogue({
  fetchPage:async()=>{calls++;throw {code:'42501',message:'permission denied'}},
  wait:async()=>{}
 }),{code:'42501'})
 assert.equal(calls,1)
 const controller=new AbortController()
 let pages=0
 const result=await loadStockCatalogue({
  pageSize:1,signal:controller.signal,
  fetchPage:async()=>{pages++;controller.abort();return [{id:pages}]}
 })
 assert.equal(result,null)
 assert.equal(pages,1)
})

test('catalogue read policies cache permission checks without changing allowed permissions',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261014090000_stock_search_permission_policy_performance.sql',import.meta.url),'utf8')
 for(const table of ['proc_items','proc_stock_balances'])
  for(const name of ['proc_read','proc_permission_read'])
   assert.match(migration,new RegExp('alter policy '+name+' on public\\.'+table))
 assert.equal((migration.match(/using \(\(select private\.proc_has_any_permission\(/g)||[]).length,4)
 assert.equal((migration.match(/'stock\.count\.view'/g)||[]).length,4)
 const stock=readFileSync(new URL('../components/modules-stock.jsx',import.meta.url),'utf8')
 assert.match(stock,/\[profile\.id,catalogueRetry\]/)
 assert.match(stock,/loadStockCatalogue\(/)
 assert.match(stock,/setCatalogueReady\(true\)/)
 assert.match(stock,/setCatalogueError\(/)
 assert.match(stock,/const timer=setTimeout\(/)
})
