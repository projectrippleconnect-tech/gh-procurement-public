// Opt-in continuation of the disposable native runner. Never uses hosted credentials.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {nativeQaConfig} from './native-guard.mjs'

const config=nativeQaConfig(),clients=[],results=[]
let owner,jobId
async function connect(){const c=new pg.Client(config);await c.connect();clients.push(c);return c}
const value=async(c,sql,args=[]) => (await c.query(sql,args)).rows[0]?.v
async function clearClaims(c){await c.query("select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)")}
async function check(name,fn){const start=Date.now();await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS '+name)}
async function until(fn,message){const end=Date.now()+20000;while(Date.now()<end){if(await fn())return;await delay(100)}throw Error(message)}
async function fixture(available=10){const f=await value(owner,'select private.qa_portal_fixture(1000000,$1) v',[available]);await clearClaims(owner);await owner.query("update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '7 hours',closes_at=clock_timestamp()-interval '1 hour' where id=$1",[f.round]);return f}
try{
 owner=await connect()
 const marker=await value(owner,"select to_regprocedure('private.qa_portal_fixture(numeric,numeric)') is not null and exists(select 1 from public.proc_locations where code='QA' and name='Isolated QA location') v")
 assert.ok(marker,'Run the isolated native bootstrap/concurrency suite first')
 assert.equal(await value(owner,'select rolsuper v from pg_roles where rolname=current_user'),true,'Use the disposable cluster owner')
 await clearClaims(owner)
 // Isolate these cases from earlier synthetic due rounds, without deleting records.
 await owner.query("update public.proc_portal_rounds set closes_at=clock_timestamp()+interval '2 days' where state='open'")
 const a=await connect(),b=await connect()
 await check('overlapping scheduler tick returns busy without waiting or purchasing',async()=>{
  await a.query('begin');await a.query('select pg_advisory_xact_lock(74121,2)')
  try{assert.equal((await value(b,'select private.proc_portal_run_due_rounds_v1() v')).status,'busy')}
  finally{await a.query('rollback')}
 })
 await check('scheduler and service worker share one allocation after a real lock wait',async()=>{
  const f=await fixture(4)
  await owner.query('update private.proc_portal_scheduler_control set enabled=true where singleton')
  await a.query('begin');const tick=await value(a,'select private.proc_portal_run_due_rounds_v1() v')
  assert.equal(tick.rounds.find(r=>r.round_id===f.round)?.status,'completed')
  await b.query('begin');await b.query("set local role service_role; select set_config('request.jwt.claim.role','service_role',true)")
  const pending=value(b,'select public.proc_portal_process_round_v1($1) v',[f.round]).then(value=>({value}),error=>({error}))
  try{
   await until(()=>value(owner,"select wait_event_type='Lock' v from pg_stat_activity where pid=$1",[b.processID]),'Worker did not block behind the scheduler')
   await a.query('commit');const reply=await pending;assert.ifError(reply.error);assert.equal(reply.value.status,'completed');await b.query('commit')
  }finally{await a.query('rollback');await b.query('rollback')}
  assert.equal(await value(owner,'select count(*)::int v from public.proc_portal_po_jobs where round_id=$1',[f.round]),1)
  assert.equal(Number(await value(owner,'select ordered_qty v from public.proc_requirements where id=$1',[f.requirement])),4)
  assert.equal(await value(owner,"select count(*)::int v from public.proc_portal_rounds where id=(select (result->>'next_round_id')::uuid from public.proc_portal_rounds where id=$1) and closes_at-opens_at=interval '24 hours'",[f.round]),1)
 })
 await owner.query('update private.proc_portal_scheduler_control set enabled=false where singleton')
 await owner.query('create extension pg_cron')
 await owner.query(fs.readFileSync('scripts/portal-database-schedule.sql','utf8'))
 jobId=await value(owner,"select jobid v from cron.job where jobname='gh-procurement-portal-rounds-v1'")
 await check('operator script creates one inactive owner job and refuses replacement',async()=>{
  assert.equal(await value(owner,'select not active and username=current_user v from cron.job where jobid=$1',[jobId]),true)
  await assert.rejects(owner.query(fs.readFileSync('scripts/portal-database-schedule.sql','utf8')),/Scheduler already exists/)
  await owner.query('rollback')
  assert.equal(await value(owner,"select count(*)::int v from cron.job where jobname='gh-procurement-portal-rounds-v1'"),1)
 })
 await check('real pg_cron owner session respects disabled control then processes a due round',async()=>{
  const f=await fixture()
  await owner.query("select cron.alter_job($1,schedule:='1 second',active:=true)",[jobId])
  await until(()=>value(owner,"select exists(select 1 from cron.job_run_details where jobid=$1 and status='succeeded') v",[jobId]),'Cron did not execute successfully')
  assert.equal(await value(owner,'select state v from public.proc_portal_rounds where id=$1',[f.round]),'open')
  assert.equal(await value(owner,'select count(*)::int v from public.proc_portal_po_jobs where round_id=$1',[f.round]),0)
  await owner.query('update private.proc_portal_scheduler_control set enabled=true where singleton')
  await until(async()=>await value(owner,'select state v from public.proc_portal_rounds where id=$1',[f.round])==='completed','Cron did not process the due round')
  assert.equal(await value(owner,'select count(*)::int v from public.proc_portal_po_jobs where round_id=$1',[f.round]),1)
  assert.equal(await value(owner,"select count(*)::int v from public.proc_portal_po_jobs where round_id=$1 and (approved_at is not null or status<>'pending_approval')",[f.round]),0)
  assert.equal(await value(owner,"select count(*)::int v from public.proc_portal_round_audit where round_id=$1 and kind='exception'",[f.round]),0)
 })
 await check('database control and cron stop switch leave a new due round untouched',async()=>{
  await owner.query('begin');await owner.query('update private.proc_portal_scheduler_control set enabled=false where singleton');await owner.query('select cron.alter_job($1,active:=false)',[jobId]);await owner.query('commit')
  const f=await fixture();await delay(2200)
  assert.equal((await value(owner,'select private.proc_portal_run_due_rounds_v1() v')).status,'disabled')
  assert.equal(await value(owner,'select state v from public.proc_portal_rounds where id=$1',[f.round]),'open')
  assert.equal(await value(owner,'select count(*)::int v from public.proc_portal_po_jobs where round_id=$1',[f.round]),0)
  assert.equal(await value(owner,'select active v from cron.job where jobid=$1',[jobId]),false)
 })
 console.log('Native scheduler and real pg_cron checks passed; no hosted database or gateway contacted.')
}catch(error){results.push({status:'failed',error:error.message});process.exitCode=1;console.error(error)}
finally{
 if(owner){await owner.query('rollback').catch(()=>{});await owner.query('update private.proc_portal_scheduler_control set enabled=false where singleton').catch(()=>{});if(jobId)await owner.query('select cron.alter_job($1,active:=false)',[jobId]).catch(()=>{})}
 await Promise.allSettled(clients.map(c=>c.end()))
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/portal-native-scheduler.json',JSON.stringify({engine:'native PostgreSQL with pg_cron',results},null,2))
}
