// One vocabulary for navigation, guidance and progress. Legacy step IDs remain
// stable because saved drafts and navigation history still reference them.
export const PURCHASING_SECTIONS=Object.freeze([
 Object.freeze({label:'Review',view:'requirements',icon:'≡'}),
 Object.freeze({label:'Quotes',view:'rfq',icon:'₨'}),
 Object.freeze({label:'Orders',view:'po',icon:'▤'})
])
export const WORKFLOW_ACTIONS=Object.freeze([
 Object.freeze({id:1,title:'Count stock',view:'stock',hint:'Save the factual stock count. Any purchasing need continues to Work.'}),
 Object.freeze({id:2,title:'Review quantity',view:'requirements',hint:'Review the required quantities and approve, hold or reject them.'}),
 Object.freeze({id:3,title:'Assign supplier',view:'requirements',hint:'Use the configured quotation or Direct PO route for the approved quantity.'}),
 Object.freeze({id:4,title:'Follow up prices',view:'rfq',hint:'Prepare and send supplier requests, then save returned prices.'}),
 Object.freeze({id:5,title:'Compare prices',view:'rfq',hint:'Compare quantities and prices before selecting supplier orders.'}),
 Object.freeze({id:6,title:'Approve & send order',view:'rfq',hint:'Review supplier, quantities, prices, total and delivery. Quantity-only approval leaves prices unconfirmed.'})
])
