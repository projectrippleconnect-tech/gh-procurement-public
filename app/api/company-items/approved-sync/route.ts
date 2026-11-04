import {companyAccess,companyBody,companyReply} from '@/lib/company-server'

export const runtime='nodejs'
export const dynamic='force-dynamic'

export async function POST(request:Request){
 try{
  // Important: data changes execute under the logged-in Super Admin JWT,
  // not a management token, service role, or simulated auth identity.
  const {db}=await companyAccess(request,true)
  const body=await companyBody(request)
  if(body.action==='preview'){
   const [total,completed,sample]=await Promise.all([
    db.from('proc_approved_company_labels_20261015').select('item_id',{head:true,count:'exact'}),
    db.from('proc_approved_company_labels_20261015').select('item_id',{head:true,count:'exact'}).not('applied_at','is',null),
    db.from('proc_approved_company_labels_20261015').select('expected_description,reviewed_description').is('applied_at',null).order('company_id').limit(8)
   ])
   for(const r of [total,completed,sample])if(r.error)throw r.error
   return companyReply({ok:true,total:total.count||0,completed:completed.count||0,
    remaining:(total.count||0)-(completed.count||0),sample:sample.data||[],
    message:'Names were approved on 15 October 2026. Existing IDs and quantities are preserved.'})
  }
  if(body.action!=='apply')throw new Error('Preview or apply approved names.')
  const result=await db.rpc('proc_apply_approved_company_labels_v1',{p_limit:80})
  if(result.error)throw result.error
  const applied=Number(result.data?.processed)||0,remaining=Number(result.data?.remaining)||0
  return companyReply({ok:true,applied,remaining,
   message:applied+' existing company items updated; '+remaining+' approved changes pending.'})
 }catch(error){
  return companyReply({ok:false,error:error instanceof Error?error.message:'Approved-name update failed.'},400)
 }
}
