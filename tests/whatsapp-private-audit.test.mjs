import test from 'node:test'
import assert from 'node:assert/strict'
import {privateGroupConfig,inspectPrivateGroup,privateGroupCaption,mirrorStaffGroupCopy} from '../lib/whatsapp-private-audit.mjs'

const env={GH_WA_AUDIT_ENABLED:'true',GH_WA_AUDIT_GROUP_ID:'120363123456789@g.us',GH_WA_AUDIT_GROUP_NAME:'GH Procurement',GH_WA_AUDIT_ALLOWED_MEMBERS:'+94777712345,94777712346'}
const config=privateGroupConfig(env)
const group={id:'120363123456789@g.us',subject:'GH Procurement'}
const participants=[{id:'94777712345@c.us',role:'admin'},{id:'94777712346@c.us',role:'participant'}]

test('private group archive is disabled by default and invalid/short members fail closed',()=>{
 assert.deepEqual(privateGroupConfig({}),{ready:false,reason:'not_enabled'})
 assert.equal(config.ready,true)
 assert.equal(privateGroupConfig({...env,GH_WA_AUDIT_GROUP_ID:'94777712345@c.us'}).ready,false)
 assert.equal(privateGroupConfig({...env,GH_WA_AUDIT_ALLOWED_MEMBERS:'+94777712345'}).ready,false)
 assert.equal(privateGroupConfig({...env,GH_WA_AUDIT_ALLOWED_MEMBERS:'+94777712345,invalid'}).ready,false)
 assert.equal(privateGroupConfig({...env,GH_WA_AUDIT_ALLOWED_MEMBERS:'+94777712345,+94777712345'}).ready,false)
});
test('member verification checks exact group identity, expected member set and GOWS LID safety',()=>{
 assert.equal(inspectPrivateGroup({group,participants,config}).ok,true)
 assert.equal(inspectPrivateGroup({group:{...group,subject:'Different group'},participants,config}).ok,false)
 assert.equal(inspectPrivateGroup({group,participants:[...participants,{id:'94777719999@c.us'}],config}).reason,'membership_changed')
 assert.equal(inspectPrivateGroup({group,participants:[participants[0]],config}).ok,false)
 assert.equal(inspectPrivateGroup({group,participants:[participants[0],{id:'123456789012@lid'}],config}).ok,false)
 assert.equal(inspectPrivateGroup({group,participants:[],config}).reason,'membership_unavailable')
});
test('audit caption separates gateway acceptance from delivery and identifies supplier and document',()=>{
 const c=privateGroupCaption({kind:'po',number:'024',supplier:'Main',dispatchId:'9b6',originalCaption:'Please see enclosed image'})
 assert.match(c,/PRIVATE STAFF AUDIT/)
 assert.match(c,/PURCHASE ORDER: 024/)
 assert.match(c,/Supplier: Main/)
 assert.match(c,/not delivery confirmation/)
 assert.match(c,/Dispatch: 9b6/)
 assert.match(c,/Please see enclosed image/)
 assert.ok(c.length<=2000)
});
test('with group disabled there is no network or database activity',async()=>{
 let calls=0
 const result=await mirrorStaffGroupCopy({db:{rpc:()=>{calls++}},kind:'rfq',sourceId:'id',session:'default',base:'http://localhost:3000',key:'secret',base64:'image',filename:'a.png',caption:'caption',imageHash:'a'.repeat(64)})
 assert.equal(result.status,'disabled')
 assert.equal(calls,0)
});
test('verified archive claims exactly once and finishes after sending PNG to the exact staff group', {concurrency:false},async()=>{
 const previous={};for(const [key,value] of Object.entries(env)){previous[key]=process.env[key];process.env[key]=value}
 const original=globalThis.fetch,paths=[],rpcs=[];
 globalThis.fetch=async(input,init={})=>{
  const uri=String(input);paths.push(uri)
  if(uri.endsWith('/participants/v2'))return {ok:true,json:async()=>participants}
  if(uri.includes('/groups/'))return {ok:true,json:async()=>group}
  if(uri.endsWith('/api/sendImage')){
   const body=JSON.parse(init.body)
   assert.equal(body.chatId,config.groupId)
   assert.match(body.caption,/PRIVATE STAFF AUDIT/)
   return {ok:true,json:async()=>({id:'msg-123'})}
  }
  throw new Error('Unexpected network request '+uri)
 };
 try{
  const db={rpc:async(name,args)=>{rpcs.push({name,args});return name.includes('claim')?{data:'audit-uuid',error:null}:{data:true,error:null}}};
  const data={db,kind:'po',sourceId:'original-uuid',pageNumber:1,session:'default',base:'http://localhost:3000',key:'secret',base64:'encoded-png',filename:'PO.png',caption:'GH Procurement — PRIVATE STAFF AUDIT',imageHash:'a'.repeat(64)}
  const r=await mirrorStaffGroupCopy(data)
  assert.equal(r.status,'accepted')
  assert.equal(paths.filter(p=>p.endsWith('/api/sendImage')).length,1)
  assert.equal(rpcs.filter(p=>p.name.includes('claim')).length,1)
  assert.equal(rpcs.filter(p=>p.name.includes('finish')).length,1)
  assert.equal(rpcs[0].args.p_source_id,'original-uuid')
  assert.equal(rpcs[0].args.p_page,1)
  const duplicate=await mirrorStaffGroupCopy({...data,db:{rpc:async name=>({data:null,error:{code:'23505'}})}})
  assert.equal(duplicate.status,'already_recorded')
  assert.equal(paths.filter(p=>p.endsWith('/api/sendImage')).length,1)
 }finally{globalThis.fetch=original;for(const key of Object.keys(env)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}}
});
test('unknown staff group member blocks all archive sending before database claim', {concurrency:false},async()=>{
 const previous={};for(const [key,value] of Object.entries(env)){previous[key]=process.env[key];process.env[key]=value}
 const original=globalThis.fetch;let posts=0,claims=0;
 globalThis.fetch=async(url)=>{if(String(url).endsWith('participants/v2'))return {ok:true,json:async()=>[...participants,{id:'94778889999@c.us'}]};if(String(url).includes('/groups/'))return {ok:true,json:async()=>group};posts++;throw new Error('Unexpected send')}
 try{
  const r=await mirrorStaffGroupCopy({db:{rpc:()=>{claims++}},kind:'rfq',sourceId:'id',session:'default',base:'http://localhost:3000',key:'secret',base64:'image',filename:'a.png',caption:'caption',imageHash:'a'.repeat(64)})
  assert.equal(r.status,'blocked');assert.equal(r.reason,'membership_changed');assert.equal(posts,0);assert.equal(claims,0)
 }finally{globalThis.fetch=original;for(const key of Object.keys(env)){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]}}
});
