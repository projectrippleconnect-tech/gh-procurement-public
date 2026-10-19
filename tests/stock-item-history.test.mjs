import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {latestStockMarkers,submissionQuantity,stockSubmissionDate} from '../lib/stock-item-history.mjs'

test('latest submission lookup chunks large catalogues and deduplicates identifiers',async()=>{
 const calls=[]
 const client={rpc:async(name,params)=>{
  assert.equal(name,'proc_stock_latest_item_submissions_v1')
  calls.push(params)
  return {data:params.p_item_ids.map(id=>({item_id:id,count_no:'LATEST-'+id,current_stock:2})),error:null}
 }}
 const ids=Array.from({length:725},(_,n)=>'item-'+n)
 const result=await latestStockMarkers(client,[...ids,'item-3'],null)
 assert.equal(Object.keys(result).length,725)
 assert.equal(calls.length,3)
 assert.deepEqual(calls.map(x=>x.p_item_ids.length),[300,300,125])
 assert.ok(calls.every(x=>x.p_company_id===null))
 assert.equal(result['item-3'].count_no,'LATEST-item-3')
})

test('lookup fails closed when a history request fails',async()=>{
 const client={rpc:async()=>({error:new Error('permission denied'),data:null})}
 await assert.rejects(latestStockMarkers(client,['item-1'],'company-1'),/permission denied/)
})

test('scoped company marker calls preserve company context',async()=>{
 const calls=[]
 const client={rpc:async(_name,options)=>{calls.push(options);return {data:[],error:null}}}
 await latestStockMarkers(client,['a','b'],'company-1')
 assert.equal(calls[0].p_company_id,'company-1')
})

test('history displays physical stock zero and enough-without-exact-count correctly',()=>{
 assert.equal(submissionQuantity({current_stock:0,sufficient_stock:false}),'0')
 assert.equal(submissionQuantity({current_stock:23.5,sufficient_stock:false}),'23.5')
 assert.match(submissionQuantity({current_stock:null,sufficient_stock:true}),/exact quantity not counted/)
 assert.equal(submissionQuantity({current_stock:null,sufficient_stock:false}),'Not recorded')
 assert.equal(stockSubmissionDate('invalid'),'—')
 assert.notEqual(stockSubmissionDate('2026-10-19T01:23:00Z'),'—')
})

test('new history SQL stays read-only, item-scoped, and hides other staff counts',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261019073000_stock_item_submission_timeline.sql',import.meta.url),'utf8')
 assert.match(sql,/CREATE OR REPLACE FUNCTION public.proc_stock_latest_item_submissions_v1/)
 assert.match(sql,/CREATE OR REPLACE FUNCTION public.proc_stock_item_submissions_v1/)
 assert.match(sql,/l\.item_id=p_item_id/)
 assert.match(sql,/c\.status='submitted'/)
 assert.match(sql,/c\.counted_by=auth\.uid\(\)/)
 assert.match(sql,/private\.proc_has_permission\('items\.edit'\)/)
 assert.match(sql,/c\.category='COMPANY: '\|\|company_name/)
 assert.doesNotMatch(sql,/INSERT INTO public\./i)
 assert.doesNotMatch(sql,/UPDATE public\.proc_requirements/i)
})
