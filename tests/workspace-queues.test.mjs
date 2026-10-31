import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {bootstrapProcurementSchema} from '../scripts/qa/schema-bootstrap.mjs'
test('computed case links retain multiple live RFQs and distinguish unsent reservations',async()=>{
 const db=new PGlite({extensions:{pgcrypto}})
 try{
  await bootstrapProcurementSchema(db)
  const one=async(sql,params=[])=> (await db.query(sql,params)).rows[0]
  const item=await one("insert into public.proc_items(item_code,category,description,uom) values('CASE-QA','QA','Case QA','pcs') returning id")
  const supplier=await one("insert into public.proc_suppliers(supplier_code,name) values('CASE-QA','Case QA') returning id")
  const req=await one("insert into public.proc_requirements(requirement_no,item_id,location_id,required_qty,adjusted_qty,ordered_qty,received_qty,approval_status) values('CASE-QA',$1,'00000000-0000-4000-8000-000000000099',20,20,12,8,'approved') returning id",[item.id])
  const rfqIds=[]
  for(const number of ['OLDER-QA','NEWER-QA']){
   const q=await one("insert into public.proc_rfqs(rfq_no,status) values($1,$2) returning id",[number,number==='OLDER-QA'?'prepared':'sent'])
   rfqIds.push(q.id)
   await db.query('insert into public.proc_rfq_items(rfq_id,requirement_id,requested_qty) values($1,$2,8)',[q.id,req.id])
  }
  const active=await db.query('select id from public.proc_rfqs q where public.proc_rfq_work_pending(q) order by id')
  assert.deepEqual(active.rows.map(r=>r.id),rfqIds.sort())
  const po=await one("insert into public.proc_purchase_orders(po_no,supplier_id,status) values('CASE-QA',$1,'pending_approval') returning id",[supplier.id])
  await db.query('insert into public.proc_po_lines(po_id,requirement_id,item_id,qty,unit_price) values($1,$2,$3,12,10)',[po.id,req.id,item.id])
  const row=await one('select remaining_to_order,public.proc_work_documents(r) as documents from public.proc_v_requirements r where id=$1',[req.id])
  assert.equal(Number(row.remaining_to_order),8)
  assert.equal(row.documents.rfqs.length,2)
  assert.equal(row.documents.orders[0].status,'pending_approval')
  const acl=await one("select prosecdef,has_function_privilege('anon',oid,'EXECUTE') as anonymous from pg_proc where proname='proc_work_documents'")
  assert.equal(acl.prosecdef,false);assert.equal(acl.anonymous,false)
 }finally{await db.close()}
})
