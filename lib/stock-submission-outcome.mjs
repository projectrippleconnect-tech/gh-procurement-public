// Present persisted results, never infer successful routing or sending from a count.
export function stockSubmissionOutcome(result={}, {company=false,purchaseVisible=true}={}){
 const saved={key:'saved',title:'No new purchase needed',message:'Stock is sufficient for this count.'}
 const purchase={key:'purchase_needed',title:'Purchase needed',message:'Continue through the configured supplier and approval route.'}
 const neutral={key:'saved',title:'Saved',message:'Stock count saved in history. You can continue counting.'}
 if(!purchaseVisible||result.automation?.status==='submitted')return {...neutral,needsAttention:false,attentionReason:''}
 const lines=Array.isArray(result.stock_outcomes)?result.stock_outcomes:[]
 const reasons=[...(result.automation_errors||[]).map(x=>x.error||'Purchasing automation needs review.')]
 if(result.dispatch?.ok===false)reasons.push(result.dispatch.error||'Review the PO sending status before retrying.')
 if(result.rfqDispatch?.ok===false)reasons.push(result.rfqDispatch.error||'Review the RFQ sending status before retrying.')
 if(lines.some(line=>line.needs_review))reasons.push('The count changed against existing purchasing records. Review the remaining quantities before continuing.')
 let outcome
 if(!company){
  if(result.automation?.status==='no_requirements')outcome=saved
  else if(result.automation?.status==='review_required')outcome={...purchase,message:'Shortages are waiting in Review.'}
 }else{
  const documents=result.purchase_orders?.length||result.rfqs?.length
  const uncovered=lines.some(line=>Number(line.uncovered_qty)>0)
  if(documents||uncovered||(!lines.length&&Number(result.requirements_created)>0))outcome=purchase
  else if(lines.length&&lines.every(line=>line.uncovered_qty!==null&&line.uncovered_qty!==undefined&&Number(line.uncovered_qty)===0))outcome={...saved,message:lines.some(line=>Number(line.shortage_qty)>0)?'Existing orders cover the shortage. Track their deliveries in Orders.':'Stock is sufficient for this count.'}
 }
 if(!outcome){outcome=neutral;reasons.push('Check the saved purchasing status before taking another action.')}
 return {...outcome,needsAttention:reasons.length>0,attentionReason:[...new Set(reasons)].join(' ')}
}

// Exact counts at/below reorder must not silently disappear behind 'Sufficient'.
export function sufficientStockOverrides(entry={},sufficient={},items=[]){
 return items.filter(item=>{
  const id=item.item_id||item.id,value=entry[id],threshold=item.reorder_level
  return sufficient[id]===true&&value!==''&&value!==undefined&&value!==null&&threshold!==null&&threshold!==undefined&&Number.isFinite(Number(value))&&Number.isFinite(Number(threshold))&&Number(value)<=Number(threshold)
 }).map(item=>({id:item.item_id||item.id,description:item.description||item.item?.description||item.id,quantity:Number(entry[item.item_id||item.id]),reorder:Number(item.reorder_level)}))
}
export function sufficientOverrideNotes(overrides,reason){
 if(!overrides.length)return null
 if(typeof reason!=='string'||reason.trim().length<5)throw new Error('Give a reason before overriding an exact shortage count.')
 return 'Sufficient-stock override: '+JSON.stringify({items:overrides,reason:reason.trim()})
}
