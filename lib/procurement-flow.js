export function remainingDelivery(line){
 const accepted=(line.grn||[]).filter(x=>!x.receipt||x.receipt.status==='posted').reduce((n,x)=>n+Number(x.accepted_qty||0),0)
 return Math.max(Number(line.qty||0)-Number(line.cancelled_qty||0)-accepted,0)
}
export function receivingValue(previous,key,value){
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
