// Read-only administrator diagnostics. This route never joins groups, sends messages, or configures archive destinations.
import {createClient} from '@supabase/supabase-js'
import {parseWahaGroups,parseWahaChats,groupMatches,wahaResponseShape} from '@/lib/waha-group-discovery.mjs'
import {inviteCodes,normalizeInviteInfo,preferredInviteRoles} from '@/lib/waha-invite-info.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const reply=(data:object,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
const desired=['RFQ','PO','General']
const tidy=(data:any):any[]=>Array.isArray(data)?data:Array.isArray(data?.participants)?data.participants:Array.isArray(data?.items)?data.items:Array.isArray(data?.data)?data.data:[]
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
  let groupCount:number|null=null
  try{
   const count=await read(config.base,'/api/'+encodeURIComponent(config.session)+'/groups/count',config.key)
   if(Number.isInteger(count?.count)&&count.count>=0)groupCount=count.count
  }catch{}
  const found=new Map<string,{id:string;name:string}>()
  const seen=new Set<string>()
  let totalListed=0,nameless=0,recognized=false,source='groups'
  let firstResponseShape:ReturnType<typeof wahaResponseShape>|null=null
  // WAHA GOWS/NOWEB responses vary by engine: array, wrapped list, or a map keyed by group ID.
  // Only interpret a response as genuinely empty after determining its shape.
  for(let offset=0;offset<500;offset+=50){
   const raw=await read(config.base,'/api/'+encodeURIComponent(config.session)+'/groups?limit=50&offset='+offset+'&sortBy=id&sortOrder=desc&exclude=participants',config.key)
   if(offset===0)firstResponseShape=wahaResponseShape(raw)
   const parsed=parseWahaGroups(raw)
   if(!parsed.recognized)return reply({ok:false,error:'WAHA returned an unrecognized group-list format; no destination has been selected.'},502)
   recognized=true
   const fresh=parsed.items.filter(group=>!seen.has(group.id))
   if(!fresh.length)break
   for(const item of fresh){seen.add(item.id);totalListed++;if(!item.name)nameless++}
   for(const item of groupMatches(fresh,desired))if(!found.has(item.id))found.set(item.id,item)
   if(parsed.items.length<50)break
  }
  if(!found.size&&nameless>0){
   // WAHA may list newly-created community subgroups without subjects.
   // Re-fetch only a small number of incomplete records; never mutate the group.
   for(const id of [...seen].slice(0,20)){
    try{
     const metadata=await read(config.base,'/api/'+encodeURIComponent(config.session)+'/groups/'+encodeURIComponent(id),config.key)
     const named=groupMatches(parseWahaGroups({[id]:metadata}).items,desired)
     if(named.length&&!found.has(id))found.set(id,named[0])
    }catch{}
   }
  }
  if(!found.size){
   // Chats can contain subgroup names after WhatsApp creation even before group
   // metadata has synchronized. Inspect only read-only chat names, never messages.
   try{
    for(let offset=0;offset<200;offset+=50){
     const chats=await read(config.base,'/api/'+encodeURIComponent(config.session)+'/chats?limit=50&offset='+offset+'&sortBy=messageTimestamp&sortOrder=desc',config.key)
     const list=parseWahaChats(chats)
     for(const g of groupMatches(list,desired))if(!found.has(g.id))found.set(g.id,g)
     if(tidy(chats).length<50)break
    }
    if(found.size)source='chats'
   }catch{}
  }
  // Invite previews are read-only WAHA GETs. Codes are server-only temporary inputs;
  // never reveal the links or make a join request.
  const codes=inviteCodes(process.env.GH_WA_AUDIT_PENDING_INVITE_CODES||'')
  const invitePreviews:Array<{slot:number;id:string|null;name:string|null;memberCount:number|null;isCommunity:boolean;status:string;responseShape?:ReturnType<typeof wahaResponseShape>}>=[]
  for(const [i,code] of codes.entries()){
   try{
    const replyData=await read(config.base,
     '/api/'+encodeURIComponent(config.session)+'/groups/join-info?code='+encodeURIComponent(code),config.key)
    const info=normalizeInviteInfo(replyData)
    if(info){
     const role=preferredInviteRoles(info)
     invitePreviews.push({slot:i+1,id:info.id,name:info.name||null,memberCount:info.memberCount,isCommunity:info.isCommunity,status:role?'recognized':'preview_only'})
     if(role&&!info.isCommunity&&!found.has(info.id)){
      found.set(info.id,{id:info.id,name:role==='GENERAL'?'General':role})
      source=source==='groups'?'groups_and_invites':source+'_and_invites'
     }
    }else invitePreviews.push({slot:i+1,id:null,name:null,memberCount:null,isCommunity:false,status:'unrecognized_reply',responseShape:wahaResponseShape(replyData)})
   }catch{invitePreviews.push({slot:i+1,id:null,name:null,memberCount:null,isCommunity:false,status:'lookup_unavailable'})}
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
   missing:['RFQ','PO'].filter(name=>!results.some(group=>group.name.toUpperCase()===name)),discovery:{source,listed:totalListed,nameless,recognized,groupCount,responseShape:firstResponseShape},invitePreviews,notice:'No group messages were sent. Check group membership manually before enabling copies.'})
 }catch{return reply({ok:false,connected:false,error:'Unable to read WAHA groups. Try again after the WhatsApp session has synchronized.'},503)}
}
