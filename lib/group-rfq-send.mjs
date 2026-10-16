import {routeTemplate,routeCaption} from './company-route-template.mjs'
// Uses the same audited, unique RFQ/supplier dispatch as the RFQ screen.
// Never create another RFQ here: callers can resume this document after interruption.
export async function sendGroupRfqImages({db,rfqId,template={},request,createImage,encode,onResult=()=>{}}){
 const [document,items,invitations]=await Promise.all([
  db.from('proc_rfqs').select('*').eq('id',rfqId).single(),
  db.from('proc_rfq_items').select('*,requirement:proc_requirements(*,item:proc_items(*))').eq('rfq_id',rfqId).order('id').limit(1000),
  db.from('proc_rfq_suppliers').select('supplier_id,status,supplier:proc_suppliers(id,name,phone,whatsapp)').eq('rfq_id',rfqId).order('supplier_id')
 ])
 for(const value of [document,items,invitations])if(value.error)throw value.error
 if(!items.data?.length)throw new Error('No RFQ items are available to send.')
 if(items.data.length===1000)throw new Error('This RFQ is too large for group sending. Open the RFQ screen.')
 const gateway=await request('/api/integrations/whatsapp/rfq?rfqId='+encodeURIComponent(rfqId))
 if(!gateway.connected||!gateway.sendingEnabled)throw new Error('Connect WhatsApp and enable sending in RFQs. The saved route and prepared RFQ are retained.')
 const results=[]
 for(const invitation of invitations.data||[]){
  const previous=gateway.dispatches?.find(d=>d.supplier_id===invitation.supplier_id)
  if(previous||!['pending','prepared'].includes(invitation.status)){
   const result={supplierId:invitation.supplier_id,name:invitation.supplier?.name,status:previous?.status||invitation.status,message:'Existing attempt retained; no duplicate sent.'}
   results.push(result);onResult(result);continue
  }
  // An explicitly configured company-group RFQ invites every selected supplier
  // for all its items (the preparing RPC records the supplier scope override).
  const t=routeTemplate(template,'rfq')
  const args={rfq:document.data,items:items.data,supplier:invitation.supplier,company:{name:t.name,documentTitle:t.title,documentNote:t.note,documentTemplate:{fields:{...t.fields,qty:true,item:true}}}}
  const png=await createImage(args)
  if(png.blob.size>4_500_000)throw new Error('RFQ image is too large. Open the RFQ screen to adjust its fields.')
  const pngBase64=await encode(png.blob)
  const caption=routeCaption({kind:'rfq',template:t,rfq_no:document.data.rfq_no,supplier:invitation.supplier.name})
  try{
   const response=await request('/api/integrations/whatsapp/rfq',{rfqId,supplierId:invitation.supplier_id,pngBase64,caption})
   if(response.status!=='accepted')throw new Error('Sending result is uncertain. Check WhatsApp before resending.')
   const result={supplierId:invitation.supplier_id,name:invitation.supplier.name,status:'accepted',message:'Image and caption accepted by WhatsApp.'}
   results.push(result);onResult(result)
  }catch(error){
   const result={supplierId:invitation.supplier_id,name:invitation.supplier.name,status:'check_required',message:error.message}
   results.push(result);onResult(result)
   // Stop on interrupted/rejected sends. Resume re-reads the server audit.
   break
  }
 }
 return results
}
