// Item display text is uppercase; identifiers, prices, quantities and search keys remain unchanged.
export const ITEM_TEXT_FIELDS=Object.freeze(['description','category','main_group','subgroup','brand','colour','variation','size','uom','remarks'])
export const uppercaseItemText=value=>String(value??'').toUpperCase()
export const normalizeItemText=value=>uppercaseItemText(String(value??'').trim().replace(/\s+/g,' '))
export function uppercaseItemAttributes(item={}){
 const result={...item}
 for(const key of ITEM_TEXT_FIELDS){
  if(typeof result[key]==='string')result[key]=key==='remarks'?uppercaseItemText(result[key]):normalizeItemText(result[key])
 }
 return result
}
