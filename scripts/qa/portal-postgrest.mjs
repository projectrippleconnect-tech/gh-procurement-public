// Disposable loopback QA only: real SDK -> HTTP -> PostgREST -> native PostgreSQL.
// Gateway endpoints below are a local simulator; no supplier message can leave this test.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import {createHmac,randomUUID} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import sharp from 'sharp'
import {createClient} from '@supabase/supabase-js'
import {nativeQaConfig} from './native-guard.mjs'
import {runPortalWorker} from '../../lib/supplier-portal-worker.mjs'
import {portalBrowserDatabase} from './portal-browser-database.mjs'
const config=nativeQaConfig(),owner=new pg.Client(config),results=[]
const adminId='00000000-0000-4000-8000-000000000111'
const secret='gh-portal-isolated-postgrest-test-secret-20261022'
const origin=process.env.GH_PORTAL_QA_POSTGREST_ORIGIN||'http://127.0.0.1:55301'
const u=new URL(origin)
assert.ok(['127.0.0.1','localhost','[::1]'].includes(u.hostname)&&u.protocol==='http:'&&u.pathname==='/'&&!u.username&&!u.password&&!u.search&&!u.hash,'PostgREST must be a plain loopback HTTP origin')
function jwt(role,sub){const part=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const unsigned=part({alg:'HS256',typ:'JWT'})+'.'+part({role,sub,exp:Math.floor(Date.now()/1000)+3600});return unsigned+'.'+createHmac('sha256',secret).update(unsigned).digest('base64url')}
async function value(sql,args=[]){return (await owner.query(sql,args)).rows[0].v}
async function rpc(client,name,args={}){const r=await client.rpc(name,args);if(r.error)throw Error(name+': '+r.error.message,{cause:r.error});return r.data}
async function check(name,fn){const start=Date.now();await fn();results.push({name,status:'passed',ms:Date.now()-start});console.log('PASS '+name)}
let sends=0,lastImage,gatewayMode='accepted',server
try{
 await owner.connect()
 await owner.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[adminId])
 assert.equal(await value("select exists(select 1 from auth.users where id=$1 and email='qa-admin@example.invalid') and to_regprocedure('private.qa_portal_fixture(numeric,numeric)') is not null v",[adminId]),true,'Disposable QA schema marker missing')
 if(!await value("select exists(select 1 from pg_roles where rolname='qa_authenticator') v"))await owner.query("CREATE ROLE qa_authenticator NOINHERIT LOGIN PASSWORD 'qa-local-only-20261022';GRANT anon,authenticated,service_role TO qa_authenticator")
 let ready=false
 for(let i=0;i<60;i++){try{const r=await fetch(origin);if(r.ok){ready=true;break}}catch{}await delay(250)}
 assert.ok(ready,'Local PostgREST not ready')
 server=http.createServer(async(req,res)=>{
  try{
   const bytes=[];for await(const chunk of req)bytes.push(chunk);const body=Buffer.concat(bytes)
   if(req.url.startsWith('/rest/v1/')){
    const headers={'Content-Type':req.headers['content-type']||'application/json'}
    if(req.headers.authorization)headers.Authorization=req.headers.authorization
    if(req.headers.prefer)headers.Prefer=req.headers.prefer
    const r=await fetch(origin+req.url.replace(/^\/rest\/v1/,''),{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:body,signal:AbortSignal.timeout(20000)})
    res.writeHead(r.status,{'Content-Type':r.headers.get('content-type')||'application/json'});res.end(Buffer.from(await r.arrayBuffer()));return
   }
   if(req.headers['x-api-key']!=='qa-gateway-only'){res.writeHead(401);res.end('{}');return}
   res.setHeader('Content-Type','application/json')
   if(req.url==='/api/sessions/default'){res.end(JSON.stringify({status:'WORKING'}));return}
   if(req.url==='/api/sendImage'){
    sends++;lastImage=JSON.parse(body.toString());assert.equal(lastImage.file.mimetype,'image/png');assert.equal(Buffer.from(lastImage.file.data,'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a')
    if(gatewayMode==='unknown'){res.writeHead(503);res.end('{}');return}
    res.end(JSON.stringify({id:{_serialized:'qa-message-'+sends}}));return
   }
   res.writeHead(404);res.end('{}')
  }catch(e){res.writeHead(500);res.end(JSON.stringify({error:e.message}))}
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port
 const client=(role,sub)=>createClient(base,jwt(role,sub),{db:{timeout:20000,retry:false},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})}})
 const anon=client('anon'),staff=client('authenticated',adminId),service=client('service_role')
 const fixture=await value('select private.qa_portal_fixture(1000000,6) v')
 let revision=1
 await check('real anonymous RPC grants and invalid-token rejection',async()=>{
  const data=await rpc(anon,'proc_portal_read_v1',{p_token:fixture.token});assert.equal(data.items.length,1);assert.equal(data.items[0].id,fixture.item)
  const invalid=await anon.rpc('proc_portal_read_v1',{p_token:'f'.repeat(64)});assert.equal(invalid.error?.code,'42501')
  assert.ok((await anon.from('proc_purchase_orders').select('id').limit(1)).error)
  assert.ok((await anon.rpc('proc_portal_due_rounds_v1')).error)
  assert.ok((await client('authenticated',randomUUID()).rpc('proc_portal_start_round_v1',{p_rfq_id:fixture.rfq,p_max_po:10000,p_max_daily:1000000,p_max_unit:1000,p_max_lead:14})).error)
  const bad=await fetch(origin+'/rpc/proc_portal_due_rounds_v1',{method:'POST',headers:{Authorization:'Bearer '+jwt('service_role').slice(0,-3)+'bad','Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,401)
 })
 await check('existing Prices and Company contact conflicts return HTTP 409 without mutation',async()=>{
  const sid=await value('select supplier_id v from public.proc_rfq_suppliers where rfq_id=$1',[fixture.rfq])
  const before=await rpc(staff,'proc_quote_snapshot_v1',{p_rfq_id:fixture.rfq,p_supplier_id:sid})
  const conflict=await staff.rpc('proc_save_quote_guarded_v1',{p_rfq_id:fixture.rfq,p_supplier_id:sid,p_expected_revision:'stale',p_quote_ref:'QA',p_lines:[]})
  assert.equal(conflict.error?.code,'PT409');assert.equal(conflict.status,409)
  assert.deepEqual(await rpc(staff,'proc_quote_snapshot_v1',{p_rfq_id:fixture.rfq,p_supplier_id:sid}),before)
  const cid=randomUUID(),supplier=randomUUID(),contact=randomUUID()
  await owner.query('insert into public.proc_companies(id,company_code,name,created_by) values($1,$2,$3,$4)',[cid,'QA-'+cid,'Isolated HTTP conflict company',adminId])
  await owner.query("insert into public.proc_suppliers(id,supplier_code,name,whatsapp,active,supplier_kind) values($1,$2,$3,'0771234567',true,'company')",[supplier,'QA-'+supplier,'Isolated HTTP company supplier'])
  await owner.query('insert into public.proc_company_contact_directory(id,company_id,supplier_id,display_name) values($1,$2,$3,$4)',[contact,cid,supplier,'Isolated HTTP contact'])
  const stale='2000-01-01T00:00:00Z'
  const edit=await staff.rpc('proc_company_directory_update_contact',{p_id:contact,p_display_name:'Changed',p_phone:'0771234567',p_expected_updated_at:stale})
  const remove=await staff.rpc('proc_company_directory_delete_contact',{p_id:contact,p_expected_updated_at:stale})
  for(const r of [edit,remove]){assert.equal(r.error?.code,'PT409');assert.equal(r.status,409)}
  assert.equal(await value('select display_name v from public.proc_company_contact_directory where id=$1',[contact]),'Isolated HTTP contact')
 })
 let payload=structuredClone(fixture.payload)
 await check('draft withdrawal, photo and variation persist through SDK and PostgREST',async()=>{
  const image='data:image/png;base64,'+(await sharp({create:{width:2,height:2,channels:3,background:'#339966'}}).png().toBuffer()).toString('base64')
  payload[0].image=image;payload[0].variations=[{name:'Alternative size',price:'60',quantity:'2',image}]
  const incomplete=structuredClone(payload);incomplete[0].price=''
  const draft=await rpc(anon,'proc_portal_submit_v1',{p_token:fixture.token,p_response:incomplete,p_expected_revision:revision,p_confirm:false});revision=draft.revision
  assert.equal(await value('select count(*)::int v from public.proc_quote_lines where rfq_item_id=$1',[fixture.item]),0)
  const confirmed=await rpc(anon,'proc_portal_submit_v1',{p_token:fixture.token,p_response:payload,p_expected_revision:revision,p_confirm:true});revision=confirmed.revision
  const reload=await rpc(anon,'proc_portal_read_v1',{p_token:fixture.token});assert.equal(reload.response[0].image,image);assert.equal(reload.response[0].variations[0].image,image)
  assert.equal(await value('select count(*)::int v from public.proc_quote_lines where rfq_item_id=$1',[fixture.item]),1)
 })
 await check('overlapping HTTP confirmations reject one stale revision',async()=>{
  const args={p_token:fixture.token,p_response:payload,p_expected_revision:revision,p_confirm:true}
  const replies=await Promise.all([anon.rpc('proc_portal_submit_v1',args),anon.rpc('proc_portal_submit_v1',args)])
  assert.equal(replies.filter(r=>!r.error).length,1);assert.equal(replies.find(r=>r.error)?.error.code,'PT409');assert.equal(replies.find(r=>r.error)?.status,409);revision++
 })
 const browserPath=process.env.GH_PORTAL_QA_BROWSER_EXECUTABLE||'/tmp/chromium'
 if(fs.existsSync(browserPath))await check('mobile browser saves and conflicting windows use real database responses',async()=>{
  await portalBrowserDatabase({base,fixture,authorization:'Bearer '+jwt('anon'),value,executablePath:browserPath})
 })
 let pid
 await check('real worker RPC creates bounded PO, award and residual round',async()=>{
  await owner.query("update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '7 hours',closes_at=clock_timestamp()-interval '1 hour' where id=$1",[fixture.round])
  const result=await runPortalWorker({env:{GH_PORTAL_PROCESSING_ENABLED:'true'},db:service});assert.ok(result.rounds.some(r=>r.allocations?.some(a=>a.rfq_item_id===fixture.item)),JSON.stringify(result))
  pid=await value('select po_id v from public.proc_portal_po_jobs where round_id=$1',[fixture.round]);assert.ok(pid)
  assert.equal(Number(await value('select ordered_qty v from public.proc_requirements where id=$1',[fixture.requirement])),6)
  assert.equal(await value('select count(*)::int v from public.proc_awards where rfq_item_id=$1',[fixture.item]),1)
  const next=await rpc(anon,'proc_portal_read_v1',{p_token:fixture.token});assert.equal(Number(next.items[0].requested_qty),4);assert.equal(next.status,'draft')
 })
 const dispatchEnv={GH_PORTAL_DISPATCH_ENABLED:'true',GH_PORTAL_DELIVERY_VERIFIED:'true',WAHA_SENDING_ENABLED:'true',WAHA_BASE_URL:base,WAHA_API_KEY:'qa-gateway-only',WAHA_SESSION:'default'}
 await check('approval gates, rendered PNG, one dispatch and verified delivery',async()=>{
  assert.ok((await staff.rpc('proc_portal_allow_dispatch_v1',{p_po_id:pid})).error)
  await runPortalWorker({env:dispatchEnv,db:service});assert.equal(sends,0)
  await rpc(staff,'proc_approve_po_v2',{p_po_id:pid});await rpc(staff,'proc_portal_allow_dispatch_v1',{p_po_id:pid})
  const sent=await runPortalWorker({env:dispatchEnv,db:service});assert.equal(sent.dispatch.status,'accepted');assert.equal(sends,1);assert.ok(lastImage.chatId.endsWith('@c.us'))
  assert.equal(await value('select status v from public.proc_purchase_orders where id=$1',[pid]),'approved')
  await runPortalWorker({env:dispatchEnv,db:service});assert.equal(sends,1)
  await rpc(staff,'proc_portal_confirm_delivery_v1',{p_po_id:pid,p_message_id:'qa-message-1',p_evidence:'Isolated local simulator receipt verified'})
  assert.equal(await value('select status v from public.proc_purchase_orders where id=$1',[pid]),'sent')
 })
 await check('uncertain gateway result stays unknown and is never resent',async()=>{
  const f=await value('select private.qa_portal_fixture() v');await owner.query("update public.proc_portal_rounds set opens_at=clock_timestamp()-interval '7 hours',closes_at=clock_timestamp()-interval '1 hour' where id=$1",[f.round])
  await rpc(service,'proc_portal_process_round_v1',{p_round_id:f.round});const p=await value('select po_id v from public.proc_portal_po_jobs where round_id=$1',[f.round])
  await rpc(staff,'proc_approve_po_v2',{p_po_id:p});await rpc(staff,'proc_portal_allow_dispatch_v1',{p_po_id:p});gatewayMode='unknown'
  const result=await runPortalWorker({env:dispatchEnv,db:service});assert.equal(result.dispatch.status,'unknown');assert.equal(sends,2)
  await runPortalWorker({env:dispatchEnv,db:service});assert.equal(sends,2)
  assert.equal(await value('select status v from public.proc_purchase_orders where id=$1',[p]),'approved')
 })
}catch(e){results.push({status:'failed',error:e.message});process.exitCode=1;console.error(e.message)}
finally{
 server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));await owner.end()
 fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/portal-postgrest.json',JSON.stringify({engine:'native PostgreSQL with PostgREST and @supabase/supabase-js',gateway:'local simulator only',results},null,2))
}
