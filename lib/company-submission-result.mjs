export function companySubmissionMessage(result){
 const lines=Array.isArray(result.stock_outcomes)?result.stock_outcomes:[]
 const orders=result.purchase_orders||[],rfqs=result.rfqs||[]
 const review=lines.filter(l=>l.needs_review).length
 const covered=lines.filter(l=>Number(l.shortage_qty)>0&&Number(l.uncovered_qty)===0).length
 const parts=[String(result.count_no||'Stock count')+' saved.']
 if(orders.length)parts.push('PO '+orders.map(p=>p.po_no).join(', ')+' created.')
 else parts.push('No new PO created.')
 if(rfqs.length)parts.push(rfqs.length+' RFQ(s) created.')
 if(review)parts.push(review+' item(s) need review; existing orders were not automatically increased.')
 else if(covered)parts.push('Existing purchase orders cover '+covered+' shortage item(s).')
 else if(lines.length&&!lines.some(l=>Number(l.shortage_qty)>0))parts.push('No purchasing needed for the counted items.')
 else if(!lines.length)parts.push('Review stock history and existing orders for the saved quantities.')
 return parts.join(' ')
}
