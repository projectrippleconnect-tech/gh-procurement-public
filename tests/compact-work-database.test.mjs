import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {bootstrapProcurementSchema} from '../scripts/qa/schema-bootstrap.mjs'
import {purchasingCase} from '../lib/work-cases.mjs'

test('Work pagination, counts, permissions and lazy summaries agree with connected-case actions',async()=>{
 const db=new PGlite({extensions:{pgcrypto}})
 try{
  await bootstrapProcurementSchema(db)
  const one=async(sql,args=[])=> (await db.query(sql,args)).rows[0]
  const item=await one("insert into public.proc_items(item_code,category,description,uom) values('COMPACT-QA','QA','Compact work item','pcs') returning id")
  const inserted=await db.query("insert into public.proc_requirements(requirement_no,item_id,location_id,required_qty,adjusted_qty,approval_status) select 'CW-'||n,$1,'00000000-0000-4000-8000-000000000099',20,20,'pending_review' from generate_series(1,53) n returning id",[item.id])
  const req=inserted.rows[0]
  await db.query("update public.proc_requirements set approval_status='approved',ordered_qty=12,received_qty=8,status='partially_received' where id=$1",[req.id])
  const supplier=await one("insert into public.proc_suppliers(supplier_code,name) values('CW-QA','Compact QA') returning id")
  const po=await one("insert into public.proc_purchase_orders(po_no,supplier_id,status) values('CW-QA',$1,'partially_received') returning id",[supplier.id])
  await db.query('insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price) values($1,$2,$3,12,10)',[po.id,req.id,item.id])
  const call=async(tab='Needs me',page=0,views=['requirements','rfq','po','receiving'],scope='all')=>(await one('select public.proc_work_page_v1($1,$2,$3,$4) as data',[scope,tab,page,views])).data
  // Actual authenticated execution retains table policies, rather than testing only ACL declarations.
  await db.exec('set role authenticated')
  const first=await call(),second=await call('Needs me',1),third=await call('Needs me',2)
  assert.equal(first.counts['Needs me'],53)
  assert.equal(first.rows.length,25);assert.equal(second.rows.length,25);assert.equal(third.rows.length,3)
  assert.equal(new Set([...first.rows,...second.rows,...third.rows].map(r=>r.id)).size,53)
  for(const row of [...first.rows,...second.rows,...third.rows]){
   assert.equal('receipts' in row.proc_work_documents,false,'receipt history is fetched only when a record is opened')
   assert.equal(purchasingCase(row,{can:()=>true,canNavigate:()=>true}).tab,'Needs me')
  }
  const partial=[...first.rows,...second.rows,...third.rows].find(r=>r.id===req.id)
  assert.equal(purchasingCase(partial,{can:()=>true,canNavigate:()=>true}).stillReceive,4,'canonical requirement receipts keep balances accurate without exposing receipt detail')
  const waiting=await call('In progress',0,[])
  assert.equal(waiting.counts['Needs me'],0);assert.equal(waiting.counts['In progress'],53)
  assert.equal((await call('Needs me',0,undefined,'company')).rows.length,0)
  await assert.rejects(call('bad-view'),/Invalid work filters/)
  await assert.rejects(call('Needs me',-1),/Invalid work filters/)
  await db.exec('reset role')
  await db.query("update public.proc_requirements set status='closed' where id=$1",[inserted.rows[1].id])
  await db.exec('set role authenticated')
  const history=await call('History')
  assert.equal(history.counts.History,1);assert.equal(history.rows.length,1)
  assert.equal(history.rows[0].id,inserted.rows[1].id)
  assert.equal(purchasingCase(history.rows[0]).tab,'History')
  await db.exec('reset role')
  const acl=await one("select prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anonymous from pg_proc where proname='proc_work_page_v1'")
  assert.equal(acl.prosecdef,false);assert.equal(acl.anonymous,false)
  await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000999',false)")
  await assert.rejects(call(),/Requirement access required/)
  await db.exec("select set_config('request.jwt.claim.sub','',false)")
  await assert.rejects(call(),/Authentication required/)
 }finally{await db.close()}
})
