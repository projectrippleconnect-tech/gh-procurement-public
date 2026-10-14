// Converts company worksheets into one row per stock-controlled variation.
export const defaultCompanyFields={size:true,colour:true,variation:false,brand:false,category:false,subgroup:false,movement:true,uom:true,max:true,reorder:true,remarks:false}
export const COMPANY_ITEM_COLUMNS=['size','colour','variation','brand','category','subgroup','movement','uom','max','reorder','remarks']
const clean=v=>String(v??'').trim().replace(/\s+/g,' ')
const sourceIdentity=(sheetId,row)=>{let h=14695981039346656037n;for(const ch of [row.description,row.category,row.subgroup,row.brand,row.size,row.colour,row.variation,row.uom].map(v=>clean(v).toLowerCase()).join('|'))h=BigInt.asUintN(64,(h^BigInt(ch.codePointAt(0)))*1099511628211n);return sheetId+':'+h.toString(36)}
const amount=v=>{const s=clean(v);if(!s)return null;const m=s.match(/^(\d+(?:\.\d+)?)\s*(kg)?$/i);return m?Number(m[1]):null}
export function reorderFor(max){return max===null||max===undefined||max===''?null:Number(max)*.5}
export function companySuggested(row,current,sufficient=false){if(sufficient)return 0;if(row.max_stock_review||current===''||current===undefined||current===null)return null;const max=Number(row.target_stock);return Number(current)<=Number(row.reorder_level??reorderFor(max))?Math.max(0,max-Number(current)):0}
export function parseCompanySheet({title,sheetId,values=[]}){
 const name=clean(title),out=[];let section='',product='',matrix=null,colour='',lastMax=null
 const add=(description,max,row,col,extra={})=>{if(!description)return;const sourceKey=`${sheetId}:${row+1}:${col+1}`;const unit=/kg$/i.test(clean(values[row]?.[col]))?'KG':extra.uom||'PCS';out.push({source_key:sourceKey,source_sheet_id:sheetId,source_tab:name,description:clean(description),category:name,main_group:name,subgroup:section||name,brand:extra.brand||(/WIRE CABLES|CEMENT BASED|BOARD ITEMS|PANEL SHEETS|BOLT & NUTS|CASING|REGIFOAM|HOSE|ALCATHINE/i.test(name)?'':name),size:clean(description).match(/\b(\d+(?:\.\d+)?\s*(?:ML|LTR|KG|MM|MTR|FEET|W|G))\b/i)?.[1]||'',colour:clean(description).match(/\b(WHITE|BLACK|BLUE|BROWN|GREEN|GREY|RED|ORANGE|TEAK)\b/i)?.[1]||colour,variation:'',uom:unit,movement:'NORMAL',max_stock:max,reorder_level:reorderFor(max),max_stock_review:max===null,remarks:'',...extra})}
 for(let r=0;r<values.length;r++){
  const row=values[r].map(clean),filled=row.map((v,i)=>v?i:-1).filter(i=>i>=0);if(!filled.length){matrix=null;product='';colour='';lastMax=null;continue}
  const first=row[0]||'',numeric=filled.filter(i=>i>0&&amount(row[i])!==null)
  if(/^I PANEL$/i.test(first)&&/^SIZE$/i.test(row[1]||'')){section=first;product='';matrix=null;continue}
  // Column headings can encode brands, colours, thickness, diameter or mounting.
  const header=filled.length>=2&&(/^(DESCRIPTION|SIZE)$/i.test(first)||(!first&&!product)||(numeric.length===0&&(r===0||!first||/^LED FLASH$/i.test(first))))
  if(header){matrix=filled.filter(i=>i>0).map(i=>({col:i,label:row[i]}));if(first&&!/^(DESCRIPTION|SIZE)$/i.test(first))section=first;continue}
  if(filled.length===1&&first&&amount(first)===null){
   // A product description with a blank quantity followed by another product is reviewable.
   const next=values[r+1]?.map(clean)||[]
   const titleOnly=/^(?:SIZE|DESCRIPTION)$/i.test(first)||first===name||first===name+' ITEMS'||first==='BOARD'
   const hasDataNext=next.some((v,i)=>i>0&&amount(v)!==null)
   const knownSection=/^(?:REGIFOAM SHEET|ALCATHINE HOSE|RUBBER HOSE|GI CHANNEL|CEILING FITTINGS|I PANEL|I PANEL ACCESSORIES|YP BOLT|YP Washer|YP NUT|GI NUT|THREAD BAR|DRILL BIT|CONCRETE BIT|HILTI BIT|THREAD SEAL|CUTTING WHEEL|GRINDING WHEEL|SKIM COAT|TILE MORTAR|WARM WHITE|(?:KEVILTON|AKOYA|CASABLANCA)\s)/i.test(first)
   if(titleOnly){if(!section)section=name;continue}
   if(knownSection||hasDataNext&&next[0]&&(!next[0].match(/[A-Z]{3}/i)||/^(SHINE|SWISSTEK|KESARA)$/.test(next[0]))){section=first;matrix=null;product='';colour=/WHITE|BLACK|MAHOGANI/i.test(first)?first.match(/WHITE|BLACK|MAHOGANI/i)[0]:'';continue}
   add(first,null,r,1);product=first;continue
  }
  if(matrix){
   if(first){product=first;if(name==='BOARD ITEMS')colour=row[1]||''}else if(name==='BOARD ITEMS'&&row[1])colour=row[1]
   if(!product)continue
   for(const h of matrix){const max=amount(row[h.col]);if(row[h.col]&&!numeric.includes(h.col))continue
    let extra={};const label=h.label
    if(name==='WIRE CABLES')extra={brand:label,subgroup:label,variation:label}
    else if(/^(WHITE|BLACK|GREEN|RED|ORANGE|BLUE|TEAK|WARM WHITE)$/i.test(label))extra={colour:label}
    else if(/^(SUNK|SURFACE)$/i.test(label))extra={variation:label}
    else extra={size:label,variation:first}
    const desc=name==='WIRE CABLES'?product:section&&(section!==name||/HOSE|ALCATHINE/.test(name))?section+' '+product:product
    add(desc,max,r,h.col,extra)
   }continue
  }
  if(first){if(name==='MULTI BOND'&&/^\d+(?:\.\d+)?\s*(?:ML|G|KG|LTR|L)$/i.test(first)&&product){product=product.replace(/\s*\d+(?:\.\d+)?\s*(?:ML|G|KG|LTR|L)\s*$/i,'')+' '+first}else product=first}
  if(!product)continue
  let max=numeric.length?amount(row[numeric.at(-1)]):null;const maxCol=numeric.at(-1)??2
  const rain=/^RAIN COAT/i.test(product)
  if(rain&&max!==null)lastMax=max
  if(rain&&max===null&&row[1])max=lastMax // Approved rule: same maximum for EACH colour.
  const variant=filled.filter(i=>i>0&&!numeric.includes(i)).map(i=>row[i]).join(' ')
  let description=product,extra={}
  if(/^(SKIM COAT|TILE MORTAR)$/i.test(section)){description=section;extra.brand=product;extra.subgroup=section}
  else if(/^(YP NUT|GI NUT|THREAD BAR|GI CHANNEL|REGIFOAM SHEET|CASING)$/i.test(section)){description=section;extra.size=product}
  if(variant){if(/^(WHITE|BLACK|GREEN|GREY|RED|ORANGE|BLUE|TEAK|BEECH|WHITE ASH|WARM WHITE)$/i.test(variant))extra.colour=variant;else extra.size=variant}
  const size=product.match(/\b(\d+(?:\.\d+)?\s*(?:ML|LTR|KG|MM|MTR|FEET|W|G))\b/i)?.[1];if(size&&!extra.size)extra.size=size
  add(description,max,r,maxCol,extra)
 }
 const unique=new Map();for(const item of out){item.source_position=item.source_key;item.source_key=sourceIdentity(sheetId,item);const prior=unique.get(item.source_key);if(!prior)unique.set(item.source_key,item);else if(prior.max_stock!==item.max_stock){prior.max_stock=null;prior.reorder_level=null;prior.max_stock_review=true;prior.remarks='Conflicting maxima in duplicate source rows; admin review required.'}}
 return [...unique.values()]
}
export function validateCompanyImport(rows){
 const keys=new Set();for(const r of rows){if(!clean(r.description)||!clean(r.source_key))throw new Error('Each item needs a description and stable source cell.');if(keys.has(r.source_key))throw new Error('Duplicate source cell.');keys.add(r.source_key);if(r.max_stock!==null&&(!Number.isFinite(Number(r.max_stock))||Number(r.max_stock)<0))throw new Error('Maximum stock must be blank, zero or positive.')}
 return rows
}


/** Group a company's inventory by location in its catalogue without merging distinct source rows. */
export function groupCompanyRows(rows=[]){
 const groups=new Map()
 const sorted=[...rows].sort((a,b)=>{
  const x=a.item||{},y=b.item||{}
  for(const key of ['category','main_group','subgroup','description','size','brand','colour','variation']){
   const comparison=String(x[key]||'').localeCompare(String(y[key]||''),undefined,{numeric:true,sensitivity:'base'})
   if(comparison)return comparison
  }
  return String(a.id||'').localeCompare(String(b.id||''))
 })
 for(const r of sorted){
  const item=r.item||{}
  const parts=[item.category,item.main_group,item.subgroup].map(v=>String(v||'').trim()).filter((v,i,a)=>v&&a.findIndex(w=>w.toLowerCase()===v.toLowerCase())===i)
  const title=parts.join(' / ')||'Other items'
  const key=parts.map(x=>x.toLowerCase()).join('|')||'other'
  if(!groups.has(key))groups.set(key,{key,title,items:[]})
  groups.get(key).items.push(r)
 }
 return [...groups.values()]
}
/** Omit labels already present in the item name (such as 24W/24W), without losing item identity. */
export function companyCompactMeta(item={},visibleFields={}){
 const description=String(item.description||'').toLowerCase().replace(/[^a-z0-9]/g,'')
 return ['size','colour','variation','brand','uom','remarks'].filter(key=>{
  const value=String(item[key]||'').trim()
  if(!value||visibleFields[key]===false)return false
  if(key==='size'&&description.includes(value.toLowerCase().replace(/[^a-z0-9]/g,'')))return false
  return true
 }).map(key=>({key,label:key==='uom'?'':key+':',value:String(item[key]).trim()}))
}
