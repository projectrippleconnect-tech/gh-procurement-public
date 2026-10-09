import {createClient} from '@supabase/supabase-js'
export const runtime='nodejs'
export const dynamic='force-dynamic'

const answer=(data:object,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})
const fail=(message:string,status:number)=>answer({ok:false,error:message},status)
function wahaConfig(){
 const raw=process.env.WAHA_BASE_URL||'',key=process.env.WAHA_API_KEY||'',session=process.env.WAHA_SESSION||'default'
 if(!raw||!key||!process.env.SUPABASE_SERVICE_ROLE_KEY)return null
 try{
  const url=new URL(raw)
  if(!['http:','https:'].includes(url.protocol)||!(/\.railway\.internal$/.test(url.hostname)||['localhost','127.0.0.1'].includes(url.hostname)))return null
  if(url.username||url.password||url.pathname!=='/'||!(/^[\w-]{1,50}$/.test(session)))return null
  return {base:url.origin,key,session}
 }catch{return null}
}
async function checkAdmin(request:Request){
 const match=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)
 if(!match)return {error:fail('Sign in to use WhatsApp setup.',401)}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!url||!key||!secret)return {error:fail('Gateway administration is not configured.',503)}
 const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:{user},error}=await auth.auth.getUser(match[1])
 if(error||!user)return {error:fail('Your session has expired.',401)}
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:profile,error:dbError}=await db.from('proc_profiles').select('id,role,active').eq('id',user.id).maybeSingle()
 if(dbError||!profile?.active||profile.role!=='admin')return {error:fail('Admin permission required for WhatsApp pairing.',403)}
 return {ok:true}
}
const headers=(config:{key:string})=>({'X-Api-Key':config.key,Accept:'application/json','Content-Type':'application/json'})
async function sessionInfo(config:{base:string;key:string;session:string}){
 return fetch(config.base+'/api/sessions/'+encodeURIComponent(config.session),{
  headers:headers(config),signal:AbortSignal.timeout(6500),cache:'no-store'
 })
}
export async function GET(request:Request){
 const auth=await checkAdmin(request)
 if(auth.error)return auth.error
 const config=wahaConfig()
 if(!config)return answer({ok:true,configured:false,status:'NOT_CONFIGURED'})
 try{
  const state=await sessionInfo(config)
  if(state.status===404)return answer({ok:true,configured:true,status:'MISSING'})
  if(!state.ok)return fail('WhatsApp gateway status could not be fetched.',502)
  const info=await state.json()
  if(new URL(request.url).searchParams.get('qr')==='1'){
   if(info.status==='WORKING')return answer({ok:true,status:'WORKING'})
   const q=await fetch(config.base+'/api/'+encodeURIComponent(config.session)+'/auth/qr',{
    headers:headers(config),cache:'no-store',signal:AbortSignal.timeout(6500)
   })
   if(!q.ok)return fail('QR code is not currently available. Start the session or use a pairing code.',409)
   const data=await q.json()
   if(data?.mimetype!=='image/png'||!/^[A-Za-z0-9+/=]+$/.test(data?.data||'')||data.data.length>300000)return fail('Invalid QR response.',502)
   return answer({ok:true,status:info.status,qr:'data:image/png;base64,'+data.data})
  }
  return answer({ok:true,configured:true,status:info.status||'UNKNOWN'})
 }catch{return fail('Cannot reach the private WhatsApp gateway.',503)}
}
export async function POST(request:Request){
 const auth=await checkAdmin(request)
 if(auth.error)return auth.error
 const config=wahaConfig()
 if(!config)return fail('Private gateway and credentials must be configured first.',503)
 let payload
 try{payload=await request.json()}catch{return fail('Invalid pairing request.',400)}
 const action=String(payload?.action||'')
 if(!['start','code'].includes(action))return fail('Unsupported pairing action.',400)
 try{
  let state=await sessionInfo(config)
  if(state.status===404){
   if(action!=='start')return fail('Start the session before requesting a pairing code.',409)
   const created=await fetch(config.base+'/api/sessions',{
    method:'POST',headers:headers(config),signal:AbortSignal.timeout(10000),cache:'no-store',
    body:JSON.stringify({name:config.session,config:{noweb:{store:{enabled:true,fullSync:false}}}})
   })
   if(!created.ok)return fail('WAHA could not create the pairing session.',502)
   return answer({ok:true,status:'STARTING',message:'Session created. Refresh status in a few seconds.'})
  }
  if(!state.ok)return fail('Cannot access the existing gateway session.',502)
  const info=await state.json()
  if(info.status==='WORKING')return answer({ok:true,status:'WORKING',message:'WhatsApp is already connected.'})
  if(action==='start'){
   const start=await fetch(config.base+'/api/sessions/'+encodeURIComponent(config.session)+'/start',{
    method:'POST',headers:headers(config),cache:'no-store',signal:AbortSignal.timeout(10000),body:'{}'
   })
   if(!start.ok)return fail('Could not start the WAHA pairing session.',502)
   return answer({ok:true,status:'STARTING'})
  }
  const number=String(payload?.phoneNumber||'').trim().replace(/[\s()+-]/g,'')
  if(!/^[1-9][0-9]{7,14}$/.test(number))return fail('Enter a valid international WhatsApp number, for example +94771234567.',400)
  const response=await fetch(config.base+'/api/'+encodeURIComponent(config.session)+'/auth/request-code',{
   method:'POST',headers:headers(config),cache:'no-store',signal:AbortSignal.timeout(15000),
   body:JSON.stringify({phoneNumber:number})
  })
  if(!response.ok)return fail('WhatsApp could not provide a pairing code. Use the QR alternative.',409)
  const data=await response.json()
  if(typeof data?.code!=='string'||data.code.length>32)return fail('Invalid pairing code response.',502)
  return answer({ok:true,status:'PAIRING',code:data.code})
 }catch{return fail('Private WhatsApp gateway is not reachable. Nothing was paired.',503)}
}
