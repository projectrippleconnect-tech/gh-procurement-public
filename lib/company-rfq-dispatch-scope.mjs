// An automatic stock submission must dispatch only its own newly prepared RFQs.
// Omission of rfqIds remains supported for the explicitly requested queue processor.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function checkedRfqIds(ids){
 if(!Array.isArray(ids)||ids.length<1||ids.length>200||ids.some(id=>typeof id!=='string'||!uuid.test(id)))throw new Error('Select valid RFQ identifiers.')
 return [...new Set(ids)]
}
export function submittedRfqIds(rfqs){
 if(rfqs==null)return []
 if(!Array.isArray(rfqs))throw new Error('Invalid submitted RFQ results.')
 if(!rfqs.length)return []
 return checkedRfqIds(rfqs.map(r=>r?.rfq_id))
}
