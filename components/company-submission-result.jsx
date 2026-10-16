'use client'
import {companySubmissionMessage} from '@/lib/company-submission-result.mjs'
export function CompanySubmissionResult({result,navigate}){
 if(!result)return null
 const outcomes=result.stock_outcomes||[],orders=result.purchase_orders||[]
 return <section className="card pad section" aria-label="Company stock submission result">
  <p role="status"><strong>{companySubmissionMessage(result)}</strong></p>
  {orders.map(p=><button key={p.id} className="btn small" onClick={()=>navigate('po',p.id)}>Open PO {p.po_no}</button>)}
  {result.dispatch&&<p>{result.dispatch.message||result.dispatch.error||'Review WhatsApp sending status.'}</p>}
  {result.rfqDispatch&&<p>{result.rfqDispatch.message||result.rfqDispatch.error||'Review RFQ sending status.'}</p>}
  {outcomes.length>0&&<details><summary>Counted items and purchasing status ({outcomes.length})</summary>
   {outcomes.map((l,index)=><div key={index} className="section" style={{borderBottom:'1px solid var(--line)',paddingBottom:10}}>
    <strong>{l.description}</strong>
    <p className="tiny">Current: {l.sufficient_stock?'Sufficient':l.current_stock} · Stock shortage: {l.shortage_qty} · In existing POs: {l.committed_qty} · Uncovered: {l.uncovered_qty}</p>
    <p className="tiny">{l.reason}</p>
    {(l.orders||[]).map(p=><button key={p.id} className="btn small" onClick={()=>navigate('po',p.id)}>PO {p.number} · {p.status} · {p.qty} unit(s)</button>)}
    {(l.rfqs||[]).map(q=><p key={q.id} className="tiny">RFQ {q.number} · {q.status}</p>)}
   </div>)}
  </details>}
 </section>
}
