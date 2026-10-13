export const STOCK_PRINT_COLUMNS=[
 ['no','No.',1],['description','Description',5],['size','Size',2],['uom','UOM',1.3],['category','Category',2],['subgroup','Subcategory',2],['movement','Movement',1.6],['max_stock','Max stock',1.6],['reorder_level','Reorder level',1.6],['current_stock','Current stock',1.8],['remarks','Remarks',2.5],['brand','Brand',2],['colour','Colour',1.5],['variation','Variation',2]
]
export const defaultStockPrint=()=>({title:'STOCK CHECK SHEET',orientation:'portrait',layout:'columns',tablesPerPage:3,fontSize:6.5,rowHeight:5,rowsPerTable:0,columns:['no','description','size','uom','reorder_level','current_stock']})
export function stockPrintRows(items,{category='',subgroup='',movement='',search='',selectedIds=null}={}){
 const selected=selectedIds?new Set(selectedIds):null,query=search.trim().toLowerCase()
 return items.filter(i=>(!category||i.category===category)&&(!subgroup||i.subgroup===subgroup)&&(!movement||i.movement===movement)&&(!selected||selected.has(i.id||i.item_id))&&(!query||[i.description,i.size,i.item_code,i.category,i.subgroup,i.brand,i.colour,i.variation].join(' ').toLowerCase().includes(query)))
}
export function resolveStockPrint(value={}){
 const defaults=defaultStockPrint(),columns=STOCK_PRINT_COLUMNS.filter(([key])=>(value.columns||defaults.columns).includes(key))
 if(!columns.some(([key])=>key==='description'))throw new Error('Include Description so every row can be identified.')
 return {...defaults,...value,columns:columns.map(([key])=>key),tablesPerPage:Math.max(1,Math.min(3,Math.floor(Number(value.tablesPerPage)||3))),fontSize:Math.max(6,Math.min(11,Number(value.fontSize)||6.5)),rowHeight:Math.max(4.5,Math.min(12,Number(value.rowHeight)||5)),rowsPerTable:Math.max(0,Math.min(100,Math.floor(Number(value.rowsPerTable)||0))),orientation:value.orientation==='landscape'?'landscape':'portrait',layout:value.layout==='stacked'?'stacked':'columns'}
}
