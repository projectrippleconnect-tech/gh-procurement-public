// WhatsApp invite link metadata lookup (GET only; never joins).
import {wahaGroupJid,wahaGroupName} from './waha-group-discovery.mjs';
const CODE=/^[A-Za-z0-9]{14,32}$/;
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
export function inviteCodes(raw){
 const codes=new Set();
 for(const chunk of String(raw||'').split(/[\s,;\r\n]+/)){
  let code=chunk.trim();
  if(!code)continue;
  if(code.startsWith('https://chat.whatsapp.com/')){
   try{
    const url=new URL(code);
    if(url.hostname!=='chat.whatsapp.com'||url.protocol!=='https:')continue;
    code=url.pathname.split('/').filter(Boolean)[0]||'';
   }catch{continue}
  }
  if(CODE.test(code))codes.add(code);
  if(codes.size>=6)break;
 }
 return [...codes];
}
export function normalizeInviteInfo(value){
 if(!obj(value)&&!Array.isArray(value))return null;
 const visited=new Set(),queue=[[value,0]],found=[];
 while(queue.length){
  const [entry,level]=queue.shift();
  if(!obj(entry)&&!Array.isArray(entry)||visited.has(entry)||level>4)continue;
  visited.add(entry);
  if(obj(entry)){
   const id=wahaGroupJid(entry);
   if(id){
    const name=wahaGroupName(entry);
    const rawSize=entry.size??entry.participantCount??entry.participantsCount??entry.participants?.length??null;
    const isCommunity=entry.isCommunity===true||entry.isCommunityAnnounce===true||entry.community===true||entry.IsCommunity===true||entry.groupType==='community';
    found.push({id,name,memberCount:rawSize!==null&&rawSize!==undefined&&Number.isInteger(Number(rawSize))&&Number(rawSize)>=0?Number(rawSize):null,isCommunity});
   }
  }
  if(level<4)for(const next of Array.isArray(entry)?entry:Object.values(entry))if((obj(next)||Array.isArray(next))&&queue.length<300)queue.push([next,level+1]);
 }
 if(!found.length)return null;
 const preferred=found.filter(x=>['RFQ','PO','GENERAL'].includes(x.name.toUpperCase())||x.isCommunity);
 return (preferred.length?preferred:found).sort((a,b)=>Number(Boolean(b.name))-Number(Boolean(a.name)))[0];
}
export function preferredInviteRoles(info){
 if(!info?.id)return null;
 const name=String(info.name||'').trim().toUpperCase();
 return ['RFQ','PO','GENERAL'].includes(name)?name:null;
}
