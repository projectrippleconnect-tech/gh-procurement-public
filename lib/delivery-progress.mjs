export function deliveryProgress(lines=[]) {
 let ordered=0,accepted=0,cancelled=0,remainingLines=0,ratios=0,lineCount=0,completeLines=0,remaining=0
 for(const line of lines){
  const qty=Math.max(0,Number(line.qty)||0)
  const cancel=Math.min(qty,Math.max(0,Number(line.cancelled_qty)||0))
  const received=(line.grn||[]).filter(g=>g.receipt?.status==='posted').reduce((n,g)=>n+Math.max(0,Number(g.accepted_qty)||0),0)
  if(qty>0){lineCount++;ratios+=Math.min(qty,received)/qty;if(received>=qty)completeLines++}
  ordered+=qty;cancelled+=cancel;accepted+=Math.min(qty,received)
  const left=Math.max(0,qty-cancel-received);remaining+=left
  if(left>0)remainingLines++
 }
 return {ordered,accepted,cancelled,remaining,remainingLines,lineCount,completeLines,percent:lineCount?Math.min(100,Math.floor(ratios/lineCount*100)):0}
}
