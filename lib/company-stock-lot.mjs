// Company stock counts belong to company-list rows, not directly to the
// Item Master ID. Never merge same item across different companies.
export function companyLotRows(rows=[],entry={},sufficient={},markers={},recounts=new Set()){
 return rows.filter(r=>sufficient[r.id]===true||(entry[r.id]!==undefined&&entry[r.id]!==''&&!sufficient[r.id])).map(r=>{
  const previous=markers[String(r.company_id)+'|'+String(r.item_id)]||null
  return {row:r,id:r.id,companyId:r.company_id,
   quantity:sufficient[r.id]?null:entry[r.id],
   sufficient:!!sufficient[r.id],previous,
   blocked:!!previous&&!recounts.has(r.id)}
 })
}
export function companyLotGroups(counted=[]){
 const byCompany=new Map()
 for(const line of counted){
  if(!byCompany.has(line.companyId))byCompany.set(line.companyId,[])
  byCompany.get(line.companyId).push(line)
 }
 return [...byCompany.entries()].map(([companyId,lines])=>({companyId,lines,count:lines.length}))
}
