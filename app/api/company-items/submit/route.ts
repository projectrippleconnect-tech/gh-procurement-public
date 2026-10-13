import {companyAccess,companyReply} from '@/lib/company-server'
import {POST as processOrders} from '../orders/route'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 try{
  const {db}=await companyAccess(request),raw=await request.text();if(raw.length>250000)throw new Error('Stock submission is too large.')
  const body=JSON.parse(raw)
  const {data,error}=await db.rpc('proc_submit_company_list_check_v2',{p_company_id:body.companyId,p_lines:body.lines,p_notes:body.notes||null,p_count_started_at:body.startedAt||null})
  if(error)throw error
  let dispatch=null
  if(data.purchase_orders?.length){
   // Processing continues server-side even if the browser leaves after submitting.
   const response=await processOrders(new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:request.headers.get('authorization')||''},body:JSON.stringify({companyId:body.companyId})}))
   dispatch=await response.json()
  }
  return companyReply({ok:true,...data,dispatch})
 }catch(e){return companyReply({ok:false,error:e instanceof Error?e.message:'Company stock submission failed.'},400)}
}
