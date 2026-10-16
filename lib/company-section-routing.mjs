export function defaultSectionRoute(count=1){
 return {mode:count>1?'rfq':'direct',autoSend:count<=1}
}
export function nearestSectionRoute(section,sections=[],routes=[]){
 const parentById=new Map(sections.map(s=>[s.id,s]))
 const routeById=new Map(routes.map(r=>[r.section_id,r]))
 const visited=new Set()
 let cursor=section
 while(cursor&&!visited.has(cursor.id)){
  visited.add(cursor.id)
  const matched=routeById.get(cursor.id)
  if(matched)return {rule:matched,inherited:cursor.id!==section.id}
  cursor=parentById.get(cursor.parent_id)
 }
 return null
}
export function validateSectionRoute({mode,supplierIds=[],autoSend=false}={}){
 const ids=[...new Set(supplierIds.filter(Boolean))]
 if(!['direct','rfq'].includes(mode))return{valid:false,reason:'Choose RFQ or direct PO'}
 if(ids.length===0||ids.length>15)return{valid:false,reason:'Choose 1–15 suppliers'}
 if(mode==='direct'&&ids.length!==1)return{valid:false,reason:'Direct POs require exactly one supplier'}
 return {valid:true,mode,supplierIds:ids,autoSend:!!autoSend}
}

/**
 * Count every active catalogue row below a company section, including nested
 * subsections. A child with an explicitly saved route overrides its parent,
 * so parent route coverage excludes only those child-owned items.
 *
 * Counts are catalogue coverage, NOT approved purchase-order / RFQ quantities.
 */
export function sectionRouteCoverage(sectionId,sections=[],rows=[],routes=[]){
 const byId=new Map(sections.filter(s=>s.active!==false).map(s=>[s.id,s]))
 const overrides=new Set(routes.map(r=>r.section_id))
 if(!byId.has(sectionId))return{directItems:0,totalItems:0,coveredItems:0,overriddenItems:0,descendantSections:0}
 function trace(startId){
  let cursor=startId,overridden=false
  const seen=new Set()
  while(cursor&&byId.has(cursor)&&!seen.has(cursor)){
   if(cursor===sectionId)return {matches:true,overridden}
   seen.add(cursor)
   if(overrides.has(cursor))overridden=true
   cursor=byId.get(cursor).parent_id
  }
  return {matches:false,overridden:false}
 }
 let directItems=0,totalItems=0,overriddenItems=0,descendantSections=0
 for(const section of byId.values()){
  if(section.id!==sectionId&&trace(section.id).matches)descendantSections++
 }
 const counted=new Set()
 for(const row of rows){
  if(row.active===false)continue
  const key=row.id||row.item_id
  if(key&&counted.has(key))continue
  if(key)counted.add(key)
  const found=trace(row.section_id)
  if(!found.matches)continue
  totalItems++
  if(row.section_id===sectionId)directItems++
  if(found.overridden)overriddenItems++
 }
 return {directItems,totalItems,coveredItems:totalItems-overriddenItems,overriddenItems,descendantSections}
}
