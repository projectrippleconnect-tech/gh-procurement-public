// Normalization for WAHA's engine-dependent GET /groups response.
// GOWS and NOWEB may return objects keyed by 120...@g.us instead of arrays.
const GROUP_ID=/^[0-9][0-9-]{5,48}@g\.us$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const groupId=v=>String(v?.id?._serialized||v?.id||v?.groupId||v?.jid||'');
const groupName=v=>String(v?.subject||v?.name||v?.title||v?._data?.subject||'').trim();
export function parseWahaGroups(raw){
 let entries;
 if(Array.isArray(raw))entries=raw.map(v=>[null,v]);
 else if(Array.isArray(raw?.items))entries=raw.items.map(v=>[null,v]);
 else if(Array.isArray(raw?.data))entries=raw.data.map(v=>[null,v]);
 else if(Array.isArray(raw?.groups))entries=raw.groups.map(v=>[null,v]);
 else if(object(raw)&&object(raw?.groups))entries=Object.entries(raw.groups);
 else if(object(raw)&&object(raw?.data))entries=Object.entries(raw.data);
 else if(object(raw))entries=Object.entries(raw);
 else return {recognized:false,items:[]};
 const items=[];
 for(const [key,value] of entries){
  if(!object(value))continue;
  const id=groupId(value)||(GROUP_ID.test(String(key||''))?String(key):'');
  if(!GROUP_ID.test(id))continue;
  items.push({id,name:groupName(value)});
 }
 return {recognized:true,items};
}
export function parseWahaChats(raw){
 let list;
 if(Array.isArray(raw))list=raw;
 else if(Array.isArray(raw?.items))list=raw.items;
 else if(Array.isArray(raw?.data))list=raw.data;
 else return [];
 return list.filter(object).map(v=>({id:groupId(v),name:groupName(v)}))
  .filter(v=>GROUP_ID.test(v.id));
}
export function groupMatches(items,labels=['RFQ','PO','General']){
 const wanted=new Set(labels.map(s=>s.toUpperCase()));
 return items.filter(g=>wanted.has(String(g.name||'').trim().toUpperCase()));
}
