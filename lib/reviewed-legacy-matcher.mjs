/**
 * Conservative one-to-one recovery for legacy company records whose old
 * description-derived source hashes changed after spreadsheet clean-up.
 *
 * This is a Super Admin REVIEW path, never an autonomous data import:
 * the original company item ID and stock target are always preserved.
 */
const LEGACY_ALLOW=new Set(['KEVILTON','ORANGE','FEVICOL','ROCKER','POLYCHROME','MULTI BOND','WURTH','REGIFOAM','CASING','PE+'])
const clean=s=>String(s??'').trim().toUpperCase().replaceAll('MAHOGANI','MAHOGANY').replace(/\s+/g,' ')
const tokens=s=>clean(s).replace(/[^A-Z0-9.+]+/g,' ').split(/\s+/).filter(Boolean)
const brandKey=s=>tokens(s).sort().join('|')
const colourKey=s=>clean(s)
const words=s=>tokens(s).filter(t=>t.length>1||/^\d+$/.test(t))
function namesOverlap(oldName,reviewed){
 const old=words(oldName),next=new Set(words(reviewed))
 if(!old.length)return false
 const overlap=old.filter(t=>next.has(t)).length
 return overlap/old.length>=0.66&&(old.length===1?old[0].length>=5:overlap>=2)
}
export function legacyAlignment({title,sheetId,parsedRows=[],links=[]}){
 if(!LEGACY_ALLOW.has(clean(title))||parsedRows.length!==links.length||!parsedRows.length)return null
 const sorted=[...links].sort((a,b)=>Number(a.sort_order)-Number(b.sort_order))
 if(sorted.some((x,i)=>Number(x.sort_order)!==i||x.active===false||x.item?.source!=='COMPANY SHEET'))return null
 if(sorted.some(x=>x.source_sheet_id!==null&&x.source_sheet_id!==undefined&&Number(x.source_sheet_id)!==Number(sheetId)))return null
 return sorted
}
export function verifiedLegacyCandidate({row,index,reviewedName,ordered,reservedIds=new Set(),sheetId,expectedColour=null}){
 if(!ordered||index<0||index>=ordered.length)return null
 const link=ordered[index],item=link.item
 if(!item||!item.id||item.id!==link.item_id||reservedIds.has(item.id))return null
 if(!String(link.source_key||'').startsWith(String(sheetId)+':'))return null
 if(row.max_stock===null||row.max_stock===undefined){
  if(!link.max_stock_review)return null
 }else if(Number(row.max_stock)!==Number(link.target_stock))return null
 if(brandKey(item.brand)!==brandKey(row.brand))return null
 if(colourKey(item.colour)!==colourKey(expectedColour===null?row.colour:expectedColour))return null
 if(!namesOverlap(item.description,reviewedName))return null
 return link
}
