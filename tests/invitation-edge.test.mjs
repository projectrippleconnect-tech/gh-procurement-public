import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

const source=readFileSync(new URL('../supabase/functions/proc-invite-user/index.ts',import.meta.url),'utf8').replace(/^import .*\n/,'')
const destination='https://gh-procurement-production.up.railway.app/?recovery=1'
function harness({existing=null,allowed=true,emailError=null,linkError=null,missingHash=false,resetTargetActive=true}={}){
  let handler
  const calls=[]
  const service={
    auth:{
      admin:{
        listUsers:async()=>({data:{users:existing?[existing]:[]},error:null}),
        getUserById:async(id)=>{calls.push({kind:'getUserById',id});return {data:{user:{id,email:'recipient@example.test'}},error:null}},
        inviteUserByEmail:async(email,options)=>{calls.push({kind:'invite',email,options});return {data:{user:{id:'recipient'}},error:emailError}},
        generateLink:async(options)=>{calls.push({kind:'link',options});return {data:{user:{id:'recipient'},properties:{action_link:'https://auth.example.test/verify?token=test-only',...(!missingHash?{hashed_token:'test-hash-only'}:{})}},error:linkError}}
      },
      resetPasswordForEmail:async(email,options)=>{calls.push({kind:'reset',email,options});return {error:emailError}}
    },
    from(table){
      let filter={}
      const q={
        select(){return q},eq(key,value){filter[key]=value;return q},ilike(){return q},
        async maybeSingle(){
          const data=table==='proc_profiles'?(filter.id==='admin'?{role_key:'admin',active:true}:{id:filter.id,role_key:'viewer',active:resetTargetActive,deleted_at:null})
            :table==='proc_role_permissions'?(allowed?{permission_key:'admin.users.manage'}:null)
            :table==='proc_roles'?{enabled:true,base_role:'viewer',name:'Viewer'}:null
          return {data,error:null}
        },
        async upsert(payload){calls.push({kind:'upsert',table,payload});return {error:null}},
        async insert(payload){calls.push({kind:'insert',table,payload});return {error:null}},
        update(payload){calls.push({kind:'update',table,payload});return {eq:async()=>({error:null})}}
      }
      return q
    }
  }
  vm.runInNewContext(source,{
    Deno:{env:{get:key=>key==='SUPABASE_SERVICE_ROLE_KEY'?'service':'anon'},serve:fn=>{handler=fn}},
    createClient:(_url,key)=>key==='service'?service:{auth:{getUser:async()=>({data:{user:{id:'admin'}},error:null})}},
    Response,Date
  })
  const invoke=async(auth=true,delivery='email',payload={})=>{
    const response=await handler({method:'POST',headers:new Headers(auth?{Authorization:'Bearer test'}:{}),json:async()=>({email:'recipient@example.test',display_name:'Recipient',role_key:'viewer',user_id:'00000000-0000-4000-8000-000000000012',delivery,...payload})})
    return {status:response.status,body:await response.json(),cacheControl:response.headers.get('Cache-Control')}
  }
  return {calls,invoke}
}
test('new invitations use production setup page and remain pending',async()=>{
  const h=harness();const result=await h.invoke()
  assert.equal(result.status,200);assert.equal(h.calls[0].kind,'invite')
  assert.equal(h.calls[0].options.redirectTo,destination)
  const record=h.calls.find(c=>c.table==='proc_user_invites').payload
  assert.equal(record.status,'pending');assert.equal(record.accepted_at,null)
})
test('unused invitation receives a fresh setup email',async()=>{
  const h=harness({existing:{id:'recipient',email:'recipient@example.test',invited_at:'2026-10-10',last_sign_in_at:null}})
  const result=await h.invoke()
  assert.equal(result.status,200);assert.equal(h.calls[0].kind,'reset')
  assert.equal(h.calls[0].options.redirectTo,destination)
  assert.match(result.body.message,/Fresh password-setup email sent/)
  assert.equal(h.calls.find(c=>c.table==='proc_user_invites').payload.status,'pending')
})
test('signed-in existing account is enabled without a reset email',async()=>{
  const h=harness({existing:{id:'recipient',email:'recipient@example.test',invited_at:'2026-10-10',last_sign_in_at:'2026-10-11'}})
  assert.equal((await h.invoke()).status,200)
  assert.equal(h.calls.some(c=>['invite','reset'].includes(c.kind)),false)
  assert.equal(h.calls.find(c=>c.table==='proc_user_invites').payload.status,'accepted')
})
test('delivery failures do not report success or write accepted invitation',async()=>{
  const h=harness({existing:{id:'recipient',email:'recipient@example.test',invited_at:'2026-10-10'},emailError:new Error('Email address not authorized')})
  const result=await h.invoke()
  assert.equal(result.status,400);assert.match(result.body.error,/not authorized/)
  assert.equal(h.calls.some(c=>c.table==='proc_user_invites'),false)
})
test('users without management permission cannot send invitations',async()=>{
  const h=harness({allowed:false})
  assert.equal((await h.invoke()).status,403);assert.equal(h.calls.length,0)
})
test('unauthenticated calls cannot send invitations',async()=>{
  const h=harness()
  assert.equal((await h.invoke(false)).status,401);assert.equal(h.calls.length,0)
})
test('setup links create new invite accounts without sending email',async()=>{
  const h=harness({emailError:new Error('SMTP disabled')});const result=await h.invoke(true,'link')
  assert.equal(result.status,200);assert.equal(h.calls[0].kind,'link')
  assert.equal(h.calls[0].options.type,'invite');assert.equal(h.calls[0].options.options.redirectTo,destination)
  assert.equal(result.body.setup_link,destination+'#token_hash=test-hash-only&type=invite')
  assert.equal(result.cacheControl,'no-store')
  assert.equal(h.calls.some(c=>['invite','reset'].includes(c.kind)),false)
  const record=h.calls.find(c=>c.table==='proc_user_invites').payload
  assert.equal(record.status,'pending');assert.equal(record.accepted_at,null)
  const profile=h.calls.find(c=>c.table==='proc_profiles').payload
  assert.equal(profile.deleted_at,null);assert.equal(profile.deleted_by,null)
  assert.equal(h.calls.filter(c=>c.payload).some(c=>JSON.stringify(c.payload).includes('token=test-only')),false)
})
test('existing accounts get recovery setup links even after a failed redirect signed them in',async()=>{
  const h=harness({existing:{id:'recipient',email:'recipient@example.test',last_sign_in_at:'2026-10-11'}})
  const result=await h.invoke(true,'link')
  assert.equal(result.status,200);assert.equal(h.calls[0].options.type,'recovery')
  assert.equal(result.body.setup_link,destination+'#token_hash=test-hash-only&type=recovery');assert.equal(h.calls.some(c=>['invite','reset'].includes(c.kind)),false)
})
test('setup link generation failures do not write invitation success',async()=>{
  const h=harness({linkError:new Error('Link generation failed')})
  const result=await h.invoke(true,'link')
  assert.equal(result.status,400);assert.equal(h.calls.some(c=>c.table==='proc_user_invites'),false)
})
test('setup links require user-management permission',async()=>{
  const h=harness({allowed:false});assert.equal((await h.invoke(true,'link')).status,403);assert.equal(h.calls.length,0)
})
test('setup links require authentication',async()=>{
  const h=harness();assert.equal((await h.invoke(false,'link')).status,401);assert.equal(h.calls.length,0)
})
test('unknown delivery methods cannot generate credentials',async()=>{
  const h=harness();assert.equal((await h.invoke(true,'unknown')).status,400);assert.equal(h.calls.length,0)
})

test('older auth servers without a token hash keep the managed Supabase verification link',async()=>{
  const h=harness({missingHash:true});const result=await h.invoke(true,'link')
  assert.equal(result.status,200)
  assert.equal(result.body.setup_link,'https://auth.example.test/verify?token=test-only')
})

test('admin can generate an existing user recovery link with no SMTP, no role changes and no record writes',async()=>{
 const h=harness({emailError:new Error('email rate limit exceeded')})
 const response=await h.invoke(true,'reset_link')
 assert.equal(response.status,200)
 assert.equal(response.body.email,'recipient@example.test')
 assert.equal(response.body.setup_link,destination+'#token_hash=test-hash-only&type=recovery')
 assert.equal(response.cacheControl,'no-store')
 assert.equal(h.calls.filter(c=>c.kind==='link').length,1)
 assert.equal(h.calls.find(c=>c.kind==='link').options.type,'recovery')
 assert.equal(h.calls.some(c=>['reset','invite','insert','upsert','update'].includes(c.kind)),false)
 assert.equal(h.calls.some(c=>c.table==='proc_user_invites'),false)
})
test('recovery-link generation rejects missing permission, inactive users and malformed identities',async()=>{
 const denied=harness({allowed:false})
 assert.equal((await denied.invoke(true,'reset_link')).status,403)
 assert.equal(denied.calls.length,0)
 const inactive=harness({resetTargetActive:false})
 assert.equal((await inactive.invoke(true,'reset_link')).status,400)
 assert.equal(inactive.calls.some(c=>c.kind==='link'),false)
 const malformed=harness()
 assert.equal((await malformed.invoke(true,'reset_link',{user_id:'not-a-user-id'})).status,400)
 assert.equal(malformed.calls.length,0)
 const anonymous=harness()
 assert.equal((await anonymous.invoke(false,'reset_link')).status,401)
 assert.equal(anonymous.calls.length,0)
})
test('recovery-link generation fails closed without a hashed token',async()=>{
 const h=harness({missingHash:true})
 const r=await h.invoke(true,'reset_link')
 assert.equal(r.status,400)
 assert.match(r.body.error,/secure recovery link/)
 assert.equal(h.calls.some(c=>c.kind==='reset'),false)
})
