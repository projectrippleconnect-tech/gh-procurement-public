export const STOCK_PRINT_COLUMNS=[
 ['no','No.',1],['description','Description',5],['size','Size',2],['uom','UOM',1.3],['category','Category',2],['subgroup','Subcategory',2],['movement','Movement',1.6],['max_stock','Max stock',1.6],['reorder_level','Reorder level',1.6],['current_stock','Current stock',1.8],['remarks','Remarks',2.5],['brand','Brand',2],['colour','Colour',1.5],['variation','Variation',2]
]
// Print-only presentation defaults. No catalog descriptions or stock values are updated.
export const DEFAULT_STOCK_COLUMN_STYLES={
 no:{align:'center',bold:false},
 description:{align:'left',bold:true},
 size:{align:'center',bold:false},
 uom:{align:'center',bold:false},
 category:{align:'left',bold:false},
 subgroup:{align:'left',bold:false},
 movement:{align:'center',bold:false},
 max_stock:{align:'center',bold:false},
 reorder_level:{align:'center',bold:true},
 current_stock:{align:'center',bold:false},
 remarks:{align:'left',bold:false},
 brand:{align:'left',bold:false},
 colour:{align:'center',bold:false},
 variation:{align:'left',bold:false}
}
export function resolveStockColumnStyles(overrides={}){
 const source=overrides&&typeof overrides==='object'&&!Array.isArray(overrides)?overrides:{}
 return Object.fromEntries(STOCK_PRINT_COLUMNS.map(([key])=>{
  const base=DEFAULT_STOCK_COLUMN_STYLES[key]||{align:'left',bold:false}
  const incoming=source[key]&&typeof source[key]==='object'&&!Array.isArray(source[key])?source[key]:{}
  return [key,{align:['left','center','right'].includes(incoming.align)?incoming.align:base.align,bold:typeof incoming.bold==='boolean'?incoming.bold:base.bold}]
 }))
}

// Strip only repeated *standalone suffix metadata* in printable names.
// Keep meaningful size, material, colour and brand tokens in the first segment.
export function stockPrintDescription(item,{removeRepeatedSuffix=true}={}){
 const text=String(item?.description??'').trim()
 if(!removeRepeatedSuffix||!text)return text
 const segments=text.split(/\\s+[\\-–—·•]\\s+/u).map(x=>x.trim()).filter(Boolean)
 if(segments.length<2)return text
 const included=[segments[0]]
 const words=phrase=>phrase.toLocaleUpperCase('en').replace(/[^A-Z0-9]+/g,' ').trim()
 const containsPhrase=(haystack,needle)=>needle&&(' '+words(haystack)+' ').includes(' '+words(needle)+' ')
 const known=[item?.brand,item?.colour,item?.color].filter(Boolean).map(words)
 for(let i=1;i<segments.length;i++){
  const segment=segments[i]
  const normalized=words(segment)
  const previouslyPresent=included.some(part=>containsPhrase(part,segment))
  const matchesMetadata=known.includes(normalized)
  const isShortMetadata=normalized.split(' ').length<=3
  if(isShortMetadata&&previouslyPresent&&(matchesMetadata||segments.length>2||i>1))continue
  included.push(segment)
 }
 return included.join(' · ')
}

export const defaultStockPrint=()=>({title:'STOCK CHECK SHEET',orientation:'portrait',layout:'columns',tablesPerPage:3,splitLongTables:true,removeRepeatedSuffix:true,columnStyles:resolveStockColumnStyles(),fontSize:6.5,rowHeight:5,rowsPerTable:0,columns:['no','description','size','uom','reorder_level','current_stock']})
export function stockPrintRows(items,{category='',subgroup='',movement='',search='',selectedIds=null}={}){
 const selected=selectedIds?new Set(selectedIds):null,query=search.trim().toLowerCase()
 return items.filter(i=>(!category||i.category===category)&&(!subgroup||i.subgroup===subgroup)&&(!movement||i.movement===movement)&&(!selected||selected.has(i.id||i.item_id))&&(!query||[i.description,i.size,i.item_code,i.category,i.subgroup,i.brand,i.colour,i.variation].join(' ').toLowerCase().includes(query)))
}
export function resolveStockPrint(value={}){
 const defaults=defaultStockPrint(),columns=STOCK_PRINT_COLUMNS.filter(([key])=>(value.columns||defaults.columns).includes(key))
 if(!columns.some(([key])=>key==='description'))throw new Error('Include Description so every row can be identified.')
 return {...defaults,...value,columns:columns.map(([key])=>key),tablesPerPage:Math.max(1,Math.min(3,Math.floor(Number(value.tablesPerPage)||3))),fontSize:Math.max(6,Math.min(11,Number(value.fontSize)||6.5)),rowHeight:Math.max(4.5,Math.min(12,Number(value.rowHeight)||5)),rowsPerTable:Math.max(0,Math.min(100,Math.floor(Number(value.rowsPerTable)||0))),orientation:value.orientation==='landscape'?'landscape':'portrait',layout:value.layout==='stacked'?'stacked':'columns',splitLongTables:value.splitLongTables!==false,removeRepeatedSuffix:value.removeRepeatedSuffix!==false,columnStyles:resolveStockColumnStyles(value.columnStyles)}
}
