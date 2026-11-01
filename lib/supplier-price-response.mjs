export const PRICE_REVIEW_NOTE='Price and availability confirmed only. Commercial terms require staff review.'
// Existing commercial values remain in the response/history, but the simplified
// form cannot confirm terms it does not show. The round engine excludes these
// responses until commercial terms have been reviewed through the staff flow.
export function supplierPriceResponse(lines=[]){
 return lines.map(line=>{
  const {id,status,price,quantity,notes,image,variations=[],uom}=line
  const savedTerms=Object.fromEntries(['discount','tax','freight_unit','moq','multiple','lead_days','valid_until'].filter(k=>line[k]!==undefined).map(k=>[k,line[k]]))
  const cleanNote=String(notes||'').replace(PRICE_REVIEW_NOTE,'').trim()
  return {...savedTerms,id,status,uom,terms_confirmed:false,confirmation_scope:'price_availability',
   price:status==='in_stock'?price:null,quantity:status==='in_stock'?quantity:null,
   notes:(PRICE_REVIEW_NOTE+(cleanNote?' '+cleanNote:'')).slice(0,500),image:image||null,
   variations:variations.map(v=>({...v,image:v.image||null}))}
 })
}
export function missingSupplierPrice(items=[],lines=[]){
 return items.find(item=>{
  const row=lines.find(x=>x.id===item.id)
  return !row||row.status==='skip'||row.status==='in_stock'&&(
   String(row.price??'').trim()===''||!Number.isFinite(Number(row.price))||Number(row.price)<=0||
   String(row.quantity??'').trim()===''||!Number.isFinite(Number(row.quantity))||Number(row.quantity)<=0)
 })
}
