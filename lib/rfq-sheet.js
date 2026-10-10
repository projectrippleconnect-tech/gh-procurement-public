// Pure RFQ sheet helpers: filters never mutate quote drafts or the master RFQ.
export function matchesRfqItem(row,search='',category=''){
 const item=row.requirement?.item||row.item||{}
 const text=[item.description,item.size,item.item_code,item.brand,item.category].filter(Boolean).join(' ').toLocaleLowerCase()
 return (!category||item.category===category)&&String(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every(word=>text.includes(word))
}
export function supplierRequestItems(items,invitation,scopes=[]){
 if(Array.isArray(invitation?.requested_item_ids)){
  const selected=new Set(invitation.requested_item_ids)
  return items.filter(row=>selected.has(row.id))
 }
 const coverage=scopes.filter(scope=>scope.supplier_id===invitation?.supplier_id)
 if(!coverage.length||invitation?.scope_override_reason)return items
 return items.filter(row=>{
  const item=row.requirement?.item||row.item||{}
  return coverage.some(s=>s.scope_type==='item'?s.item_id===item.id:['category','main_group','subgroup'].includes(s.scope_type)&&s.scope_value===item[s.scope_type])
 })
}
export function quoteSheetRows(items,comparison,search='',filter='all'){
 return items.filter(row=>matchesRfqItem(row,search)).map(row=>{
  const quotes=comparison.filter(q=>q.rfq_item_id===row.id)
  const lowest=quotes.length?Math.min(...quotes.map(q=>Number(q.unit_price))):null
  return {row,quotes,lowest}
 }).filter(({row,quotes})=>filter==='missing'?quotes.length===0:filter==='priced'?quotes.length>0:filter==='single'?quotes.length===1:filter==='excluded'?row.selected_for_po===false:filter==='limited'?quotes.length>0&&quotes.every(q=>q.available_qty!=null&&Number(q.available_qty)<Number(row.requested_qty)):true)
}

// Review keeps deliberate exclusions. The explicit "select priced" action can include them.
export function pricedReviewSelection(items,comparison,includeExcluded=false){
 const priced=new Set(comparison.map(q=>q.rfq_item_id))
 return items.map(row=>({...row,selected_for_po:priced.has(row.id)&&(includeExcluded||row.selected_for_po!==false)}))
}
