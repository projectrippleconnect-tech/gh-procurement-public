// Never uses application credentials, production DATABASE_URL, or the WhatsApp gateway.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {nativeQaConfig,assertEmptyNativeDatabase} from './native-guard.mjs'
import {bootstrapProcurementSchema} from './schema-bootstrap.mjs'
import {runDatabaseRegression} from './database-regression.mjs'
const config=nativeQaConfig(),clients=[],results=[]
async function connect(){const c=new pg.Client(config);await c.connect();clients.push(c);return c}
const adminId='00000000-0000-4000-8000-000000000111'
async function begin(c,role='service_role'){
 await c.query('BEGIN')
 await c.query(`select set_config('request.jwt.claim.role',$1,true),set_config('request.jwt.claim.sub',$2,true)`,[role,role==='authenticated'?adminId:''])
 await c.query('SET LOCAL ROLE '+role) // constants above, never user input
}
async function value(c,sql,args=[]){return (await c.query(sql,args)).rows[0].v}
const settled=p=>p.then(value=>({value}),error=>({error}))
async function blocked(observer,c){
 const deadline=Date.now()+5000
 while(Date.now()<deadline){
  const waiting=await value(observer,"select wait_event_type='Lock' v from pg_stat_activity where pid=$1",[c.processID])
  if(waiting)return
  await delay(20)
 }
 throw Error('Concurrent operation did not reach the expected PostgreSQL lock')
}
async function check(name,fn){const start=Date.now();await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS '+name)}
try{
 const owner=await connect()
 await assertEmptyNativeDatabase(owner)
 const adapter={exec:async sql=>{const r=await owner.query(sql);return Array.isArray(r)?r:[r]},query:(sql,args)=>owner.query(sql,args)}
 const {snapshot,meta,patches}=await bootstrapProcurementSchema(adapter)
 const regression=await runDatabaseRegression(adapter,snapshot)
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/native-full-database.json',JSON.stringify({engine:'native PostgreSQL',baseline:meta.source_commit,patches,results:regression},null,2))
 assert.equal(regression.filter(r=>r.status!=='passed').length,0,'Native existing-feature regression failed')
 await owner.query(fs.readFileSync('tests/fixtures/supplier-portal-native.sql','utf8'))
 const a=await connect(),b=await connect()
 async function fixture(budget=1000000){return value(owner,'select private.qa_portal_fixture($1) v',[budget])}
 async function due(f){await owner.query("update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '7 hours',closes_at=clock_timestamp()-interval '1 hour' where id=$1",[f.round])}
 const process=(c,f)=>value(c,'select public.proc_portal_process_round_v1($1) v',[f.round])
 await check('two supplier saves at one revision preserve one winner',async()=>{
  const f=await fixture();await begin(a,'anon');await begin(b,'anon')
  await value(a,'select public.proc_portal_submit_v1($1,$2,1,false) v',[f.token,JSON.stringify(f.payload)])
  const loser=settled(value(b,'select public.proc_portal_submit_v1($1,$2,1,false) v',[f.token,JSON.stringify(f.payload)]))
  await blocked(owner,b);await a.query('COMMIT')
  assert.equal((await loser).error?.code,'PT409');await b.query('ROLLBACK')
  assert.equal(await value(owner,'select revision v from public.proc_supplier_portal_links where token_hash=encode(extensions.digest($1,\'sha256\'),\'hex\')',[f.token]),2)
 })
 await check('a submit waiting on the RFQ rechecks the deadline after the lock',async()=>{
  const f=await fixture();await a.query('BEGIN');await a.query('select 1 from public.proc_rfqs where id=$1 for update',[f.rfq])
  await a.query("update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '6 hours',closes_at=clock_timestamp()+interval '2 seconds' where id=$1",[f.round])
  await a.query("update public.proc_supplier_portal_links set closes_at=clock_timestamp()+interval '2 seconds' where rfq_supplier_id in(select id from public.proc_rfq_suppliers where rfq_id=$1)",[f.rfq])
  await begin(b,'anon')
  const late=settled(value(b,'select public.proc_portal_submit_v1($1,$2,1,true) v',[f.token,JSON.stringify(f.payload)]))
  await blocked(owner,b)
  await a.query('select pg_sleep(greatest(extract(epoch from closes_at-clock_timestamp()),0)::double precision+0.05) from public.proc_portal_rounds where id=$1',[f.round])
  await a.query('COMMIT');assert.match((await late).error?.message||'',/Quotation window is closed/);await b.query('ROLLBACK')
 })
 await check('two workers return one persisted round result and one PO',async()=>{
  const f=await fixture();await due(f);await begin(a);await begin(b)
  const first=await process(a,f),second=settled(process(b,f))
  await blocked(owner,b);await a.query('COMMIT')
  const reply=await second;assert.ifError(reply.error);assert.deepEqual(reply.value,first);await b.query('COMMIT')
  assert.equal(await value(owner,'select count(*)::int v from public.proc_portal_po_jobs where round_id=$1',[f.round]),1)
  assert.equal(await value(owner,'select count(*)::int v from public.proc_awards where rfq_item_id=$1',[f.item]),1)
 })
 await check('manual requirement reservation commits before automatic allocation',async()=>{
  const f=await fixture();await due(f)
  await a.query('BEGIN');await a.query("select set_config('request.jwt.claim.sub',$1,true)",[adminId])
  await a.query("update public.proc_requirements set ordered_qty=7,status='partially_ordered' where id=$1",[f.requirement])
  await begin(b);const auto=settled(process(b,f));await blocked(owner,b);await a.query('COMMIT')
  const reply=await auto;assert.ifError(reply.error);assert.equal(Number(reply.value.allocations[0].qty),3);await b.query('COMMIT')
  assert.equal(Number(await value(owner,'select ordered_qty v from public.proc_requirements where id=$1',[f.requirement])),10)
 })
 await check('manual award finalization and automatic ordering have one winner',async()=>{
  for(const manualFirst of [true,false]){
   const f=await fixture();await due(f)
   const q=await value(owner,'select id v from public.proc_quote_lines where rfq_item_id=$1',[f.item])
   const plan=JSON.stringify([{rfq_item_id:f.item,quote_line_id:q,qty:10}])
   const manual=c=>value(c,'select public.proc_finalize_award_plan_v2($1,$2) v',[f.rfq,plan])
   await begin(a,manualFirst?'authenticated':'service_role');await begin(b,manualFirst?'service_role':'authenticated')
   await (manualFirst?manual(a):process(a,f));const loser=settled(manualFirst?process(b,f):manual(b))
   await blocked(owner,b);await a.query('COMMIT');assert.ok((await loser).error,'Both ordering paths finalized the same RFQ');await b.query('ROLLBACK')
   assert.equal(await value(owner,'select count(distinct po_id)::int v from public.proc_po_lines where requirement_id=$1',[f.requirement]),1)
   assert.equal(Number(await value(owner,'select ordered_qty v from public.proc_requirements where id=$1',[f.requirement])),10)
  }
 })
 await check('two RFQs cannot concurrently overspend one daily budget',async()=>{
  const spent=Number(await value(owner,"select coalesce(sum(total),0) v from public.proc_purchase_orders where status<>'cancelled' and po_date=(clock_timestamp() at time zone 'Asia/Colombo')::date"))
  const f=await fixture(spent+500),g=await fixture(spent+500);await due(f);await due(g);await begin(a);await begin(b)
  await process(a,f);const loser=settled(process(b,g));await blocked(owner,b);await a.query('COMMIT')
  assert.match((await loser).error?.message||'',/Purchasing limit exceeded/);await b.query('ROLLBACK')
  assert.equal(await value(owner,'select count(*)::int v from public.proc_portal_po_jobs where round_id=$1',[g.round]),0)
  assert.equal(Number(await value(owner,'select ordered_qty v from public.proc_requirements where id=$1',[g.requirement])),0)
 })
 await check('dispatch SKIP LOCKED gives one claim and never a second send',async()=>{
  const f=await fixture();await due(f);await begin(a);await process(a,f);await a.query('COMMIT')
  const pid=await value(owner,'select po_id v from public.proc_portal_po_jobs where round_id=$1',[f.round])
  await begin(a,'authenticated');await a.query('select public.proc_approve_po_v2($1)',[pid]);await a.query('select public.proc_portal_allow_dispatch_v1($1)',[pid]);await a.query('COMMIT')
  await begin(a);await begin(b)
  const claim=await value(a,'select public.proc_portal_claim_dispatch_v1() v');assert.ok(claim?.job_id)
  assert.equal(await value(b,'select public.proc_portal_claim_dispatch_v1() v'),null)
  await b.query('COMMIT');await a.query('COMMIT')
  await begin(b);assert.equal(await value(b,'select public.proc_portal_claim_dispatch_v1() v'),null);await b.query('COMMIT')
 })
 await check('changed recipient blocks an approved dispatch without reserving a send',async()=>{
  const f=await fixture();await due(f);await begin(a);await process(a,f);await a.query('COMMIT')
  const pid=await value(owner,'select po_id v from public.proc_portal_po_jobs where round_id=$1',[f.round])
  await begin(a,'authenticated');await a.query('select public.proc_approve_po_v2($1)',[pid]);await a.query('select public.proc_portal_allow_dispatch_v1($1)',[pid]);await a.query('COMMIT')
  await owner.query("select set_config('request.jwt.claim.sub',$1,false)",[adminId])
  await owner.query("update public.proc_suppliers set whatsapp='0771234568' where id=(select supplier_id from public.proc_purchase_orders where id=$1)",[pid])
  await begin(b);const claim=await value(b,'select public.proc_portal_claim_dispatch_v1() v');assert.ok(claim?.blocked);await b.query('COMMIT')
  assert.equal(await value(owner,'select count(*)::int v from public.proc_whatsapp_po_dispatches where po_id=$1',[pid]),0)
 })
 console.log('Native concurrent PostgreSQL checks passed. No gateway was contacted.')
}catch(e){results.push({status:'failed',error:e.message});process.exitCode=1;console.error(e.message)}
finally{
 await Promise.allSettled(clients.map(c=>c.end()))
 fs.mkdirSync('test-results',{recursive:true})
 fs.writeFileSync('test-results/portal-native-concurrency.json',JSON.stringify({engine:'native PostgreSQL',results},null,2))
}
