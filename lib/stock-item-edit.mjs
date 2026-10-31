import {normalizeItemText,uppercaseItemText,ITEM_TEXT_FIELDS} from './item-text.mjs'
// Shared, auditable field validation for the Stock Entry item editor.
// Only send changed master fields; quantities and item IDs are never part of this patch.
export const stockItemEditableFields=[
 'description','category','main_group','subgroup','brand','size','uom','movement','max_stock','remarks'
]

export function stockItemEditPatch(original={},draft={}){
 const patch={}
 for(const key of stockItemEditableFields){
  let next
  if(key==='max_stock'){
   const raw=String(draft[key]??'').trim()
   if(raw==='')throw new Error('Maximum stock is required.')
   next=Number(raw)
   if(!Number.isFinite(next)||next<0)throw new Error('Maximum stock must be zero or a positive number.')
  }else{
   next=String(draft[key]??'').trim()
   if(['description','category','uom'].includes(key)&&!next)throw new Error((key==='description'?'Item name':key==='category'?'Category':'UOM')+' is required.')
   if(ITEM_TEXT_FIELDS.includes(key))next=key==='remarks'?uppercaseItemText(next):normalizeItemText(next)
   if(key==='movement'){
    next=next.toUpperCase()
    if(!['FAST','NORMAL','SLOW'].includes(next))throw new Error('Choose FAST, NORMAL or SLOW movement.')
   }
  }
  const previous=key==='max_stock'?Number(original[key]??0):ITEM_TEXT_FIELDS.includes(key)?(key==='remarks'?uppercaseItemText(String(original[key]??'').trim()):normalizeItemText(original[key])):String(original[key]??'').trim()
  if(next!==previous)patch[key]=next
 }
 return patch
}
