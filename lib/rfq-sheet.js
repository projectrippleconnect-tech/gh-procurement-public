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
 const byItem=new Map()
 for(const quote of comparison){
  const bucket=byItem.get(quote.rfq_item_id)
  if(bucket)bucket.push(quote)
  else byItem.set(quote.rfq_item_id,[quote])
 }
 return items.filter(row=>matchesRfqItem(row,search)).map(row=>{
  const quotes=byItem.get(row.id)||[]
  const lowest=quotes.length?quotes.reduce((n,q)=>Math.min(n,Number(q.unit_price)),Infinity):null
  return {row,quotes,lowest}
 }).filter(({row,quotes})=>filter==='missing'?quotes.length===0:filter==='priced'?quotes.length>0:filter==='single'?quotes.length===1:filter==='excluded'?row.selected_for_po===false:filter==='limited'?quotes.length>0&&quotes.every(q=>q.available_qty!=null&&Number(q.available_qty)<Number(row.requested_qty)):true)
}

// Review keeps deliberate exclusions. The explicit "select priced" action can include them.
export function pricedReviewSelection(items,comparison,includeExcluded=false){
 const priced=new Set(comparison.map(q=>q.rfq_item_id))
 return items.map(row=>({...row,selected_for_po:priced.has(row.id)&&(includeExcluded||row.selected_for_po!==false)}))
}

// Only persisted prices count as received; draft inputs never dismiss follow-ups.
export function supplierQuoteProgress(items,invitations,lines,scopes=[],{now=Date.now(),dueDate='',reminderHours=24}={}){
 return invitations.map(invitation=>{
  const requested=supplierRequestItems(items,invitation,scopes)
  const priced=new Set(lines.filter(line=>line.supplier_id===invitation.supplier_id&&line.unit_price!=null&&String(line.unit_price).trim()!==''&&Number.isFinite(Number(line.unit_price))&&Number(line.unit_price)>=0).map(line=>line.rfq_item_id))
  const received=requested.filter(item=>priced.has(item.id)).length
  const missing=requested.length-received
  const waiting=missing>0&&invitation.status!=='declined'
  const sent=Date.parse(invitation.sent_at||'')
  const today=new Date(now+330*60000).toISOString().slice(0,10)
  const reminderDue=waiting&&(Boolean(dueDate&&dueDate<today)||(Number.isFinite(sent)&&now-sent>=Math.max(1,Number(reminderHours)||24)*3600000))
  const label=invitation.status==='declined'?'Declined':!requested.length?'No items requested':!missing?'Prices entered':received?'Partial prices':invitation.status==='quoted'?'Prices not entered':['pending','prepared'].includes(invitation.status)?'Not sent':'Awaiting prices'
  return {...invitation,received,missing,total:requested.length,waiting,reminderDue,label}
 })
}
export function nextQuoteSupplier(progress,currentSupplier){
 const index=progress.findIndex(row=>row.supplier_id===currentSupplier)
 return index<0?null:progress.slice(index+1).find(row=>row.waiting)||null
}
