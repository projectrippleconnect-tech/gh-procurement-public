import {createClient} from '@supabase/supabase-js'

export const runtime='nodejs'
export const dynamic='force-dynamic'
const json=(data:object,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})

function privateGateway(){
 const raw=process.env.WAHA_BASE_URL||''
 const key=process.env.WAHA_API_KEY||''
 if(!raw||!key||!process.env.SUPABASE_SERVICE_ROLE_KEY)return null
 try{
  const url=new URL(raw)
  if(url.protocol!=='http:'||!url.hostname.endsWith('.railway.internal')||url.username||url.password||url.pathname!=='/'||url.search)return null
  const session=process.env.WAHA_SESSION||'default'
  if(!/^[\w-]{1,50}$/.test(session))return null
  return {base:url.origin,key,session}
 }catch{return null}
}
async function adminAccess(request:Request){
 const match=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)
 if(!match)return {error:json({ok:false,error:'Please sign in.'},401)}
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL
 const anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!url||!anon||!secret)return {error:json({ok:false,error:'Admin pairing is not configured.'},503)}
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:{user},error}=await auth.auth.getUser(match[1])
 if(error||!user)return {error:json({ok:false,error:'Session expired. Sign in again.'},401)}
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:profile,error:dbError}=await db.from('proc_profiles').select('role,active').eq('id',user.id).maybeSingle()
 if(dbError)return {error:json({ok:false,error:'Unable to verify administrator access.'},503)}
 if(profile?.role!=='admin'||!profile.active)return {error:json({ok:false,error:'Only active administrators can pair a WhatsApp device.'},403)}
 return {user}
}
async function callWaha(config:{base:string;key:string;session:string},path:string,method='GET',body?:object,accept='application/json'){
 const response=await fetch(config.base+path,{
  method,
  headers:{'X-Api-Key':config.key,Accept:accept,...(body?{'Content-Type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(10000),cache:'no-store'
 })
 const data=await response.json().catch(()=>null)
 return {response,data}
}
async function sessionStatus(config:{base:string;key:string;session:string}){
 const {response,data}=await callWaha(config,'/api/sessions/'+encodeURIComponent(config.session))
 return response.status===404?'MISSING':response.ok?String(data?.status||'UNKNOWN'):'ERROR'
}
export async function GET(request:Request){
 const access=await adminAccess(request)
 if(access.error)return access.error
 const config=privateGateway()
 if(!config)return json({ok:false,configured:false,status:'NOT_CONFIGURED'},503)
 try{
  const status=await sessionStatus(config)
  let qr:string|null=null
  if(status==='SCAN_QR_CODE'){
   const {response,data}=await callWaha(config,'/api/'+encodeURIComponent(config.session)+'/auth/qr?format=image')
   if(response.ok&&data?.mimetype==='image/png'&&typeof data.data==='string'&&data.data.length<300000&&/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)){
    qr='data:image/png;base64,'+data.data
   }
  }
  return json({ok:true,status,connected:status==='WORKING',qr})
 }catch{return json({ok:false,status:'OFFLINE',error:'Private WhatsApp gateway is unreachable.'},503)}
}
export async function POST(request:Request){
 const access=await adminAccess(request)
 if(access.error)return access.error
 const config=privateGateway()
 if(!config)return json({ok:false,error:'Gateway not configured.'},503)
 let body:Record<string,unknown>
 try{
  const text=await request.text()
  if(text.length>1000)throw new Error('too long')
  body=JSON.parse(text)
 }catch{return json({ok:false,error:'Invalid pairing request.'},400)}
 const action=body.action
 if(action!=='start'&&action!=='code')return json({ok:false,error:'Unsupported pairing action.'},400)
 try{
  const status=await sessionStatus(config)
  if(action==='start'){
   if(status==='WORKING')return json({ok:true,status,connected:true})
   if(status==='MISSING'){
    const {response}=await callWaha(config,'/api/sessions','POST',{name:config.session,config:{}})
    if(!response.ok)return json({ok:false,error:'Unable to create WhatsApp session.'},502)
   }else if(status==='STOPPED'||status==='FAILED'){
    const {response}=await callWaha(config,'/api/sessions/'+encodeURIComponent(config.session)+'/start','POST')
    if(!response.ok)return json({ok:false,error:'Unable to start WhatsApp session.'},502)
   }else if(status==='ERROR')return json({ok:false,error:'Gateway session check failed.'},503)
   return json({ok:true,status:'STARTING',notice:'Refresh connection status to get a QR or request a pairing code.'})
  }
  if(status==='MISSING'||status==='STOPPED'||status==='FAILED'||status==='ERROR')return json({ok:false,error:'Start the WhatsApp session first.'},409)
  if(status==='WORKING')return json({ok:false,error:'Already connected. Pairing is unnecessary.'},409)
  const raw=String(body.phoneNumber||'').replace(/\D/g,'')
  let phone=raw.startsWith('00')?raw.slice(2):raw
  if(phone.startsWith('0'))phone='94'+phone.slice(1)
  else if(/^7\d{8}$/.test(phone))phone='94'+phone
  if(!/^\d{8,15}$/.test(phone))return json({ok:false,error:'Enter a valid international WhatsApp phone number.'},400)
  const {response,data}=await callWaha(config,'/api/'+encodeURIComponent(config.session)+'/auth/request-code','POST',{phoneNumber:phone})
  if(!response.ok||typeof data?.code!=='string'||data.code.length>32)return json({ok:false,error:'Pairing code unavailable. Try the QR option or wait and retry.'},502)
  return json({ok:true,code:data.code,notice:'Enter this code in WhatsApp Linked Devices. Never share it with anyone else.'})
 }catch{return json({ok:false,error:'Could not complete pairing request. Check the private gateway.'},503)}
}
