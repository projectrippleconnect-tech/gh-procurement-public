export const rejectionActions=[
 ['replacement_requested','Request a replacement','Keeps the delivery balance open. No stock is added.'],
 ['replacement_received','Replacement arrived','Adds the full rejected quantity to stock. Use only when all replacements arrive and have not already been recorded in Deliveries.'],
 ['credit_note_requested','Request a credit note','Tracks the credit due. The delivery balance stays open.'],
 ['credit_note_received','Credit note received','Resolves this case. Cancel the delivery balance or buy elsewhere in Orders.'],
 ['returned_to_supplier','Goods returned','Records the return. A replacement, credit or loss still needs to be settled.'],
 ['close_other','Resolve another way','Closes the case without adding stock. Explain the settlement, including any replacement already recorded in Deliveries.'],
 ['accept_loss','Accept the loss','Resolves this case without adding stock. The delivery balance still needs a decision in Orders.']
]
export function receiptReview(lines,payload){
 return payload.map(row=>{
  const line=lines.find(l=>l.id===row.po_line_id)
  const previous=(line?.grn||[]).filter(g=>g.receipt?.status==='posted').reduce((n,g)=>n+Number(g.accepted_qty||0),0)
  return {...row,item:line?.item,remaining:Math.max(0,Number(line?.qty||0)-Number(line?.cancelled_qty||0)-previous-row.accepted_qty)}
 })
}
export function rejectionNextAction(status){return status==='replacement_due'?'replacement_received':status==='credit_note_due'?'credit_note_received':'replacement_requested'}

// Recover uncertain attempts even when their order has since become received.
export function pendingReceiptOrderIds(storage,userId){
 const prefix='gh_receiving_draft_v1:'+userId+':'
 const ids=[]
 try{for(let i=0;i<storage.length;i++){
  const key=storage.key(i);if(!key?.startsWith(prefix))continue
  const id=key.slice(prefix.length);if(!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id))continue
  try{const value=JSON.parse(storage.getItem(key));if(value?.receiptKey&&Array.isArray(value?.attempt?.lines)&&value.attempt.lines.length)ids.push(id)}catch{}
 }}catch{}
 return ids
}
