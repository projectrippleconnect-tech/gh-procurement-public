// Read-only administrator diagnostics. This route never joins groups, sends messages, or configures archive destinations.
import {createClient} from '@supabase/supabase-js'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const reply=(data:object,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
const groupIdPattern=/^[0-9][0-9-]{5,48}@g\.us$/
const desired=new Set(['RFQ','PO','General'])
const tidy=(data:any):any[]=>Array.isArray(data)?data:Array.isArray(data?.items)?data.items:Array.isArray(data?.data)?data.data:[]
const groupId=(g:any)=>String(g?.id?._serialized||g?.id||g?.groupId||'')
const groupName=(g:any)=>String(g?.subject||g?.name||g?._data?.subject||'').trim()
function gateway(){
 const raw=process.env.WAHA_BASE_URL||'',key=process.env.WAHA_API_KEY||'',session=process.env.WAHA_SESSION||'default'
 if(!raw||!key||!/^[\w-]{1,50}$/.test(session))return null
 try{const u=new URL(raw)
  if(u.protocol!=='http:'||!u.hostname.endsWith('.railway.internal')||u.username||u.password||u.pathname!=='/'||u.search||u.hash)return null
  return {base:u.origin,key,session}
 }catch{return null}
}
async function read(base:string,path:string,key:string){
 const r=await fetch(base+path,{headers:{'X-Api-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(7000),cache:'no-store'})
 if(!r.ok)throw new Error('WAHA response '+r.status)
 return r.json()
}
export async function GET(request:Request){
 const token=(request.headers.get('Authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]
 if(!token)return reply({ok:false,error:'Sign in as administrator to inspect WhatsApp groups.'},401)
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,anon=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 if(!url||!anon)return reply({ok:false,error:'Procurement authentication is unavailable.'},503)
 const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data:{user},error:userError}=await auth.auth.getUser(token)
 if(userError||!user)return reply({ok:false,error:'Sign in again.'},401)
 const db=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}})
 const {data:profile,error:profileError}=await db.from('proc_profiles').select('role,active').eq('id',user.id).maybeSingle()
 if(profileError)return reply({ok:false,error:'Could not check administrator access.'},503)
 if(profile?.role!=='admin'||!profile.active)return reply({ok:false,error:'Administrator access required.'},403)
 const config=gateway()
 if(!config)return reply({ok:false,error:'The private WAHA gateway is not configured.'},503)
 try{
  const state=await read(config.base+'/api/sessions/',encodeURIComponent(config.session),config.key)
  if(state?.status!=='WORKING')return reply({ok:false,connected:false,error:'WAHA session is not connected.'},503)
  const found=new Map<string,{id:string;name:string}>()
  for(let offset=0;offset<=100;offset+=50){
   const list=tidy(await read(config.base,'/api/'+encodeURIComponent(config.session)+'/groups?limit=50&offset='+offset+'&exclude=participants',config.key))
   for(const item of list){
    const id=groupId(item),name=groupName(item)
    if(groupIdPattern.test(id)&&desired.has(name)&&!found.has(id))found.set(id,{id,name})
   }
   if(list.length<50)break
  }
  const results:Array<{name:string;id:string;memberCount:number|null;memberIds:string[];reason:string}>=[]
  for(const item of found.values()){
   let count:number|null=null,memberIds:string[]=[],reason='not_verified'
   try{
    const p=await read(config.base,'/api/'+encodeURIComponent(config.session)+'/groups/'+encodeURIComponent(item.id)+'/participants/v2',config.key)
    const members=tidy(p).filter(x=>!['left','removed'].includes(String(x?.role||'').toLowerCase()))
    memberIds=members.map(x=>String(x?.id?._serialized||x?.id||'')).filter(Boolean)
    count=members.length
    reason=count===0?'no_members_returned':count===1?'only_your_account_reported':'check_each_member'
   }catch{reason='participant_check_unavailable'}
   results.push({name:item.name,id:item.id,memberCount:count,memberIds,reason})
  }
  results.sort((a,b)=>['RFQ','PO','General'].indexOf(a.name)-['RFQ','PO','General'].indexOf(b.name))
  return reply({ok:true,connected:true,readOnly:true,archiveEnabled:process.env.GH_WA_AUDIT_ENABLED==='true',groups:results,
   missing:['RFQ','PO'].filter(name=>!results.some(group=>group.name===name)),notice:'No group messages were sent. Check group membership manually before enabling copies.'})
 }catch{return reply({ok:false,connected:false,error:'Unable to read WAHA groups. Try again after the WhatsApp session has synchronized.'},503)}
}
