import {createClient} from '@supabase/supabase-js'
import {createHash} from 'node:crypto'
import {extractWahaMessageId,verifyPng,wahaImagePayload} from '@/lib/waha-rfq'

export const runtime='nodejs'
export const dynamic='force-dynamic'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const error=(message:string,status:number)=>Response.json({ok:false,error:message},{status,headers:{'cache-control':'no-store'}})
const reply=(data:object,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})

function gatewayConfig(){
 const raw=process.env.WAHA_BASE_URL||''
 const key=process.env.WAHA_API_KEY||''
 const session=process.env.WAHA_SESSION||'default'
 if(!raw||!key||!process.env.SUPABASE_SERVICE_ROLE_KEY)return null
 try{
  const url=new URL(raw)
  if(!['http:','https:'].includes(url.protocol)||!(/\.railway\.internal$/.test(url.hostname)||['localhost','127.0.0.1'].includes(url.hostname)))return null
  if(url.username||url.password||url.pathname!=='/'||!(/^[\w-]{1,50}$/.test(session)))return null
  return {base:url.origin,key,session}
 }catch{return null}
}

async function authorize(request:Request){
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 const secret=process.env.SUPABASE_SERVICE_ROLE_KEY
 if(!token||!url||!key)return {error:error('Sign in to GH Procurement before sending.',401)}
 if(!secret)return {error:error('WhatsApp gateway is not configured by the administrator.',503)}
 const authClient=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:{user},error:userError}=await authClient.auth.getUser(token)
 if(userError||!user)return {error:error('Your login session has expired. Sign in again.',401)}
 const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:profile, error:profileError}=await db.from('proc_profiles').select('id,role,active').eq('id',user.id).maybeSingle()
 if(profileError)return {error:error('Could not verify your procurement role.',503)}
 if(!profile?.active||!['admin','procurement'].includes(profile.role))return {error:error('You do not have permission to send supplier requests.',403)}
 return {db,user}
}

async function gatewaySession(config:{base:string;key:string;session:string}){
 const response=await fetch(config.base+'/api/sessions/'+encodeURIComponent(config.session),{
  headers:{'X-Api-Key':config.key,Accept:'application/json'},
  signal:AbortSignal.timeout(5000),cache:'no-store'
 })
 if(!response.ok)return {connected:false}
 const session=await response.json()
 return {connected:session?.status==='WORKING'}
}

export async function GET(request:Request){
 const access=await authorize(request)
 if(access.error)return access.error
 const config=gatewayConfig()
 if(!config)return reply({ok:true,configured:false,connected:false,sendingEnabled:false,dispatches:[]})
 const queryId=new URL(request.url).searchParams.get('rfqId')
 if(queryId&&!UUID.test(queryId))return error('Invalid RFQ identifier.',400)
 let dispatches:unknown[]=[]
 if(queryId){
  const {data, error:dbError}=await access.db.from('proc_whatsapp_rfq_dispatches')
   .select('id,rfq_id,supplier_id,status,message_id,created_at,updated_at,last_error')
   .eq('rfq_id',queryId).order('created_at',{ascending:false}).limit(50)
  if(dbError)return error('WhatsApp dispatch audit is not ready. Apply the gateway migration.',503)
  dispatches=data||[]
 }
 let connected=false
 try{connected=(await gatewaySession(config)).connected}catch{}
 return reply({ok:true,configured:true,connected,sendingEnabled:process.env.WAHA_SENDING_ENABLED==='true',dispatches})
}

export async function POST(request:Request){
 const access=await authorize(request)
 if(access.error)return access.error
 const config=gatewayConfig()
 if(!config||process.env.WAHA_SENDING_ENABLED!=='true')return error('WhatsApp sending is disabled or missing its private configuration.',503)
 const size=Number(request.headers.get('content-length')||0)
 if(size>6_500_000)return error('RFQ PNG exceeds the allowed size.',413)
 let payload
 try{
  const raw=await request.text()
  if(raw.length>6_500_000)return error('RFQ PNG exceeds the allowed size.',413)
  payload=JSON.parse(raw)
 }catch{return error('Invalid RFQ request.',400)}
 const rfqId=String(payload?.rfqId||''),supplierId=String(payload?.supplierId||'')
 if(!UUID.test(rfqId)||!UUID.test(supplierId))return error('Invalid RFQ or supplier identifier.',400)
 let png
 try{png=verifyPng(payload?.pngBase64)}catch(e){return error(e instanceof Error?e.message:'Invalid PNG.',400)}
 const {db,user}=access
 const [{data:rfq,error:rfqError},{data:supplier,error:supplierError},{data:invite,error:inviteError}]=await Promise.all([
  db.from('proc_rfqs').select('id,rfq_no,due_date,status').eq('id',rfqId).maybeSingle(),
  db.from('proc_suppliers').select('id,name,phone,whatsapp,active').eq('id',supplierId).maybeSingle(),
  db.from('proc_rfq_suppliers').select('rfq_id,supplier_id,status').eq('rfq_id',rfqId).eq('supplier_id',supplierId).maybeSingle()
 ])
 if(rfqError||supplierError||inviteError)return error('Could not validate this supplier invitation.',503)
 if(!rfq||!supplier?.active||!invite||!['pending','prepared'].includes(invite.status)||['awarded','closed','cancelled'].includes(rfq.status)){
  return error('Supplier is not an active, unsent recipient of this RFQ.',409)
 }
 const phone=supplier.whatsapp||supplier.phone
 let chatPayload
 const caption=[
  'General Hardware — Supplier Price Request',
  'RFQ: '+String(rfq.rfq_no||''),
  rfq.due_date?'Due: '+rfq.due_date:null,
  'Please check the attached RFQ image and reply with your unit rates. Add alternative sizes or remarks only when needed.'
 ].filter(Boolean).join('\n')
 try{
  chatPayload=wahaImagePayload({
   session:config.session,phone,
   filename:String(rfq.rfq_no||'RFQ')+'-'+String(supplier.name||'Supplier')+'.png',
   base64:payload.pngBase64,caption
  })
 }catch(e){return error(e instanceof Error?e.message:'Invalid supplier number.',400)}
 let connected=false
 try{connected=(await gatewaySession(config)).connected}catch{}
 if(!connected)return error('WhatsApp gateway is not linked or is offline. Use the manual PNG fallback.',503)
 // Atomically claim exactly one attempt per RFQ/supplier BEFORE contacting the gateway.
 // Unique constraint stops double taps and concurrent requests from sending duplicates.
 const {data:attempt,error:claimError}=await db.from('proc_whatsapp_rfq_dispatches').insert({
  rfq_id:rfqId,supplier_id:supplierId,sent_by:user.id,gateway_session:config.session,
  status:'sending',image_sha256:createHash('sha256').update(png).digest('hex'),caption
 }).select('id').single()
 if(claimError){
  if(claimError.code==='23505')return error('This RFQ already has a gateway send attempt for this supplier. Review its status; duplicate sending is blocked.',409)
  return error('Could not record send attempt. Sending was blocked to prevent untracked messages.',503)
 }
 let status='unknown',messageId=null,lastError=null,responseStatus=502
 try{
  const response=await fetch(config.base+'/api/sendImage',{
   method:'POST',
   headers:{'X-Api-Key':config.key,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify(chatPayload),signal:AbortSignal.timeout(25000),cache:'no-store'
  })
  if(response.ok){
   const responseBody=await response.json().catch(()=>({}))
   messageId=extractWahaMessageId(responseBody)
   status='accepted'
  }else{
   // WAHA 4xx is a definite rejection; a 5xx may hide a partially-completed send.
   status=response.status>=500?'unknown':'failed'
   responseStatus=response.status===429?429:502
   lastError='WhatsApp gateway rejected the image request (HTTP '+response.status+').'
  }
 }catch{
  status='unknown'
  lastError='Gateway response was interrupted. Check WhatsApp before attempting any manual resend.'
 }
 const {error:writeError}=await db.from('proc_whatsapp_rfq_dispatches').update({
  status,message_id:messageId,last_error:lastError,updated_at:new Date().toISOString()
 }).eq('id',attempt.id)
 if(writeError)return error('Gateway was contacted but the audit update failed. Inspect WhatsApp and dispatch records before doing anything else.',503)
 if(status!=='accepted')return error(lastError||'Gateway status unknown. Verify whether WhatsApp received the image.',responseStatus)
 // API acceptance is NOT proof of delivery or reading. The manual Confirm Sent remains.
 return reply({ok:true,status:'accepted',messageId,dispatchId:attempt.id,recipient:supplier.name})
}
