export const defaultSupplierTemplate=kind=>({name:'',title:kind==='po'?'PURCHASE ORDER':'REQUEST FOR QUOTATION',note:'',caption:kind==='po'?'{company_name} — Purchase Order\nPO: {po_number}\nSupplier: {supplier_name}\nPlease see the attached order and confirm availability and delivery.':'{company_name} — Supplier Price Request\nRFQ: {rfq_number}\nSupplier: {supplier_name}\nDue: {due_date}\nPlease see the attached request and reply with unit rates.',fields:{no:true,qty:true,uom:true,item:true,rate:true},overrides:{}})
export function documentCompany(company={},template){return template?{...company,name:template.name?.trim()||company.name||'General Hardware',documentTitle:template.title,documentNote:template.note,documentTemplate:template}:company}
export function documentLines(lines=[],template){return lines.map(line=>{const override=template?.overrides?.[line.id];if(!override)return line;const base=line.requirement?.item||line.item||{};const item={...base,...Object.fromEntries(['description','size','uom'].filter(k=>typeof override[k]==='string').map(k=>[k,override[k]]))};return line.requirement?{...line,requirement:{...line.requirement,item}}:{...line,item}})}
export function documentCaption(template,{company,rfq,po,supplier}={}){
 const values={company_name:company?.name||'General Hardware',rfq_number:rfq?.rfq_no||'',po_number:po?.po_no||'',supplier_name:supplier?.name||po?.supplier?.name||'',due_date:rfq?.due_date||'Not specified'}
 const result=String(template).replaceAll('\\n','\n').replace(/\{(company_name|rfq_number|po_number|supplier_name|due_date)\}/g,(_,key)=>values[key]).trim()
 if(!result||result.length>2000)throw new Error('Caption must contain 1–2000 characters.')
 return result
}
