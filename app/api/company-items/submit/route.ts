import {companyAccess,companyReply} from '@/lib/company-server'
import {POST as processOrders} from '../orders/route'
import {POST as processRfqs} from '../rfqs/route'
import {submittedRfqIds} from '@/lib/company-rfq-dispatch-scope.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 try{
  const {db}=await companyAccess(request),raw=await request.text();if(raw.length>250000)throw new Error('Stock submission is too large.')
  const body=JSON.parse(raw)
  const {data,error}=await db.rpc('proc_submit_company_list_check_v3',{p_submission_id:body.submissionId,p_company_id:body.companyId,p_lines:body.lines,p_notes:body.notes||null,p_count_started_at:body.startedAt||null})
  if(error)throw error
  let dispatch=null
  if(data.purchase_orders?.some((po:{auto_send:boolean})=>po.auto_send)){
   // Processing continues server-side even if the browser leaves after submitting.
   const response=await processOrders(new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:request.headers.get('authorization')||''},body:JSON.stringify({companyId:body.companyId,poIds:data.purchase_orders.filter((po:{auto_send:boolean})=>po.auto_send).map((po:{id:string})=>po.id)})}))
   dispatch=await response.json()
  }
  let rfqDispatch=null
  if(data.rfqs?.length){
   const rfqIds=submittedRfqIds(data.rfqs)
   const response=await processRfqs(new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:request.headers.get('authorization')||''},body:JSON.stringify({companyId:body.companyId,rfqIds})}))
   rfqDispatch=await response.json()
  }
  return companyReply({ok:true,...data,dispatch,rfqDispatch})
 }catch(e){return companyReply({ok:false,error:e instanceof Error?e.message:'Company stock submission failed.'},400)}
}
