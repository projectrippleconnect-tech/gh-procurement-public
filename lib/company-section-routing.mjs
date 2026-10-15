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
 return {valid:true,mode,supplierIds:ids,autoSend:mode==='direct'&&!!autoSend}
}
