export function companySubmissionNext(result={}){
 const lines=result.stock_outcomes||[],orders=result.purchase_orders||[],rfqs=result.rfqs||[]
 if(lines.some(x=>x.needs_review))return {view:'requirements',filter:'to_order',label:'Review remaining shortages',step:2}
 if(orders[0])return {view:'po',filter:orders[0].id,label:'Continue to purchase order',step:6}
 if(rfqs[0])return {view:'rfq',filter:rfqs[0].id||rfqs[0].rfq_id,label:'Continue to supplier request',step:3}
 const request=lines.flatMap(x=>x.rfqs||[]).find(x=>x.id)
 if(request)return {view:'rfq',filter:request.id,label:'Open existing supplier request',step:3}
 if(lines.some(x=>Number(x.uncovered_qty)>0)||Number(result.requirements_created)>0)return {view:'requirements',filter:'to_order',label:'Review shortages',step:2}
 const existing=lines.flatMap(x=>x.orders||[]).find(x=>x.id)
 if(existing)return {view:'po',filter:existing.id,label:'Track existing purchase order',step:6}
 return null
}
export function poNextStep(status){
 return ({pending_approval:'Approve this order',approved:'Send to the supplier, then confirm Sent',sent:'Record the delivery when goods arrive',partially_received:'Record the remaining delivery',received:'Delivery balance settled · review follow-ups and complete order',closed:'Order closed',cancelled:'Order cancelled'})[status]||'Review this order'
}
