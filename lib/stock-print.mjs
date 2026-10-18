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
 const segments=text.split(/\s+[-–—·•]\s+/u).map(x=>x.trim()).filter(Boolean)
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
 // Do not reformat legitimate variants when there was nothing to remove.
 return included.length===segments.length?text:included.join(' · ')
}

export const defaultStockPrint=()=>({title:'STOCK CHECK SHEET',orientation:'portrait',layout:'columns',tablesPerPage:3,splitLongTables:true,groupBySubcategory:false,includeUncategorized:true,removeRepeatedSuffix:true,columnStyles:resolveStockColumnStyles(),fontSize:6.5,rowHeight:5,rowsPerTable:0,columns:['no','description','size','uom','reorder_level','current_stock']})
export function stockPrintRows(items,{category='',subgroup='',movement='',search='',selectedIds=null}={}){
 const selected=selectedIds?new Set(selectedIds):null,query=search.trim().toLowerCase()
 return items.filter(i=>(!category||i.category===category)&&(!subgroup||i.subgroup===subgroup)&&(!movement||i.movement===movement)&&(!selected||selected.has(i.id||i.item_id))&&(!query||[i.description,i.size,i.item_code,i.category,i.subgroup,i.brand,i.colour,i.variation].join(' ').toLowerCase().includes(query)))
}
export function resolveStockPrint(value={}){
 const defaults=defaultStockPrint(),columns=STOCK_PRINT_COLUMNS.filter(([key])=>(value.columns||defaults.columns).includes(key))
 if(!columns.some(([key])=>key==='description'))throw new Error('Include Description so every row can be identified.')
 return {...defaults,...value,columns:columns.map(([key])=>key),tablesPerPage:Math.max(1,Math.min(3,Math.floor(Number(value.tablesPerPage)||3))),fontSize:Math.max(6,Math.min(11,Number(value.fontSize)||6.5)),rowHeight:Math.max(4.5,Math.min(12,Number(value.rowHeight)||5)),rowsPerTable:Math.max(0,Math.min(100,Math.floor(Number(value.rowsPerTable)||0))),orientation:value.orientation==='landscape'?'landscape':'portrait',layout:value.layout==='stacked'?'stacked':'columns',splitLongTables:value.splitLongTables!==false,groupBySubcategory:value.groupBySubcategory===true,includeUncategorized:value.includeUncategorized!==false,removeRepeatedSuffix:value.removeRepeatedSuffix!==false,columnStyles:resolveStockColumnStyles(value.columnStyles)}
}


/**
 * Print-only grouping. Prefer the company's saved, ordered section tree when
 * available, falling back to legacy category/subgroup only for older lists.
 * One physical item row goes into exactly one group; catalogue data is untouched.
 */
export function groupStockPrintRows(items=[],sections=[],{includeUncategorized=true}={}){
 const normalize=value=>String(value??'').trim().replace(/\s+/g,' ')
 const compare=(a,b)=>normalize(a).localeCompare(normalize(b),undefined,{numeric:true,sensitivity:'base'})
 const canonical=value=>normalize(value).toUpperCase().replace(/MAHOGANI/g,'MAHOGANY').replace(/[^A-Z0-9]/g,'')
 const active=new Map(sections.filter(s=>s?.active!==false&&s?.id).map(s=>[s.id,s]))
 const children=new Set([...active.values()].filter(s=>s.parent_id&&active.has(s.parent_id)).map(s=>s.parent_id))
 const trailFor=id=>{
  const trail=[],seen=new Set()
  let current=id
  while(current&&active.has(current)&&!seen.has(current)){
   seen.add(current)
   const section=active.get(current)
   trail.unshift(section)
   current=section.parent_id
  }
  return trail
 }
 // Older lists can have every row assigned to the company root while the
 // category/finish sections already exist. Match only exact saved metadata to
 // one existing leaf; never write inferred section IDs to stock records.
 const inferredTrail=(item,root)=>{
  const group=canonical(item.main_group),finish=canonical(item.subgroup||item.colour)
  if(!group||!finish||group===canonical(root.name))return null
  const candidates=[...active.values()].filter(s=>canonical(s.name)===group).map(s=>trailFor(s.id))
   .filter(path=>path.length>2&&path[0].id===root.id&&path.slice(1,-1).some(s=>{
    const name=canonical(s.name)
    return name===finish||name===canonical(root.name)+finish
   }))
  return candidates.length===1?candidates[0]:null
 }
 const groups=new Map(),uncategorized=[]
 for(const item of items){
  let trail=trailFor(item.section_id)
  if(trail.length===1&&children.has(trail[0].id)){
   // A parent with nested categories is not itself a printable subcategory.
   // Unmatched stock is shown in Others, not silently mixed into one big table.
   trail=inferredTrail(item,trail[0])||[]
  }
  let category='',subcategory='',key='',order=[]
  if(trail.length){
   category=normalize(trail[0].name)
   subcategory=trail.slice(1).map(s=>normalize(s.name)).filter(Boolean).join(' / ')||'General items'
   key='section:'+String(trail.at(-1).id)
   order=trail.map(s=>Number(s.sort_order)||0)
  }else if(active.size===0){
   category=normalize(item.category||item.main_group)
   const subgroup=normalize(item.subgroup)
   if(category&&subgroup){
    subcategory=canonical(category)===canonical(subgroup)?'General items':subgroup
    key='legacy:'+canonical(category)+'|'+canonical(subcategory)
   }
  }
  if(!key){uncategorized.push(item);continue}
  if(!groups.has(key))groups.set(key,{key,category,subcategory,title:category+' / '+subcategory,order,items:[]})
  groups.get(key).items.push(item)
 }
 const sorted=[...groups.values()].sort((a,b)=>{
  if(a.key.startsWith('section:')&&b.key.startsWith('section:')){
   for(let i=0;i<Math.max(a.order.length,b.order.length);i++){
    if(i>=a.order.length)return -1
    if(i>=b.order.length)return 1
    if(a.order[i]!==b.order[i])return a.order[i]-b.order[i]
   }
  }
  return compare(a.title,b.title)||compare(a.key,b.key)
 })
 if(includeUncategorized&&uncategorized.length)sorted.push({
  key:'other-uncategorized',category:'Other',subcategory:'Uncategorized',
  title:'Other / Uncategorized',order:[],items:uncategorized
 })
 return sorted
}
