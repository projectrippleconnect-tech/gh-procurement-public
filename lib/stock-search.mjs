import {searchWords,normalizeItemSearch,fuzzyItemScore,isApproximateItemMatch} from './fuzzy-item-search.mjs'

const columns=['item_code','description','brand','category','main_group','subgroup','size','uom','colour','variation']
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
 return rows.map(row=>{
  const searchText=columns.map(key=>String(row[key]||'').toLowerCase()).join(' ')
  const searchLabel=stockItemLabel(row)
  return {...row,item_id:row.item_id||row.id,searchText,searchLabel,
   searchTokens:searchWords(searchText),descriptionTokens:searchWords(row.description),labelTokens:searchWords(searchLabel)}
 })
}
export {isApproximateItemMatch}
export function searchStockItems(rows,query,filters={},limit=30){
 const rawWords=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean)
 if(!rawWords.length||limit<=0)return []
 // Exact matches always rank ahead of related suggestions.
 const direct=[],labelMatches=[],other=[]
 for(const row of rows){
  if(Object.entries(filters).some(([key,value])=>value&&row[key]!==value))continue
  const searchText=row.searchText||columns.map(key=>String(row[key]||'').toLowerCase()).join(' ')
  if(!rawWords.every(word=>/\d/.test(word) ? (row.searchTokens||searchWords(searchText)).some(token=>token.startsWith(normalizeItemSearch(word))) : searchText.includes(word)))continue
  const description=String(row.description||'').toLowerCase()
  const bucket=rawWords.every(word=>/\d/.test(word)?searchWords(description).some(token=>token.startsWith(normalizeItemSearch(word))):description.includes(word))?direct:
   rawWords.every(word=>/\d/.test(word)?searchWords(stockItemLabel(row)).some(token=>token.startsWith(normalizeItemSearch(word))):stockItemLabel(row).toLowerCase().includes(word))?labelMatches:other
  if(bucket.length<limit)bucket.push(row)
  if(direct.length>=limit)break
 }
 const exact=[...direct,...labelMatches,...other].slice(0,limit)
 // Held stock groups should not silently grow with merely similar names.
 if(exact.length>=limit||(!Number.isFinite(limit)&&exact.length)||normalizeItemSearch(query).length<4)return exact
 const fuzzyWords=searchWords(query,{expandAliases:true})
 const seen=new Set(exact.map(row=>row.item_id||row.id))
 const candidates=[]
 for(let i=0;i<rows.length;i++){
  const row=rows[i]
  if(seen.has(row.item_id||row.id))continue
  if(Object.entries(filters).some(([key,value])=>value&&row[key]!==value))continue
  const match=fuzzyItemScore(row,fuzzyWords)
  if(match)candidates.push({row,score:match.score,index:i})
 }
 candidates.sort((a,b)=>a.score-b.score||a.index-b.index)
 return [...exact,...candidates.slice(0,limit-exact.length).map(x=>x.row)]
}
