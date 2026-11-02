// Server-only WAHA endpoint configuration. Never use this in client components.
// Keep legacy private Railway connectivity while supporting explicitly approved
// HTTPS gateways without allowing arbitrary public or internal network targets.
const PUBLIC_DNS=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

function resolveGateway(env){
 const raw=env.WAHA_BASE_URL||''
 const key=env.WAHA_API_KEY||''
 const session=env.WAHA_SESSION||'default'
 if(!raw)return {config:null,issue:'WAHA_BASE_URL_MISSING'}
 if(!key)return {config:null,issue:'WAHA_API_KEY_MISSING'}
 if(!/^[\w-]{1,50}$/.test(session))return {config:null,issue:'WAHA_SESSION_INVALID'}
 try{
  const url=new URL(raw)
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return {config:null,issue:'WAHA_BASE_URL_INVALID'}
  const host=url.hostname.toLowerCase()
  const railwayPrivate=url.protocol==='http:'&&host.endsWith('.railway.internal')
  const localDev=url.protocol==='http:'&&env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(host)
  // Public HTTPS requires an exact hostname explicitly configured by the operator.
  // Never allow wildcards, raw IPs, localhost or a private-network suffix.
  const approvedHost=String(env.WAHA_ALLOWED_HOST||'').trim().toLowerCase()
  const publicHttps=url.protocol==='https:'&&(!url.port||url.port==='443')&&
   PUBLIC_DNS.test(host)&&approvedHost===host&&!host.endsWith('.internal')
  if(!railwayPrivate&&!localDev&&!publicHttps){
   const issue=url.protocol==='https:'&&PUBLIC_DNS.test(host)&&!host.endsWith('.internal')&&
    (!url.port||url.port==='443')&&approvedHost!==host?'WAHA_ALLOWED_HOST_MISMATCH':'WAHA_BASE_URL_NOT_ALLOWED'
   return {config:null,issue}
  }
  return {config:{base:url.origin,key,session},issue:null}
 }catch{return {config:null,issue:'WAHA_BASE_URL_INVALID'}}
}

export function gatewayConfig(env=process.env){
 return resolveGateway(env).config
}

// Safe administrator-only diagnostics. Returns a reason code, never an environment value.
export function gatewayConfigIssue(env=process.env){
 return resolveGateway(env).issue
}
