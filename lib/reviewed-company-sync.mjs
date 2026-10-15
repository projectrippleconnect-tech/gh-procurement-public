/** Strict, source-key-only matching for reviewed COMPANY ITEMS labels. Never creates items. */
export const COMPANY_SOURCE_COLUMNS={
 'PANEL SHEETS':5,'CEMENT BASED':2,'BOARD ITEMS':9,'REGIFOAM':2,'RUBBER HOSE':3,'ALCATHINE':3,
 'BIXTON':3,'BOLT & NUTS':6,'WURTH':2,'CASING':2,'PE+':2,'KOBE':3,'MULTI BOND':2,
 'KEVILTON':2,'ORANGE':2,'POLYCHROME':3,'FEVICOL':3,'ROCKER':2,'WIRE CABLES':6
}
const titleOf=s=>String(s||'').trim().toUpperCase()
const cell=(v,row,col)=>String(v?.[row]?.[col]??'').trim()
export function legacySheetValues(title,values){
 const width=COMPANY_SOURCE_COLUMNS[titleOf(title)]
 if(!width)throw new Error('Unknown company sheet: '+title)
 return (values||[]).map(row=>(row||[]).slice(0,width))
}
export function reviewedNameAt(title,values,r,c){
 const t=titleOf(title)
 let dest=null
 if(t==='PANEL SHEETS')dest=5+c-1
 else if(t==='BOARD ITEMS')dest=(r>=13&&r<=19)?9:9+c-2
 else if(t==='BIXTON')dest=3+c-1
 else if(t==='BOLT & NUTS'||t==='WIRE CABLES')dest=6+c-1
 else if(t==='KOBE')dest=(r>=15&&r<=19)?3+c-1:4
 else if(t==='RUBBER HOSE'||t==='ALCATHINE')dest=3+c-1
 else if(t==='POLYCHROME'||t==='FEVICOL')dest=3
 else if(t==='ROCKER')dest=2
 else if(['CEMENT BASED','REGIFOAM','WURTH','CASING','PE+','MULTI BOND','KEVILTON','ORANGE'].includes(t))dest=2
 return dest===null||dest<0?'':cell(values,r,dest)
}
export function reviewedCategoriesAt(title,values,r){
 const t=titleOf(title)
 if(t==='KEVILTON'||t==='ORANGE')return {main_group:cell(values,r,3),subgroup:cell(values,r,4)}
 if(t==='FEVICOL'||t==='POLYCHROME')return {main_group:cell(values,r,4),subgroup:cell(values,r,5)}
 if(t==='ROCKER')return {main_group:cell(values,r,3),subgroup:cell(values,r,4)}
 if(t==='WIRE CABLES')return {main_group:cell(values,r,11),subgroup:cell(values,r,12)}
 if(t==='MULTI BOND')return {subgroup:cell(values,r,3)}
 return {}
}
export function buildReviewedPlan({title,sheetId,values,parsedRows=[],links=[]}){
 const t=titleOf(title)
 if(!COMPANY_SOURCE_COLUMNS[t])throw new Error('Unrecognized workbook company')
 const active=links.filter(x=>x.active!==false&&x.item?.source==='COMPANY SHEET')
 const known=new Map(),conflicts=new Set()
 for(const x of active){
  if(!x.source_key)continue
  if(known.has(x.source_key))conflicts.add(x.source_key)
  else known.set(x.source_key,x)
 }
 const changes=[],unmatched=[],noName=[],unchanged=[],visited=new Set(),names=new Map()
 for(const row of parsedRows){
  if(visited.has(row.source_key)){unmatched.push({reason:'duplicate source identity',source_key:row.source_key});continue}
  visited.add(row.source_key)
  const p=String(row.source_position||'').split(':')
  if(p.length!==3||p.some(v=>!/^\\d+$/.test(v))||Number(p[0])!==Number(sheetId)){
   unmatched.push({reason:'invalid source cell',source_key:row.source_key});continue
  }
  const r=Number(p[1])-1,c=Number(p[2])-1
  const name=reviewedNameAt(t,values,r,c)
  if(!name){noName.push(row.source_key);continue}
  const link=known.get(row.source_key)
  if(!link||conflicts.has(row.source_key)){
   unmatched.push({source_key:row.source_key,source_position:row.source_position,name,reason:'No unique existing app item; manual review required'})
   continue
  }
  const item=link.item
  if(!item?.id||item.id!==link.item_id||name.length>220){
   unmatched.push({source_key:row.source_key,reason:'invalid linked item/name'});continue
  }
  const nameKey=name.toUpperCase()
  if(names.has(nameKey)&&names.get(nameKey)!==item.id){
   unmatched.push({source_key:row.source_key,reason:'duplicate reviewed name'});continue
  }
  names.set(nameKey,item.id)
  const categories=reviewedCategoriesAt(t,values,r),next={description:name}
  if(categories.main_group&&!/REVIEW|UNCONFIRMED/.test(categories.main_group))next.main_group=categories.main_group
  if(categories.subgroup&&!/REVIEW|UNCONFIRMED|CHECK DESCRIPTION/.test(categories.subgroup))next.subgroup=categories.subgroup
  const patch={}
  for(const [key,value] of Object.entries(next))if(String(item[key]??'').trim()!==value)patch[key]=value
  if(Object.keys(patch).length)changes.push({id:item.id,link_id:link.id,source_key:row.source_key,old:{description:item.description,main_group:item.main_group,subgroup:item.subgroup},patch})
  else unchanged.push(item.id)
 }
 return {company:t,stats:{appActive:active.length,parsed:parsedRows.length,matched:changes.length+unchanged.length,changes:changes.length,unchanged:unchanged.length,unmatched:unmatched.length,noReviewedName:noName.length},changes,unmatched,noName,unchanged}
}
