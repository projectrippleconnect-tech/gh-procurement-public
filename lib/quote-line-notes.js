// Quotations keep the main RFQ item's quoted price in unit_price.
// Sizes with an explicit required quantity become separate RFQ/PO lines on save.
// Reference-only sizes never replace the original item.
const PREFIX='GH_QUOTE_NOTES_V1:'
const clamp=(v,max)=>String(v??'').trim().slice(0,max)

export function encodeSupplierQuoteNotes({remarks='',variants=[]}={}){
 const cleaned=(Array.isArray(variants)?variants:[]).slice(0,12).map(x=>({
  size:clamp(x?.size,100),price:String(x?.price??'').trim(),order_qty:String(x?.order_qty??x?.quantity??'').trim(),quantity:String(x?.order_qty??x?.quantity??'').trim(),remarks:clamp(x?.remarks,300)
 })).filter(x=>x.size||x.price||x.remarks)
 if(!clamp(remarks,500)&&cleaned.length===0)return null
 return PREFIX+JSON.stringify({remarks:clamp(remarks,500),variants:cleaned})
}

export function decodeSupplierQuoteNotes(raw){
 const text=String(raw??'')
 if(!text.startsWith(PREFIX))return {remarks:text,variants:[]}
 try{
  const parsed=JSON.parse(text.slice(PREFIX.length))
  return {
   remarks:clamp(parsed?.remarks,500),
   variants:Array.isArray(parsed?.variants)?parsed.variants.slice(0,12).map((v,i)=>({
    id:'saved-'+i,size:clamp(v?.size,100),price:String(v?.price??''),order_qty:String(v?.order_qty??v?.quantity??''),quantity:String(v?.order_qty??v?.quantity??''),remarks:clamp(v?.remarks,300)
   })):[]
  }
 }catch{
  return {remarks:text,variants:[]}
 }
}

export function validateSupplierQuoteVariants(variants){
 if(!Array.isArray(variants)||variants.length>12)return false
 return variants.every(v=>{
  const size=String(v?.size??'').trim()
  const price=String(v?.price??'').trim()
  const remarks=String(v?.remarks??'').trim()
  const qty=String(v?.order_qty??v?.quantity??'').trim()
  if(!size&&!price&&!remarks&&!qty)return true
  return size.length>0&&size.length<=100&&price.length>0&&price.length<=20
   &&Number.isFinite(Number(price))&&Number(price)>=0&&remarks.length<=300
   &&(!qty||(qty.length<=20&&Number.isFinite(Number(qty))&&Number(qty)>0))
 })
}

export function additionalSizeLines(items,prices){
 return items.flatMap(i=>(prices[i.id]?.variants||[]).filter(v=>String(v.order_qty??'').trim()).map(v=>({
  source_rfq_item_id:i.id,size:String(v.size||'').trim(),unit_price:Number(v.price),qty:Number(v.order_qty),remarks:String(v.remarks||'').trim()
 })))
}

export const normalizePriceInput=value=>String(value).replace(/^0+(?=\d)/,'')
