'use client'
import {deliveryProgress} from '@/lib/delivery-progress.mjs'
import {qty} from '@/lib/helpers'
export function DeliveryProgress({lines=[],loaded=true}){
 const p=deliveryProgress(lines)
 const mixedUnits=new Set(lines.map(l=>l.item?.uom||'unit')).size>1
 return <div className="order-progress delivery-progress" role="status"><div><strong>Delivery</strong><b>{loaded?p.percent+'% received':'Loading…'}</b></div><progress max="100" value={loaded?p.percent:0} aria-label="Accepted delivery progress" title="Average received percentage across order lines; cancelled quantities are not counted as received"/><small>{loaded?mixedUnits?`${p.completeLines} of ${p.lineCount} lines received in full · ${p.remainingLines} awaiting delivery`:`${qty(p.accepted)} of ${qty(p.ordered)} units accepted · ${p.remainingLines} lines awaiting delivery`:'Loading posted receipts…'}</small>{loaded&&p.cancelled>0&&<small>{qty(p.cancelled)} units cancelled · {p.remaining===0?'Delivery balance settled':'Balance remains open'}</small>}</div>
}
