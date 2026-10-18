// Server-only WAHA staff archive. Fail closed on unknown destinations or group members.
import {wahaGroupJid,wahaGroupName} from './waha-group-discovery.mjs';
// This module must never run in a browser or automatically resend an uncertain message.
const groupPattern=/^[0-9][0-9-]{5,48}@g\.us$/;
const normalizeId=value=>{
 const object=value&&typeof value==='object';
 const nested=object?(value._serialized||value.id||value.JID||value.jid||null):null;
 const raw=typeof nested==='string'?nested:object&&typeof (value.user||value.User)==='string'&&typeof (value.server||value.Server)==='string'?(value.user||value.User)+'@'+(value.server||value.Server):value;
 const str=String(raw??'').trim().replace(/^\+/,'');
 if(/^\d{7,16}$/.test(str))return str+'@c.us';
 if(/^\d{7,16}@s\.whatsapp\.net$/.test(str))return str.replace('@s.whatsapp.net','@c.us');
 if(/^\d{7,16}@(c\.us|lid)$/.test(str))return str;
 return null;
};
export const wahaMemberId=normalizeId;
const unique=list=>[...new Set(list)];
export function privateGroupConfig(env=process.env,kind='rfq'){
 if(env.GH_WA_AUDIT_ENABLED!=='true')return {ready:false,reason:'not_enabled'};
 const target=kind==='po'||kind==='company_po'?'PO':'RFQ';
 const groupId=String(env['GH_WA_AUDIT_'+target+'_GROUP_ID']||'').trim();
 const groupName=String(env['GH_WA_AUDIT_'+target+'_GROUP_NAME']||target).trim();
 const raw=String(env.GH_WA_AUDIT_ALLOWED_MEMBERS||'').split(',').map(x=>x.trim()).filter(Boolean);
 const ownerOnly=env.GH_WA_AUDIT_OWNER_ONLY==='true';
 const approved=unique(raw.map(normalizeId));
 if(!groupPattern.test(groupId)||!groupName||groupName.length>100||(!ownerOnly&&approved.length<1)||approved.some(x=>!x)||approved.length!==raw.length||(ownerOnly&&raw.length>0))return {ready:false,reason:'invalid_group_configuration'};
 return {ready:true,groupId,groupName,approved,ownerOnly};
}
// Resolve an owner's WhatsApp Linked ID only through the connected WAHA account.
export async function resolveOwnerMemberAliases({base,session,key,memberIds,sessionMe,read=readWaha}){
 const self=normalizeId(sessionMe?.id||sessionMe?.jid||sessionMe?.pn||sessionMe?.phoneNumber||sessionMe?.me?.id);
 if(!self||!Array.isArray(memberIds)||memberIds.length!==1)return {ok:false,reason:'linked_account_unknown'};
 const member=normalizeId(memberIds[0]);
 if(!member)return {ok:false,reason:'membership_unavailable'};
 if(member===self)return {ok:true,reason:'verified_owner_only'};
 const lid=member.endsWith('@lid')?member:self.endsWith('@lid')?self:null;
 const phone=member.endsWith('@c.us')?member:self.endsWith('@c.us')?self:null;
 if(!lid||!phone)return {ok:false,reason:'not_exclusive_owner_group'};
 try{
  const mapping=await read(base+'/api/'+encodeURIComponent(session)+'/lids/'+encodeURIComponent(lid),key);
  const mappedPhone=normalizeId(mapping?.pn||mapping?.phoneNumber||mapping?.phone);
  const mappedLid=normalizeId(mapping?.lid||mapping?.id);
  if(mappedPhone===phone&&mappedLid===lid)return {ok:true,reason:'verified_owner_only'};
 }catch{}
 return {ok:false,reason:'linked_identity_mapping_unavailable'};
}
export function inspectPrivateGroup({group,participants,config,sessionMe=null}){
 if(!config?.ready)return {ok:false,reason:'invalid_group_configuration'};
 const id=wahaGroupJid(group),name=wahaGroupName(group);
 if(id!==config.groupId||name!==config.groupName)return {ok:false,reason:'group_identity_changed'};
 const members=Array.isArray(participants)?participants:Array.isArray(participants?.participants)?participants.participants:null;
 if(!members||members.length<1)return {ok:false,reason:'membership_unavailable'};
 const found=unique(members.filter(x=>!['left','removed'].includes(String(x.role||'').toLowerCase())).map(x=>normalizeId(x.id||x.participant?.id||x.JID)));
 if(found.some(x=>!x)||found.length!==members.length)return {ok:false,reason:'membership_unavailable'};
 if(config.ownerOnly){
  const self=normalizeId(sessionMe?.id||sessionMe?.jid||sessionMe?.pn||sessionMe?.phoneNumber||sessionMe?.me?.id);
  if(!self)return {ok:false,reason:'linked_account_unknown'};
  if(found.length!==1)return {ok:false,reason:'not_exclusive_owner_group'};
  if(found[0]===self)return {ok:true,reason:'verified_owner_only'};
  // GOWS exposes a verified participant.pn for some @lid members. Accept
  // that mapping only for the *same* sole @lid participant, never for a third party.
  const sole=members[0];
  const pn=normalizeId(sole?.pn||sole?.phoneNumber||sole?.participant?.pn);
  if(found[0].endsWith('@lid')&&self.endsWith('@c.us')&&pn===self)
   return {ok:true,reason:'verified_owner_only'};
  return {ok:false,reason:'not_exclusive_owner_group'};
 }
 if(found.length!==config.approved.length||found.some(x=>!config.approved.includes(x))||config.approved.some(x=>!found.includes(x)))return {ok:false,reason:'membership_changed'};
 return {ok:true,reason:'verified'};
}
export function privateGroupCaption({kind,number,supplier,dispatchId,originalCaption,at=new Date().toISOString()}){
 const tag=kind==='po'||kind==='company_po'?'PURCHASE ORDER':'RFQ';
 const original=String(originalCaption||'').replace(/[\u0000-\u001f]/g,' ').slice(0,1000);
 return ['GH Procurement — PRIVATE STAFF AUDIT',tag+': '+String(number||'Unknown').slice(0,80),'Supplier: '+String(supplier||'Unknown').slice(0,120),'Supplier gateway: ACCEPTED (not delivery confirmation)','Time UTC: '+at,'Dispatch: '+String(dispatchId||'').slice(0,60),original?'Supplier caption: '+original:''].filter(Boolean).join('\n').slice(0,2000);
}
async function readWaha(url,key){
 const response=await fetch(url,{headers:{'X-Api-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(4000),cache:'no-store'});
 if(!response.ok)throw new Error('WhatsApp group verification unavailable');
 return response.json();
}
export async function mirrorStaffGroupCopy({db,kind,sourceId,pageNumber=1,session,base,key,base64,filename,caption,imageHash}){
 // The caller has already verified and finished a successful supplier dispatch.
 // Group sharing is entirely optional, isolated, and server-controlled.
 const policy=privateGroupConfig(process.env,kind);
 if(!policy.ready)return {status:'disabled',reason:policy.reason};
 let audit;
 try{
  const scope=base+'/api/'+encodeURIComponent(session)+'/groups/'+encodeURIComponent(policy.groupId);
  const group=await readWaha(scope,key);
  const participants=await readWaha(scope+'/participants/v2',key);
  const sessionMe=policy.ownerOnly?await readWaha(base+'/api/sessions/'+encodeURIComponent(session)+'/me',key):null;
  const memberList=Array.isArray(participants)?participants:Array.isArray(participants?.participants)?participants.participants:[];
  let checked=inspectPrivateGroup({group,participants,config:policy,sessionMe});
  if(policy.ownerOnly&&checked.reason==='not_exclusive_owner_group'&&memberList.length===1){
   const alias=await resolveOwnerMemberAliases({base,session,key,sessionMe,memberIds:memberList.map(x=>x.id?._serialized||x.id)});
   if(alias.ok)checked={ok:true,reason:'verified_owner_only'};
  }
  if(!checked.ok)return {status:'blocked',reason:checked.reason};
 }catch{return {status:'blocked',reason:'group_verification_failed'};}
 try{
  const result=await db.rpc('proc_whatsapp_claim_private_group_copy',{
   p_kind:kind,p_source_id:sourceId,p_page:pageNumber,p_group_id:policy.groupId,p_session:session,p_image_sha256:imageHash,p_caption:caption
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
