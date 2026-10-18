// One editable stock lot per handler. Duplicates are item IDs, never count rows.
export function stockLotReview(entry={},sufficient={},labels={},finalized={},recountAllowed=new Set()){
 const ids=new Set([
  ...Object.keys(entry).filter(id=>entry[id]!==undefined&&entry[id]!==''&&!sufficient[id]),
  ...Object.keys(sufficient).filter(id=>sufficient[id]===true)
 ])
 const rows=[...ids].map(id=>({
  id,description:labels[id]||id,
  sufficient:sufficient[id]===true,
  quantity:sufficient[id]===true?null:entry[id],
  previous:finalized[id]||null,
  requiresRecount:!!finalized[id]&&!recountAllowed.has(id)
 })).sort((a,b)=>a.description.localeCompare(b.description))
 return {rows,count:rows.length,blocked:rows.filter(r=>r.requiresRecount),overLimit:rows.length>1000}
}
