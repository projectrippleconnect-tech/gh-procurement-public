// Shared option formatting and hierarchy safety for item create/edit forms.
// Preserve the database's spelling; compare case-insensitively to avoid duplicate options.
export const ITEM_CATEGORIES=['GENERAL','BATHROOM','ELECTRICAL']
export const ITEM_UOMS=['PCS','NOS','BOX','PACK','SET','PAIR','DOZEN','ROLL','BAG','BUNDLE','CARTON','SHEET','LENGTH','MTR','M','FT','KG','G','LTR','L','ML','TIN','TUBE']

export function itemOptionValues(...sources){
 const values=[],seen=new Set()
 for(const source of sources){
  for(const raw of (Array.isArray(source)?source:[source])){
   const value=String(raw??'').trim()
   if(!value||seen.has(value.toLocaleUpperCase()))continue
   seen.add(value.toLocaleUpperCase());values.push(value)
  }
 }
 return values.sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base',numeric:true}))
}

export function updateItemGrouping(draft,field,value){
 const next={...draft,[field]:value}
 if(field==='category'&&value!==draft.category){next.main_group='';next.subgroup=''}
 if(field==='main_group'&&value!==draft.main_group)next.subgroup=''
 return next
}
