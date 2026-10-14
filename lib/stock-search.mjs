const columns=['item_code','description','brand','category','main_group','subgroup','size','uom']
export const stockSearchColumns='id,item_code,category,brand,description,main_group,subgroup,size,uom,movement,max_stock,reorder_level'

// Imported company-list variations may store only "10mm" as their description,
// with the actual product ("CONCRETE BIT") in subgroup. Show that context.
export function stockItemLabel(row={}){
 const description=String(row.description||'').trim()
 const size=String(row.size||'').trim()
 const subgroup=String(row.subgroup||'').trim()
 const redundantParent=[row.brand,row.category,row.main_group,description].some(
  value=>String(value||'').trim().toLowerCase()===subgroup.toLowerCase()
 )
 const sizeOnly=/^\d+(?:[./]\d+)?\s*(?:mm|cm|m|ft|feet|in|inch|inches|["'′″])$/i.test(description)
 if(subgroup&&!redundantParent&&(!description||sizeOnly||description.toLowerCase()===size.toLowerCase())){
  return [subgroup,description||size].filter(Boolean).join(' · ')
 }
 if(!description)return size||String(row.item_code||'Item')
 return size&&!description.toLowerCase().includes(size.toLowerCase())
  ?description+' · '+size:description
}
export function indexStockItems(rows){
 return rows.map(row=>({...row,item_id:row.item_id||row.id,searchText:columns.map(key=>String(row[key]||'').toLowerCase()).join(' ')}))
}
export function searchStockItems(rows,query,filters={},limit=30){
 const words=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean)
 if(!words.length||limit<=0)return []
 // Rank matches that are visible in the item name ahead of hidden subgroup
 // matches. Otherwise "Concrete" starts with unexplained sizes like "10mm".
 const direct=[],labelMatches=[],other=[]
 for(const row of rows){
  if(Object.entries(filters).some(([key,value])=>value&&row[key]!==value))continue
  const searchText=row.searchText||columns.map(key=>String(row[key]||'').toLowerCase()).join(' ')
  if(!words.every(word=>searchText.includes(word)))continue
  const description=String(row.description||'').toLowerCase()
  const bucket=words.every(word=>description.includes(word))?direct:
   words.every(word=>stockItemLabel(row).toLowerCase().includes(word))?labelMatches:other
  if(bucket.length<limit)bucket.push(row)
  if(direct.length>=limit)break
 }
 return [...direct,...labelMatches,...other].slice(0,limit)
}
