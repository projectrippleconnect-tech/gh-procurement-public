import {isQuantityInput} from './quantity-input.mjs'
import {MAX_STOCK_BATCH} from './stock-batch.mjs'

// One editable stock lot per handler. Duplicates are item IDs, never count rows.
export function stockLotReview(entry={},sufficient={},labels={},finalized={},recountAllowed=new Set()){
 const ids=new Set([
  ...Object.keys(entry).filter(id=>entry[id]!==undefined&&entry[id]!==''&&!sufficient[id]),
  ...Object.keys(sufficient).filter(id=>sufficient[id]===true),
  ...recountAllowed
 ])
 const rows=[...ids].map(id=>({
  id,description:labels[id]||id,
  sufficient:sufficient[id]===true,
  quantity:sufficient[id]===true?null:entry[id],
  previous:finalized[id]||null,
  requiresRecount:!!finalized[id]&&!recountAllowed.has(id),
  needsCount:sufficient[id]!==true&&!isQuantityInput(entry[id])
 })).sort((a,b)=>a.description.localeCompare(b.description))
 const blocked=rows.filter(r=>r.requiresRecount)
 const incomplete=rows.filter(r=>!r.requiresRecount&&r.needsCount)
 return {rows,count:rows.length,blocked,incomplete,ready:rows.length-blocked.length-incomplete.length,overLimit:rows.length>MAX_STOCK_BATCH}
}
