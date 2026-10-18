// Server-only parsing of user-provided WhatsApp invite URLs for read-only WAHA join-info.
// No join-group requests or messages are performed by this helper.
const ID=/^[0-9][0-9-]{5,48}@g\.us$/;
const CODE=/^[A-Za-z0-9]{14,32}$/;
const own=(x,k)=>!!x&&Object.prototype.hasOwnProperty.call(x,k);
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function inviteCodes(raw){
 const seen=new Set();
 const chunks=String(raw||'').split(/[\s,;\n\r]+/);
 for(const chunk of chunks){
  let code=chunk.trim();
  if(!code)continue;
  if(code.startsWith('https://chat.whatsapp.com/')){
   try{
    const u=new URL(code);
    if(u.hostname!=='chat.whatsapp.com'||u.protocol!=='https:')continue;
    code=u.pathname.split('/').filter(Boolean)[0]||'';
   }catch{continue}
  }
  if(CODE.test(code))seen.add(code);
  if(seen.size>=6)break;
 }
 return [...seen];
}
export function normalizeInviteInfo(value){
 const candidates=[value,value?.data,value?.group,value?.info,value?.result].filter(obj);
 for(const item of candidates){
  const rawId=item?.id?._serialized||item?.id||item?.groupId||item?.groupJid||item?.jid||item?.gid||item?.group?.id;
  const id=typeof rawId==='string'?rawId:'';
  const name=String(item?.subject||item?.name||item?.groupName||item?.title||item?.groupSubject||'').trim();
  const size=item?.size??item?.participantCount??item?.participantsCount??item?.participants?.length??null;
  const isCommunity=item?.isCommunity===true||item?.isCommunityAnnounce===true||item?.community===true;
  if(ID.test(id))return {id,name,memberCount:size!==null&&size!==undefined&&Number.isInteger(Number(size))&&Number(size)>=0?Number(size):null,isCommunity};
 }
 return null;
}
export function preferredInviteRoles(info){
 if(!info||!info.id)return null;
 const normalized=String(info.name||'').trim().toUpperCase();
 return normalized==='RFQ'||normalized==='PO'||normalized==='GENERAL'?normalized:null;
}
