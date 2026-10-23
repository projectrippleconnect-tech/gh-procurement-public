import {createHash,createHmac,randomInt,randomBytes,randomUUID} from 'node:crypto'
import {createClient} from '@supabase/supabase-js'
import {extractWahaMessageId} from './waha-rfq.js'
import {approvedGatewayUrl} from './waha-gateway.mjs'

const cookieName='__Host-gh-supplier'
const hash=value=>createHash('sha256').update(value).digest('hex')
const reply=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer',...headers}})
export function otpGateway(env){
 try{
  const u=approvedGatewayUrl(env.WAHA_BASE_URL,env),session=env.WAHA_SESSION||'default'
  // A Netlify-accessible relay requires an exact, explicitly configured HTTPS
  // origin. Never accept a URL supplied by a supplier or follow redirects.
  if(!u||!env.WAHA_API_KEY||!/^[-\w]{1,50}$/.test(session))return null
  return {base:u.origin,key:env.WAHA_API_KEY,session}
 }catch{return null}
}
export async function supplierPortalRequest(request,{env=process.env,db,fetcher=fetch}={}){
 const url=new URL(request.url)
 if(request.method!=='POST')return reply({error:'Method not allowed'},405)
 if(request.headers.get('origin')!==url.origin||!/^application\/json\b/i.test(request.headers.get('content-type')||''))return reply({error:'Invalid request origin or content type'},403)
 if(Number(request.headers.get('content-length')||0)>1_550_000)return reply({error:'Quotation is too large'},413)
 let body
 try{
  // Stream-bound the body even when Content-Length is absent or inaccurate.
  const reader=request.body?.getReader();let size=0;const chunks=[]
  if(!reader)throw Error()
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1_550_000){await reader.cancel();return reply({error:'Quotation is too large'},413)}chunks.push(value)}
  body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
 }catch{return reply({error:'Invalid request'},400)}
 if(!body||typeof body.token!=='string'||!/^[0-9a-f]{64}$/.test(body.token))return reply({error:'Invalid quotation link'},400)
 if(!['request','verify','read','submit','logout'].includes(body.action))return reply({error:'Invalid action'},400)
 if(body.action==='logout')return reply({ok:true},200,{'Set-Cookie':cookieName+'=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'})
 const pepper=env.GH_PORTAL_OTP_SECRET||env.SUPABASE_SERVICE_ROLE_KEY||''
 if(pepper.length<32||!env.SUPABASE_SERVICE_ROLE_KEY||!env.NEXT_PUBLIC_SUPABASE_URL)return reply({error:'Supplier verification is not configured. Please contact purchasing.'},503)
 db??=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},db:{timeout:20000,retry:false}})
 const call=async(name,args)=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data}
 const digest=(id,code)=>createHmac('sha256',pepper).update(id+':'+code).digest('hex')
 try{
  if(body.action==='request'){
   if(typeof body.phone!=='string'||body.phone.length>32)return reply({error:'Enter your registered mobile number'},400)
   const gateway=otpGateway(env)
   if(!gateway||env.GH_PORTAL_OTP_SENDING_ENABLED!=='true')return reply({error:'Verification delivery is unavailable. Please contact purchasing.'},503)
   const health=await fetcher(gateway.base+'/api/sessions/'+gateway.session,{headers:{'X-Api-Key':gateway.key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)})
   if(!health.ok||(await health.json()).status!=='WORKING')return reply({error:'Verification delivery is offline. Please try later.'},503)
   const challenge=randomUUID(),code=String(randomInt(0,1_000_000)).padStart(6,'0')
   const reservation=await call('proc_portal_otp_request_v1',{p_token:body.token,p_phone:body.phone,p_challenge:challenge,p_code_hash:digest(challenge,code)})
   if(reservation?.limited)return reply({error:'Please wait before requesting another code. Maximum five codes per hour.'},429,{'Retry-After':'60'})
   if(!reservation?.phone)return reply({error:'Unable to verify these details. Use the mobile number registered with purchasing and a current invitation.'},403)
   const response=await fetcher(gateway.base+'/api/sendText',{method:'POST',headers:{'X-Api-Key':gateway.key,'Content-Type':'application/json'},body:JSON.stringify({session:gateway.session,chatId:reservation.phone+'@c.us',text:'Your supplier quotation verification code is '+code+'. It expires in 5 minutes. Do not share this code.'}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)})
   const messageId=response.ok?extractWahaMessageId(await response.json().catch(()=>({}))):null
   // An uncertain send is never automatically retried or advertised as usable.
   if(!messageId)return reply({error:'Code delivery could not be confirmed. Please wait before requesting another code.'},503)
   if(!await call('proc_portal_otp_delivered_v1',{p_challenge:challenge}))return reply({error:'Code expired. Please request another code.'},403)
   return reply({ok:true,challenge,masked_phone:'+94 ••• •• '+reservation.phone.slice(-4),expires_at:reservation.expires_at})
  }
  if(body.action==='verify'){
   if(typeof body.challenge!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.challenge)||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))return reply({error:'Enter the six-digit code'},400)
   const session=randomBytes(32).toString('hex')
   const result=await call('proc_portal_otp_verify_v1',{p_token:body.token,p_challenge:body.challenge,p_code_hash:digest(body.challenge,body.code),p_session_hash:hash(session)})
   if(!result)return reply({error:'Code is incorrect, expired or already used. Request a new code if needed.'},403)
   return reply({ok:true},200,{'Set-Cookie':cookieName+'='+session+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=7200'})
  }
  const cookie=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1)||''
  if(!/^[0-9a-f]{64}$/.test(cookie))return reply({error:'Verify your registered phone number to continue.',verification_required:true},401)
  const data=await call('proc_portal_session_v1',{p_token:body.token,p_session_hash:hash(cookie),p_action:body.action,...(body.action==='submit'?{p_response:body.response,p_expected_revision:body.revision,p_confirm:body.confirm===true}:{})})
  return reply({data})
 }catch(e){
  if(e?.code==='42501')return reply({error:'Phone verification has expired or access has changed. Verify again.',verification_required:true},401)
  if(e?.code==='PT409')return reply({error:'Quotation changed in another window. Refresh before saving.'},409)
  if(e?.code==='P0001')return reply({error:'The quotation could not be saved. Check the deadline, item quantities, rates and delivery terms, then refresh if needed.'},400)
  // Never return SQL, gateway URLs, credentials, phone records or transport errors.
  return reply({error:'Supplier portal is temporarily unavailable. Your saved quotation is preserved.'},503)
 }
}
