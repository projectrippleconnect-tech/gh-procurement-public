// Server-only WAHA endpoint configuration. Never use this in client components.
// Keep legacy private Railway connectivity while supporting explicitly approved
// HTTPS gateways without allowing arbitrary public or internal network targets.
const PUBLIC_DNS=/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i

export function gatewayConfig(env=process.env){
 const raw=env.WAHA_BASE_URL||''
 const key=env.WAHA_API_KEY||''
 const session=env.WAHA_SESSION||'default'
 if(!raw||!key||!/^[\w-]{1,50}$/.test(session))return null
 try{
  const url=new URL(raw)
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null
  const host=url.hostname.toLowerCase()
  const railwayPrivate=url.protocol==='http:'&&host.endsWith('.railway.internal')
  const localDev=url.protocol==='http:'&&env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(host)
  // Public HTTPS requires an exact hostname explicitly configured by the operator.
  // Never allow wildcards, raw IPs, localhost or a private-network suffix.
  const approvedHost=String(env.WAHA_ALLOWED_HOST||'').trim().toLowerCase()
  const publicHttps=url.protocol==='https:'&&(!url.port||url.port==='443')&&
   PUBLIC_DNS.test(host)&&approvedHost===host&&!host.endsWith('.internal')
  if(!railwayPrivate&&!localDev&&!publicHttps)return null
  return {base:url.origin,key,session}
 }catch{return null}
}
