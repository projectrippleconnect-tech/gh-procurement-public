'use client'
import {qty,itemTitle} from '@/lib/helpers'
import {receivingValue,remainingDelivery} from '@/lib/procurement-flow'
import {allReceivedAccepted,acceptReceived} from '@/lib/receipt-inspection.mjs'

// One responsive row avoids separate desktop/mobile inputs with duplicate labels.
export function ReceiptLine({line,value={},disabled,show,onChange,full,onFull}){
 const title=itemTitle(line.item||{}),accepted=allReceivedAccepted(value)
 const entered=Number(value.received)>0,needsInspection=entered&&!accepted
 return <article className="receipt-inspection-row" aria-label={title}>
  <div className="receipt-inspection-main">
   <div><strong>{title}</strong><div className="muted tiny">Remaining {qty(remainingDelivery(line))} {line.item?.uom||''}</div></div>
   {show('received_qty')&&<label className="field">Received now<input aria-label={'Received '+title} className="input" inputMode="decimal" disabled={disabled} value={value.received??''} onChange={e=>onChange(receivingValue(value,'received',e.target.value))}/></label>}
   {show('accepted_qty')&&<label className="checkline"><input aria-label={'All accepted '+title} type="checkbox" checked={accepted} disabled={disabled||!entered} onChange={e=>onChange(acceptReceived(value,e.target.checked))}/>All accepted</label>}

  </div>
  <details className="receipt-inspection-details" open={needsInspection||Number(value.rejected)>0||undefined}>
   <summary>{needsInspection?'Inspect accepted / rejected quantities':'Details / damage'}{Number(value.rejected)>0?' · '+qty(value.rejected)+' rejected':''}</summary>
   <label className="checkline"><input aria-label={'Full receipt '+title} type="checkbox" checked={full} disabled={disabled||remainingDelivery(line)<=0} onChange={e=>onFull(e.target.checked)}/>Full delivery accepted</label>
   <div className="muted tiny">Ordered {qty(line.qty)} · Cancelled {qty(line.cancelled_qty)}</div>
   <div className="receipt-inspection-fields">
    {show('accepted_qty')&&<label className="field">Accepted<input aria-label={'Accepted '+title} className="input" inputMode="decimal" disabled={disabled} value={value.accepted??''} onChange={e=>onChange(receivingValue(value,'accepted',e.target.value))}/></label>}
    {show('rejected_qty')&&<label className="field">Rejected<input aria-label={'Rejected '+title} className="input" inputMode="decimal" disabled={disabled} value={value.rejected??''} onChange={e=>onChange(receivingValue(value,'rejected',e.target.value))}/></label>}
    {show('rejection_reason')&&<label className="field">Reason<input aria-label={'Rejection reason '+title} className="input" disabled={disabled} value={value.reason??''} onChange={e=>onChange(receivingValue(value,'reason',e.target.value))}/></label>}
   </div>
  </details>
 </article>
}
