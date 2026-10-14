const columns=['item_code','description','brand','category','main_group','subgroup','size','uom']
export const stockSearchColumns='id,item_code,category,brand,description,main_group,subgroup,size,uom,movement,max_stock,reorder_level'
export function indexStockItems(rows){
 return rows.map(row=>({...row,item_id:row.item_id||row.id,searchText:columns.map(key=>String(row[key]||'').toLowerCase()).join(' ')}))
}
export function searchStockItems(rows,query,filters={},limit=30){
 const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean)
 if(!words.length)return []
 const results=[]
 for(const row of rows){
  if(Object.entries(filters).some(([key,value])=>value&&row[key]!==value))continue
  if(words.every(word=>row.searchText.includes(word)))results.push(row)
  if(results.length===limit)break
 }
 return results
}
