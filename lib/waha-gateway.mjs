// Server configuration only. Never accept the gateway origin from request input.
export function approvedGatewayUrl(raw,env=process.env,{allowLoopback=false}={}){
 try{
  const u=new URL(raw)
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null
  const privateHost=/\.railway\.internal$/.test(u.hostname)
  const loopback=allowLoopback&&['localhost','127.0.0.1'].includes(u.hostname)
  const relay=u.protocol==='https:'&&env.GH_WAHA_HTTPS_ORIGIN===u.origin
  if(!relay&&!((privateHost||loopback)&&['http:','https:'].includes(u.protocol)))return null
  return u
 }catch{return null}
}
