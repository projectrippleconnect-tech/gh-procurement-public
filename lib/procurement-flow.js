import {normalizeQuantityInput} from './quantity-input.mjs'
export function remainingDelivery(line){
 const accepted=(line.grn||[]).filter(x=>!x.receipt||x.receipt.status==='posted').reduce((n,x)=>n+Number(x.accepted_qty||0),0)
 return Math.max(Number(line.qty||0)-Number(line.cancelled_qty||0)-accepted,0)
}
export function receivingValue(previous,key,value){
 if(['received','accepted','rejected'].includes(key)){const normalized=normalizeQuantityInput(value);if(normalized===null)return previous;value=normalized}
 const next={...previous,[key]:value}
 if(key==='received'&&(previous.accepted===''||Number(previous.accepted)===Number(previous.received)))next.accepted=value
 if(key==='rejected'&&next.received!=='')next.accepted=String(Math.max(Number(next.received)-Number(value||0),0))
 return next
}
export function nextRequirementAction(row){
 if(row.approval_status==='held')return 'Review hold reason'
 if(row.approval_status==='pending_review')return 'Review stock requirement'
 if(Number(row.remaining_to_order)>0)return row.has_active_rfq?'Enter prices / compare':'Request supplier prices'
 if(Number(row.ordered_not_received)>0)return 'Receive / follow up delivery'
 return 'Complete'
}
export function poSendBlock({po,canEdit,ready,loading,gateway,busy}){
 if(!canEdit)return 'Your account cannot send purchase orders.'
 if(po?.status!=='approved')return po?.status==='pending_approval'?'Approve this purchase order before sending.':'Only an approved, unsent PO can be sent.'
 if(!po?.supplier?.whatsapp&&!po?.supplier?.phone)return 'Add the supplier’s WhatsApp number in Suppliers.'
 if(busy)return 'Preparing / sending the image…'
 if(!ready)return 'Loading order lines…'
 if(loading||!gateway)return 'Checking WhatsApp connection…'
 if(gateway.error)return gateway.error
 if(!gateway.connected)return 'WhatsApp is disconnected. Refresh status or use manual sharing.'
 if(!gateway.sendingEnabled)return 'Gateway sending is disabled.'
 if(gateway.dispatches?.length)return 'A send attempt already exists. Check WhatsApp before any resend.'
 return ''
}

// Continue existing documents before offering a request for uncovered quantities.
export function urgentPurchaseSteps(row,data={},can=()=>false){
 const steps=[]
 const requests=[...new Map((data.requests||[]).filter(r=>r.rfq&&!['cancelled','closed','awarded'].includes(r.rfq.status)).map(r=>[r.rfq_id,r])).values()]
 const orders=[...new Map((data.orders||[]).filter(l=>l.po&&l.po.status!=='cancelled').map(l=>[l.po_id,l])).values()]
 if(can('procurement.requirements.manage')&&['pending_review','held'].includes(row.approval_status))steps.push({view:'requirements',id:'requirement:'+row.id,label:'Review and approve this item',step:2})
 for(const r of requests)if(can('procurement.rfq.view'))steps.push({view:'rfq',id:r.rfq_id,label:(['prepared','draft'].includes(r.rfq.status)?'Select suppliers / send RFQ':r.rfq.status==='quoted'?'Compare prices / create PO':'Enter prices / compare')+' · '+r.rfq.rfq_no,step:['prepared','draft'].includes(r.rfq.status)?3:4})
 for(const l of orders)if(can('procurement.orders.view'))steps.push({view:'po',id:l.po_id,label:(l.po.status==='pending_approval'?'Review / approve PO':l.po.status==='approved'?'Send PO':['sent','partially_received'].includes(l.po.status)?'Follow up / view PO':'View PO')+' · '+l.po.po_no,step:5})
 if(row.approval_status==='approved'&&Number(row.remaining_to_order)>0&&!row.has_active_rfq&&!requests.length&&can('procurement.requirements.manage'))steps.push({view:'requirements',id:'requirement:'+row.id,label:'Choose suppliers / prepare RFQ for remaining quantity',step:3})
 return steps
}
