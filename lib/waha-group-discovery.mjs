// Read-only WAHA data normalization. Never infer a recipient from an invite code.
const GROUP_ID=/^[0-9][0-9-]{5,48}@g\.us$/i;
const obj=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const str=x=>typeof x==='string'?x:'';
export function wahaGroupJid(value){
 if(typeof value==='string')return GROUP_ID.test(value)?value:'';
 if(!obj(value))return '';
 const direct=[value._serialized,value.id,value.groupId,value.jid,value.groupJid,value.group_id,value.JID];
 for(const x of direct){
  if(typeof x==='string'&&GROUP_ID.test(x))return x;
  if(obj(x)){
   const nested=wahaGroupJid(x);
   if(nested)return nested;
  }
 }
 const user=str(value.user||value.User||value.id?.user);
 const server=str(value.server||value.Server||value.id?.server);
 if(user&&server&&GROUP_ID.test(user+'@'+server))return user+'@'+server;
 return '';
}
export function wahaGroupName(value){
 if(!obj(value))return '';
 const vals=[value.subject,value.name,value.title,value.Subject,value.Name,value.groupName,value.groupSubject,value._data?.subject,value.info?.subject,value.group?.subject];
 return vals.find(x=>typeof x==='string'&&x.trim())?.trim()||'';
}
function entriesFor(value){
 if(Array.isArray(value))return value.map(v=>['',v]);
 if(!obj(value))return [];
 return Object.entries(value);
}
// Prefer explicit WAHA wrappers first, then a bounded generic traversal for versions that
// use "results", "records", "groupMetadata", or an object keyed by group JIDs.
export function parseWahaGroups(raw){
 if(!obj(raw)&&!Array.isArray(raw))return {recognized:false,items:[]};
 const seenIds=new Set(),items=[];
 const walked=new Set();
 const queue=[[raw,0,'']];
 while(queue.length){
  const [current,depth,key]=queue.shift();
  if(!obj(current)&&!Array.isArray(current))continue;
  if(walked.has(current))continue;
  walked.add(current);
  if(depth>4)continue;
  const id=wahaGroupJid(current)||(GROUP_ID.test(key)?key:'');
  if(id&&!seenIds.has(id)){
   seenIds.add(id);
   items.push({id,name:wahaGroupName(current)});
  }
  if(depth===4)continue;
  for(const [childKey,child] of entriesFor(current)){
   if((obj(child)||Array.isArray(child))&&queue.length<2500)queue.push([child,depth+1,childKey]);
  }
 }
 return {recognized:true,items};
}
export function parseWahaChats(raw){return parseWahaGroups(raw).items}
export function groupMatches(items,labels=['RFQ','PO','General']){
 const wanted=new Set(labels.map(x=>x.trim().toUpperCase()));
 return items.filter(g=>wanted.has(String(g.name||'').trim().toUpperCase()));
}
// Only field TYPES/NAMES, never ids, invite tokens, phone numbers, group messages or
// raw response bodies: safe to show in admin diagnostics and Railway logs.
const maskKey=k=>/(@g\.us|@c\.us|@lid|\d{8,})/i.test(k)?'[identifier]':String(k).slice(0,35);
const shapeType=x=>Array.isArray(x)?'array':x===null?'null':typeof x;
export function wahaResponseShape(raw){
 const rootType=shapeType(raw);
 const level=obj(raw)?Object.entries(raw):Array.isArray(raw)?raw.slice(0,6).map((v,i)=>[String(i),v]):[];
 const candidates=level.filter(([,v])=>obj(v)||Array.isArray(v));
 const preview=candidates.slice(0,2).map(([key,value])=>{
  const first=Array.isArray(value)?value[0]:obj(value)?Object.values(value)[0]:null;
  return {field:maskKey(key),type:shapeType(value),size:Array.isArray(value)?value.length:obj(value)?Object.keys(value).length:0,
   childKeys:obj(value)?Object.keys(value).slice(0,10).map(maskKey):[],sampleKeys:obj(first)?Object.keys(first).slice(0,10).map(maskKey):[]};
 });
 return {type:rootType,keys:level.slice(0,12).map(([key])=>maskKey(key)),entryCount:level.length,preview};
}
