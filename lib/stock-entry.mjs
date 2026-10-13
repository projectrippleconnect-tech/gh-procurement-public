export const SUFFICIENT_STOCK='sufficient'

export function stockSearchTokens(query){
 return String(query||'').normalize('NFKC').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}
export function matchesStockSearch(item,query){
 const tokens=stockSearchTokens(query)
 const text=['description','size','item_code','brand','category','main_group','subgroup','uom'].map(key=>item[key]||'').join(' ').normalize('NFKC').toLowerCase()
 return tokens.every(token=>text.includes(token))
}
export function stockSubmissionLine(item_id,value){
 return value===SUFFICIENT_STOCK?{item_id,sufficient_stock:true}:{item_id,current_stock:Number(value)}
}
