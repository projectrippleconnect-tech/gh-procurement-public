import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
function worker({valid=true,admin=true,claims=[],subscriptions=[],failure=0}={}){
 let handler;const calls=[],sent=[]
 const config={worker_secret:'fixture-private-worker',vapid_public:'fixture-public',vapid_private:'fixture-private'}
 function from(table){const filters={};const query={select(){return query},eq(k,v){filters[k]=v;return query},update(value){calls.push({table,update:value});return query},delete(){calls.push({table,deleted:true});return query},single(){return query},then(ok,bad){let data=table==='proc_push_config'?config:table==='proc_profiles'?{role:admin?'admin':'receiver',active:true,role_key:admin?'admin':'receiver',deleted_at:null}:table==='proc_roles'?{enabled:true}:table==='proc_push_subscriptions'?subscriptions.filter(s=>s.user_id===filters.user_id&&s.endpoint===filters.endpoint):[];return Promise.resolve({data,error:null}).then(ok,bad)}};return query}
 const db={from,auth:{getUser:async()=>({data:{user:valid?{id:'admin-fixture'}:null},error:null})},rpc:async(name,args)=>{calls.push({rpc:name,args});return {data:claims,error:null}}}
 const webpush={setVapidDetails(){},sendNotification:async(sub,payload)=>{sent.push({sub,payload:JSON.parse(payload)});if(failure)throw {statusCode:failure}}}
 const source=fs.readFileSync('supabase/functions/proc-admin-push/index.ts','utf8').replace(/^import .*\n/gm,'')
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,{createClient:()=>db,webpush,Deno:{env:{get:()=>''},serve:fn=>handler=fn},Response,URL,Date})
 const request=(body,secret=false)=>handler(new Request('https://fixture.invalid',{method:'POST',headers:secret?{'x-worker-secret':config.worker_secret}:{authorization:'Bearer fixture'},body:JSON.stringify(body)}))
 return {request,calls,sent}
}
test('push worker rejects unauthenticated and non-admin device commands',async()=>{
 assert.equal((await worker({valid:false}).request({action:'key'})).status,401)
 assert.equal((await worker({admin:false}).request({action:'key'})).status,403)
})
test('phone test targets only the requested device belonging to that admin',async()=>{
 const w=worker({subscriptions:[{user_id:'admin-fixture',endpoint:'https://fcm.googleapis.com/current',subscription:{endpoint:'https://fcm.googleapis.com/current'}},{user_id:'admin-fixture',endpoint:'https://fcm.googleapis.com/other',subscription:{}},{user_id:'another-user',endpoint:'https://fcm.googleapis.com/current',subscription:{}}]})
 assert.equal((await w.request({action:'test'})).status,400)
 const response=await w.request({action:'test',endpoint:'https://fcm.googleapis.com/current'})
 assert.equal((await response.json()).accepted,1);assert.equal(w.sent.length,1)
})
test('worker sends claimed events with stable identifiers and records acceptance',async()=>{
 const w=worker({claims:[{notification_id:'note',subscription_id:'phone',subscription:{endpoint:'https://fcm.googleapis.com/fixture'},title:'Supplier prices returned',body:'RFQ-QA',event_key:'prices:qa',attempt:1}]})
 assert.deepEqual(await (await w.request({},true)).json(),{sent:1,failed:0})
 assert.equal(w.calls[0].rpc,'proc_push_claim_v1');assert.equal(w.sent[0].payload.tag,'prices:qa');assert.equal(w.sent[0].payload.url,'/?notification=note')
 assert.ok(w.calls.some(x=>x.update?.sent_at))
})
test('expired devices are removed and retry failures retain backoff without marking sent',async()=>{
 const claim={notification_id:'note',subscription_id:'phone',subscription:{endpoint:'https://fcm.googleapis.com/fixture'},title:'QA',body:'QA',event_key:'qa',attempt:2}
 const expired=worker({claims:[claim],failure:410});await expired.request({},true);assert.ok(expired.calls.some(x=>x.table==='proc_push_subscriptions'&&x.deleted))
 const retry=worker({claims:[claim],failure:503});await retry.request({},true);assert.ok(retry.calls.some(x=>x.update?.next_attempt_at));assert.equal(retry.calls.some(x=>x.update?.sent_at),false)
 const invalid=worker({claims:[{...claim,subscription:{endpoint:'https://evil.invalid/secret'}}]});await invalid.request({},true);assert.equal(invalid.sent.length,0)
})

test('Android admin push preflight allows the full Supabase browser header set without broadening origin',async()=>{
 const source=fs.readFileSync('supabase/functions/proc-admin-push/index.ts','utf8')
 const origin=source.match(/'Access-Control-Allow-Origin':'([^']+)'/)?.[1]
 const allow=source.match(/'Access-Control-Allow-Headers':'([^']+)'/)?.[1]?.split(',').map(x=>x.trim())
 const methods=source.match(/'Access-Control-Allow-Methods':'([^']+)'/)?.[1]?.split(',').map(x=>x.trim())
 assert.equal(origin,'https://gh-procurement.netlify.app')
 for(const header of ['authorization','x-client-info','apikey','content-type','x-retry-count','traceparent','tracestate','baggage'])assert.ok(allow?.includes(header),'Missing browser header: '+header)
 assert.deepEqual(methods,['POST','OPTIONS'])
 const w=worker()
 const response=await w.request({action:'key'})
 assert.equal(response.status,200)
 assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin)
 assert.ok(response.headers.get('Access-Control-Allow-Headers')?.includes('x-client-info'))
})
