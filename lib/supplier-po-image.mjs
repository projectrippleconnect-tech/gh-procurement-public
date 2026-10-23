import {companyOrderImages} from './company-order-image.mjs'
import {defaultSupplierTemplate} from './supplier-template.mjs'
// Reuse the paginated renderer without its Direct PO label: these are quoted POs.
export async function supplierPoImages(job){
 if(!job.lines?.length||job.lines.length>35)throw Error('Use manual dispatch for this order')
 const template={...defaultSupplierTemplate('po'),...job.document_template}
 return companyOrderImages({...job,kind:'rfq',template:{...template,fields:{no:true,uom:true,rate:false,remarks:true}}})
}
