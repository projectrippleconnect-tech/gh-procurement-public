// Read-only WAHA commissioning check. Never sends messages or prints credentials.
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'

export function validateWahaReadinessEnvironment(env){
 const raw=String(env.WAHA_BASE_URL||''), key=String(env.WAHA_API_KEY||'')
 const session=String(env.WAHA_SESSION||'default')
 const origins=String(env.WAHA_ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)
 if(!raw||!key||!origins.length)return {ok:false,reason:'missing_gateway_environment'}
 if(!/^[-\\w]{1,50}$/.test(session))return {ok:false,reason:'invalid_session_name'}
 try{
  const url=new URL(raw)
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.port||!url.hostname.includes('.')||!origins.includes(url.origin))return {ok:false,reason:'unsafe_gateway_origin'}
  if(/^(localhost|127\\.|10\\.|192\\.168\\.|172\\.(1[6-9]|2\\d|3[01])\\.)/i.test(url.hostname))return {ok:false,reason:'unsafe_gateway_origin'}
  return {ok:true,origin:url.origin,session}
 }catch{return {ok:false,reason:'invalid_gateway_url'}}
}

export async function inspectWahaGateway(env=process.env,fetchImpl=fetch){
 const config=validateWahaReadinessEnvironment(env)
 if(!config.ok)return {ready:false,reason:config.reason}
 try{
  const response=await fetchImpl(config.origin+'/api/sessions/'+encodeURIComponent(config.session),{
   method:'GET',
   headers:{'X-Api-Key':String(env.WAHA_API_KEY),'Accept':'application/json'},
   redirect:'error',
   signal:AbortSignal.timeout(10000)
  })
  if(!response.ok)return {ready:false,reason:'gateway_http_'+response.status}
  const payload=await response.json()
  const status=String(payload?.status||'UNKNOWN').slice(0,40)
  return {ready:status==='WORKING',session:config.session,status,reason:status==='WORKING'?'session_connected':'session_not_working'}
 }catch{return {ready:false,reason:'gateway_connection_failed'}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 inspectWahaGateway().then(result=>{
  console.log(JSON.stringify(result))
  if(!result.ready)process.exitCode=1
 }).catch(()=>{console.log(JSON.stringify({ready:false,reason:'diagnostic_failed'}));process.exitCode=1})
}
