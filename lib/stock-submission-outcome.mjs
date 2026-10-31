// Present persisted results, never infer successful routing or sending from a count.
export function stockSubmissionOutcome(result={}, {company=false,purchaseVisible=true}={}){
 const saved={key:'saved',title:'Stock sufficient',message:'No purchase is needed for this count.'}
 const purchase={key:'purchase_needed',title:'Purchase needed',message:'Continue through the configured supplier and approval route.'}
 const attention={key:'needs_attention',title:'Needs attention',message:'Stock is saved. Review the purchasing status before retrying.'}
 // The API intentionally redacts purchasing details for stock-only roles.
 if(!purchaseVisible||result.automation?.status==='submitted')return {...saved,title:'Saved',message:'Stock count saved in history. You can continue counting.'}
 if(result.automation_errors?.length||result.dispatch?.ok===false||result.rfqDispatch?.ok===false)return attention
 if(!company){
  if(result.automation?.status==='no_requirements')return saved
  if(result.automation?.status==='review_required')return {...purchase,message:'Shortages are waiting in To Review.'}
  return attention
 }
 const lines=Array.isArray(result.stock_outcomes)?result.stock_outcomes:[]
 if(lines.some(line=>line.needs_review))return attention
 if(result.purchase_orders?.length||result.rfqs?.length||Number(result.requirements_created)>0||lines.some(line=>Number(line.shortage_qty)>0||Number(line.uncovered_qty)>0))return purchase
 if(lines.length&&lines.every(line=>Number(line.shortage_qty)===0&&Number(line.uncovered_qty)===0))return saved
 return attention
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
