'use client'
import {companySubmissionNext} from '@/lib/purchasing-next-step.mjs'
import {companySubmissionMessage} from '@/lib/company-submission-result.mjs'
import {stockSubmissionOutcome} from '@/lib/stock-submission-outcome.mjs'
export function CompanySubmissionResult({result,navigate,canNavigate=()=>true,onContinueCounting=()=>{}}){
 if(!result)return null
 const purchaseVisible=canNavigate('requirements')||canNavigate('po')||canNavigate('rfq')
 const outcome=stockSubmissionOutcome(result,{company:true,purchaseVisible})
 const next=purchaseVisible?companySubmissionNext(result):null
 const outcomes=result.stock_outcomes||[],orders=result.purchase_orders||[]
 return <section className="card pad section" aria-label="Company stock submission result">
  <h3>{outcome.title}</h3>
  <p role="status"><strong>{purchaseVisible?companySubmissionMessage(result):outcome.message}</strong></p>
  <div className="toolbar section">{next&&canNavigate(next.view)&&<button className="btn primary" onClick={()=>navigate(next.view,next.filter,next.step)}>{next.label} →</button>}<button className="btn" onClick={onContinueCounting}>Continue counting</button></div>
  {purchaseVisible&&(orders.length+(result.rfqs||[]).length)>0&&<details className="section"><summary>Created documents ({orders.length+(result.rfqs||[]).length})</summary><div className="toolbar section">
   {orders.map(p=><button key={p.id} className="btn small" disabled={!canNavigate('po')} onClick={()=>navigate('po',p.id)}>PO {p.po_no}</button>)}
   {(result.rfqs||[]).map(q=><button className="btn small" key={q.id||q.rfq_id} disabled={!canNavigate('rfq')} onClick={()=>navigate('rfq',q.id||q.rfq_id)}>RFQ {q.rfq_no}</button>)}
  </div></details>}
  {purchaseVisible&&result.dispatch&&<p>{result.dispatch.message||result.dispatch.error||'Review WhatsApp sending status.'}</p>}
  {purchaseVisible&&result.automation_errors?.length>0&&<p role="alert">Stock saved. Automation needs attention: {result.automation_errors.map(e=>e.error).join('; ')}</p>}
  {purchaseVisible&&result.rfqDispatch&&<p>{result.rfqDispatch.message||result.rfqDispatch.error||'Review RFQ sending status.'}</p>}
  {purchaseVisible&&outcomes.length>0&&<details><summary>Counted items and purchasing status ({outcomes.length})</summary>
   {outcomes.map((l,index)=><div key={index} className="section" style={{borderBottom:'1px solid var(--line)',paddingBottom:10}}>
    <strong>{l.description}</strong>
    <p className="tiny">Current: {l.sufficient_stock?'Sufficient':l.current_stock} · Stock shortage: {l.shortage_qty} · In existing POs: {l.committed_qty} · Uncovered: {l.uncovered_qty}</p>
    <p className="tiny">{l.reason}</p>
    {(l.orders||[]).map(p=><button key={p.id} className="btn small" disabled={!canNavigate('po')} onClick={()=>navigate('po',p.id)}>PO {p.number} · {p.status} · {p.qty} unit(s)</button>)}
    {(l.rfqs||[]).map(q=><p key={q.id} className="tiny">RFQ {q.number} · {q.status}</p>)}
   </div>)}
  </details>}
 </section>
}
