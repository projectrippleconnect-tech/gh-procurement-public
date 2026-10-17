// Server-only WAHA staff archive. Fail closed on unknown destinations or group members.
// This module must never run in a browser or automatically resend an uncertain message.
const groupPattern=/^[0-9][0-9-]{5,48}@g\.us$/;
const normalizeId=value=>{
 const str=String(value??'').trim().replace(/^\+/,'');
 if(/^\d{7,16}$/.test(str))return str+'@c.us';
 if(/^\d{7,16}@s\.whatsapp\.net$/.test(str))return str.replace('@s.whatsapp.net','@c.us');
 if(/^\d{7,16}@(c\.us|lid)$/.test(str))return str;
 return null;
};
const unique=list=>[...new Set(list)];
export function privateGroupConfig(env=process.env){
 if(env.GH_WA_AUDIT_ENABLED!=='true')return {ready:false,reason:'not_enabled'};
 const groupId=String(env.GH_WA_AUDIT_GROUP_ID||'').trim();
 const groupName=String(env.GH_WA_AUDIT_GROUP_NAME||'GH Procurement').trim();
 const raw=String(env.GH_WA_AUDIT_ALLOWED_MEMBERS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const approved=unique(raw.map(normalizeId));
 if(!groupPattern.test(groupId)||!groupName||groupName.length>100||approved.length<2||approved.some(x=>!x)||approved.length!==raw.length)return {ready:false,reason:'invalid_group_configuration'};
 return {ready:true,groupId,groupName,approved};
}
export function inspectPrivateGroup({group,participants,config}){
 if(!config?.ready)return {ok:false,reason:'invalid_group_configuration'};
 const id=String(group?.id?._serialized||group?.id||group?.groupId||'');
 const name=String(group?.subject||group?.name||group?._data?.subject||'').trim();
 if(id!==config.groupId||name!==config.groupName)return {ok:false,reason:'group_identity_changed'};
 const members=Array.isArray(participants)?participants:Array.isArray(participants?.participants)?participants.participants:null;
 if(!members||members.length<2)return {ok:false,reason:'membership_unavailable'};
 const found=unique(members.filter(x=>!['left','removed'].includes(String(x.role||'').toLowerCase())).map(x=>normalizeId(x.id?._serialized||x.id||x.participant?.id)));
 if(found.some(x=>!x)||found.length!==config.approved.length||found.some(x=>!config.approved.includes(x))||config.approved.some(x=>!found.includes(x)))return {ok:false,reason:'membership_changed'};
 return {ok:true,reason:'verified'};
}
export function privateGroupCaption({kind,number,supplier,dispatchId,originalCaption,at=new Date().toISOString()}){
 const tag=kind==='po'?'PURCHASE ORDER':'RFQ';
 const original=String(originalCaption||'').replace(/[\u0000-\u001f]/g,' ').slice(0,1000);
 return ['GH Procurement — PRIVATE STAFF AUDIT',tag+': '+String(number||'Unknown').slice(0,80),'Supplier: '+String(supplier||'Unknown').slice(0,120),'Supplier gateway: ACCEPTED (not delivery confirmation)','Time UTC: '+at,'Dispatch: '+String(dispatchId||'').slice(0,60),original?'Supplier caption: '+original:''].filter(Boolean).join('\n').slice(0,2000);
}
async function readWaha(url,key){
 const response=await fetch(url,{headers:{'X-Api-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(4000),cache:'no-store'});
 if(!response.ok)throw new Error('WhatsApp group verification unavailable');
 return response.json();
}
export async function mirrorStaffGroupCopy({db,config,kind,supplierDispatchId,session,base,key,base64,filename,caption,imageHash}){
 // The caller has already verified and finished a successful supplier dispatch.
 // Group sharing is entirely optional, isolated, and server-controlled.
 const policy=privateGroupConfig();
 if(!policy.ready)return {status:'disabled',reason:policy.reason};
 let audit;
 try{
  const scope=base+'/api/'+encodeURIComponent(session)+'/groups/'+encodeURIComponent(policy.groupId);
  const group=await readWaha(scope,key);
  const participants=await readWaha(scope+'/participants/v2',key);
  const checked=inspectPrivateGroup({group,participants,config:policy});
  if(!checked.ok)return {status:'blocked',reason:checked.reason};
 }catch{return {status:'blocked',reason:'group_verification_failed'};}
 try{
  const result=await db.rpc('proc_whatsapp_claim_private_group_copy',{
   p_kind:kind,p_supplier_dispatch_id:supplierDispatchId,p_group_id:policy.groupId,p_session:session,p_image_sha256:imageHash,p_caption:caption
  });
  if(result.error){
   if(result.error.code==='23505')return {status:'already_recorded',reason:'duplicate_blocked'};
   return {status:'unavailable',reason:'audit_database_not_ready'};
  }
  audit=result.data;
  if(!audit)return {status:'unavailable',reason:'audit_claim_not_confirmed'};
 }catch{return {status:'unavailable',reason:'audit_database_unavailable'};}
 let status='unknown',messageId=null,detail=null;
 try{
  const result=await fetch(base+'/api/sendImage',{
   method:'POST',
   headers:{'X-Api-Key':key,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({session,chatId:policy.groupId,file:{mimetype:'image/png',filename:String(filename||'GH-Procurement.png').replace(/[^A-Za-z0-9._-]/g,'-').slice(0,100),data:base64},caption}),
   signal:AbortSignal.timeout(12000),cache:'no-store'
  });
  if(result.ok){
   const body=await result.json().catch(()=>({}));
   const value=body?.id?._serialized||body?.id||body?.key?.id;
   messageId=typeof value==='string'?value.slice(0,200):null;
   status='accepted';
  }else{
   status=result.status>=500?'unknown':'failed';
   detail='WAHA rejected private group copy, status '+result.status;
  }
 }catch{detail='Gateway response uncertain; never retry this group copy blindly';}
 try{
  const result=await db.rpc('proc_whatsapp_finish_private_group_copy',{p_id:audit,p_status:status,p_message_id:messageId,p_error:detail});
  if(result.error||result.data!==true)return {status:'unknown',reason:'audit_finish_unconfirmed'};
 }catch{return {status:'unknown',reason:'audit_finish_unavailable'};}
 return {status,reason:status==='accepted'?'gateway_accepted_not_delivery':status==='unknown'?'check_group_before_retry':'gateway_rejected'};
}
