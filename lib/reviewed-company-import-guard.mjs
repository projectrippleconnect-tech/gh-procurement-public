/**
 * Prevent a renamed company-sheet record from being imported as a brand-new
 * product merely because the old hash included its previous description.
 */
export function companyImportCollisionGuard(existingKeys=[],incomingRows=[]){
 const keys=new Set(existingKeys.filter(Boolean).map(String))
 if(!keys.size)return {blocked:false,unknownCount:0,existingCount:0}
 const unknown=incomingRows.filter(r=>r?.source_key&&!keys.has(String(r.source_key)))
 return {blocked:unknown.length>0,unknownCount:unknown.length,existingCount:keys.size}
}
