export const defaultRouteTemplate=mode=>({name:'General Hardware',title:mode==='rfq'?'REQUEST FOR QUOTATION':'PURCHASE ORDER',note:mode==='rfq'?'Please reply with unit rates, availability and remarks.':'Please confirm availability and delivery.',caption:'{company_name} — '+(mode==='rfq'?'Supplier Price Request\\nRFQ: {rfq_number}':'Purchase Order\\nPO: {po_number}')+'\\nSupplier: {supplier_name}\\nPlease see the attached image.',fields:{no:true,uom:true,rate:mode==='rfq',remarks:true}})
export function routeTemplate(value={},mode='direct'){
 const d=defaultRouteTemplate(mode)
 const result={...d,fields:{...d.fields}}
 for(const [key,max] of [['name',80],['title',60],['note',300],['caption',2000]]){
  if(value[key]!==undefined){if(typeof value[key]!=='string'||value[key].length>max)throw new Error('Invalid document '+key);result[key]=value[key].trim()}
 }
 for(const key of Object.keys(d.fields))if(typeof value.fields?.[key]==='boolean')result.fields[key]=value.fields[key]
 result.name||=d.name;result.title||=d.title;result.caption||=d.caption
 return result
}
export function routeCaption(job){
 const mode=job.kind==='rfq'?'rfq':'direct',t=routeTemplate(job.template,mode)
 return t.caption.replaceAll('\\n','\n').replace(/\{(company_name|supplier_name|rfq_number|po_number)\}/g,(_,key)=>({company_name:t.name,supplier_name:job.supplier,rfq_number:job.rfq_no||'',po_number:job.po_no||''}[key]||''))
}
export function routeImageModel(job){
 const t=routeTemplate(job.template,job.kind==='rfq'?'rfq':'direct')
 const direct=job.kind!=='rfq'
 if(direct){t.fields.rate=true;t.note=['Direct PO — RFQ bypassed',t.note].filter(Boolean).join('. ')}
 return {template:t,heading:t.name+' — '+t.title,lines:job.lines.map((l,index)=>({index:t.fields.no?index+1:null,description:[l.description,l.brand,l.size,l.colour,l.variation,t.fields.remarks?l.remarks:null].filter(Boolean).join(' · '),qty:String(l.qty)+(t.fields.uom?' '+String(l.uom||''):''),rate:direct?'Direct PO':t.fields.rate?'________':null}))}
}

// Replace the previous mode's standard wording while retaining custom branding.
export function switchRouteTemplate(value={},from='rfq',to='direct'){
 if(from===to)return value
 const before=defaultRouteTemplate(from),after=defaultRouteTemplate(to),next={...value}
 for(const key of ['title','note','caption'])if(value[key]===before[key])next[key]=after[key]
 return next
}
