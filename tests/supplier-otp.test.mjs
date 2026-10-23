import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {supplierPortalRequest,otpGateway} from '../lib/supplier-otp.mjs'
const token='a'.repeat(64),origin='https://procurement.example'
const env={NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'s'.repeat(40),GH_PORTAL_OTP_SECRET:'p'.repeat(40),GH_PORTAL_OTP_SENDING_ENABLED:'true',WAHA_BASE_URL:'https://gateway.example',GH_WAHA_HTTPS_ORIGIN:'https://gateway.example',WAHA_API_KEY:'private-test-key'}
const request=(body,headers={})=>new Request(origin+'/api/supplier/portal',{method:'POST',headers:{origin,'Content-Type':'application/json',...headers},body:JSON.stringify({token,...body})})
function fixture(){
 const calls=[],sent=[]
 const db={rpc:async(name,args)=>{calls.push({name,args});return {data:name==='proc_portal_otp_request_v1'?{phone:'94771234567',expires_at:'2030-01-01'}:name==='proc_portal_otp_verify_v1'?{expires_at:'2030-01-01'}:name==='proc_portal_session_v1'?{revision:2}:true}}}
 const fetcher=async(url,options)=>{if(options.method==='POST'){sent.push(JSON.parse(options.body));return Response.json({id:'fixture-message'})}return Response.json({status:'WORKING'})}
 return {db,fetcher,calls,sent,env}
}
test('OTP only permits private gateway or an explicitly pinned HTTPS origin',()=>{
 assert.ok(otpGateway(env));assert.equal(otpGateway({...env,GH_WAHA_HTTPS_ORIGIN:'https://other.example'}),null)
 for(const url of ['http://gateway.example','https://gateway.example/path','https://user:password@gateway.example','https://gateway.example/?redirect=1','https://gateway.example/#fragment'])assert.equal(otpGateway({...env,WAHA_BASE_URL:url}),null)
})
test('request sends code only to database-matched recipient and never returns it',async()=>{
 const f=fixture(),r=await supplierPortalRequest(request({action:'request',phone:'0771234567'}),f),body=await r.json()
 assert.equal(r.status,200);assert.equal(f.sent.length,1);assert.equal(f.sent[0].chatId,'94771234567@c.us')
 const code=f.sent[0].text.match(/code is (\d{6})/)[1]
 assert.equal(f.calls[0].args.p_code_hash,createHmac('sha256',env.GH_PORTAL_OTP_SECRET).update(body.challenge+':'+code).digest('hex'))
 assert.ok(!JSON.stringify(body).includes(code));assert.ok(!JSON.stringify(body).includes('94771234567'))
 assert.equal(f.calls[1].name,'proc_portal_otp_delivered_v1');assert.equal(r.headers.get('cache-control'),'no-store')
})
test('mismatched phone and rate limits never send a code',async()=>{
 for(const data of [null,{limited:true}]){
  const f=fixture();f.db.rpc=async()=>({data})
  const r=await supplierPortalRequest(request({action:'request',phone:'0771234568'}),f)
  assert.equal(r.status,data?429:403);assert.equal(f.sent.length,0)
 }
})
test('gateway offline and disabled sending cannot issue OTP challenges',async()=>{
 for(const f of [{...fixture(),fetcher:async()=>Response.json({status:'STOPPED'})},{...fixture(),env:{...env,GH_PORTAL_OTP_SENDING_ENABLED:'false'}}]){
  const r=await supplierPortalRequest(request({action:'request',phone:'0771234567'}),f)
  assert.equal(r.status,503);assert.equal(f.calls.length,0)
 }
})
test('unknown gateway outcomes are not retried or marked usable',async()=>{
 const f=fixture();let posts=0;f.fetcher=async(_url,o)=>{if(o.method==='POST'){posts++;throw Error('timeout')}return Response.json({status:'WORKING'})}
 const r=await supplierPortalRequest(request({action:'request',phone:'0771234567'}),f)
 assert.equal(r.status,503);assert.equal(posts,1);assert.equal(f.calls.length,1)
})
test('verified codes create an opaque Secure HttpOnly SameSite cookie',async()=>{
 const f=fixture(),r=await supplierPortalRequest(request({action:'verify',challenge:'00000000-0000-4000-8000-000000000001',code:'012345'}),f)
 assert.equal(r.status,200);const cookie=r.headers.get('set-cookie')
 assert.match(cookie,/^__Host-gh-supplier=[0-9a-f]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict/)
 assert.notEqual(f.calls[0].args.p_session_hash,cookie.split('=')[1].split(';')[0])
 assert.deepEqual(await r.json(),{ok:true})
})
test('incorrect OTP cannot set a session cookie',async()=>{
 const f=fixture();f.db.rpc=async()=>({data:null})
 const r=await supplierPortalRequest(request({action:'verify',challenge:'00000000-0000-4000-8000-000000000001',code:'012345'}),f)
 assert.equal(r.status,403);assert.equal(r.headers.get('set-cookie'),null)
})
test('bearer link alone cannot read or submit, even with staff Authorization',async()=>{
 for(const action of ['read','submit']){
  const f=fixture(),r=await supplierPortalRequest(request({action},{authorization:'Bearer staff-token'}),f)
  assert.equal(r.status,401);assert.equal(f.calls.length,0)
 }
})
test('verified reads and submits use only the guarded session RPC',async()=>{
 for(const action of ['read','submit']){
  const f=fixture(),r=await supplierPortalRequest(request({action,response:[],revision:1,confirm:true},{cookie:'__Host-gh-supplier='+'c'.repeat(64)}),f)
  assert.equal(r.status,200);assert.equal(f.calls[0].name,'proc_portal_session_v1');assert.equal(f.calls[0].args.p_action,action)
  assert.equal(f.calls[0].args.p_session_hash.length,64)
 }
})
test('cross-origin, malformed and oversized requests are rejected before database access',async()=>{
 for(const r of [request({action:'read'},{origin:'https://attacker.example'}),request({action:'read'},{'content-type':'text/plain'}),request({action:'read'},{'content-length':'1600000'}),request({action:'read',token:'bad'})]){
  const f=fixture(),response=await supplierPortalRequest(r,f);assert.ok(response.status>=400);assert.equal(f.calls.length,0)
 }
})
test('backend failures do not expose raw SQL, secrets or transport details',async()=>{
 const f=fixture();f.db.rpc=async()=>({error:{message:'secret database details'}})
 const r=await supplierPortalRequest(request({action:'read'},{cookie:'__Host-gh-supplier='+'c'.repeat(64)}),f)
 assert.equal(r.status,503);assert.doesNotMatch(JSON.stringify(await r.json()),/secret database details/)
})
