// Server-only configuration. Never accept a gateway URL from a browser request.
// Cross-host deployments require HTTPS and an exact server-managed origin pin.
export function wahaGatewayConfig(env=process.env){
 const raw=env.WAHA_BASE_URL||'',key=env.WAHA_API_KEY||'',session=env.WAHA_SESSION||'default'
 if(!raw||!key||!/^[-\w]{1,50}$/.test(session))return null
 try{
  const url=new URL(raw)
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null
  const privateHost=url.hostname.endsWith('.railway.internal')||['localhost','127.0.0.1'].includes(url.hostname)
  if(privateHost){
   if(!['http:','https:'].includes(url.protocol))return null
  }else{
   if(url.protocol!=='https:'||!url.hostname.includes('.')||/[\[\]:]/.test(url.hostname)||/^[\d.]+$/.test(url.hostname)||/\.(internal|local|localhost|test|invalid)$/.test(url.hostname))return null
   const approved=String(env.WAHA_ALLOWED_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean)
   if(!approved.includes(url.origin))return null
  }
  return {base:url.origin,key,session}
 }catch{return null}
}
