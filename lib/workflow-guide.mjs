export const PROCUREMENT_STEPS=[
 {id:1,title:'Stock entry',view:'stock',hint:'Enter stock and submit. Shortages automatically continue to review.'},
 {id:2,title:'Review & approve',view:'requirements',hint:'Select the shortages, check quantities and approve to continue.'},
 {id:3,title:'Create & send RFQ',view:'requirements',hint:'Choose suppliers and create the request. Send each supplier their RFQ.'},
 {id:4,title:'Supplier quotes',view:'rfq',hint:'Choose a supplier, enter prices and save to continue to comparison.'},
 {id:5,title:'Compare prices',view:'rfq',hint:'Compare supplier prices and select the items you want to order.'},
 {id:6,title:'Create & send orders',view:'rfq',hint:'Review the order before creating it. Send the purchase orders to suppliers.'}
]
export function stepForView(view){return {stock:1,requirements:2,rfq:4,po:6,receiving:6}[view]||1}
export function viewForStep(step,hasRfq=false){return step===3&&hasRfq?'rfq':PROCUREMENT_STEPS.find(s=>s.id===step)?.view||'stock'}
