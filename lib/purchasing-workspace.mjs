import {PURCHASING_SECTIONS} from './workflow-model.mjs'
export const PURCHASING_VIEWS=Object.freeze(PURCHASING_SECTIONS.map(s=>s.view))
export const QUOTE_WORK_STATUSES=Object.freeze(['draft','prepared','sent','partially_quoted','quoted'])
export function purchasingDestination(canNavigate,current=''){
 return PURCHASING_VIEWS.includes(current)&&canNavigate(current)?current:PURCHASING_VIEWS.find(canNavigate)||null
}
export function purchasingSection(view){return PURCHASING_SECTIONS.find(s=>s.view===view)?.label||''}
export function scopePurchasingQuery(query,type,field){return type==='all'?query:query.eq(field,type==='company')}
export function reviewWorkQuery(query){return query.eq('proc_review_work_pending',true)}
export function quoteWorkQuery(query){return query.in('status',QUOTE_WORK_STATUSES).eq('proc_rfq_work_pending',true)}
export function requirementAttention(row={}){
 if(row.approval_status==='held')return row.hold_reason||'This requirement is on hold. Review the hold reason before continuing.'
 if(row.approval_status==='approved'&&Number(row.remaining_to_order)>0&&!row.has_active_rfq)return 'Choose the supplier route for this approved quantity.'
 return ''
}
export function poAttention(po={},gateway=null){
 const attempts=gateway?.dispatches||[]
 if(attempts.some(x=>x.status==='unknown'))return 'Sending outcome is uncertain. Check supplier WhatsApp and the audit record before any retry.'
 if(attempts.some(x=>x.status==='failed'))return 'A sending attempt failed. Review its saved status before retrying.'
 if(gateway?.error)return gateway.error
 if(po.expected_date&&['sent','partially_received'].includes(po.status)&&po.expected_date<new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'}))return 'Delivery is overdue. Follow up the remaining order balance.'
 return ''
}
