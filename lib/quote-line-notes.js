// Quotations keep the main RFQ item's quoted price in unit_price.
// Optional alternative sizes are supplier reference information only and
// must never silently change the requested size in an approved purchase order.
const PREFIX='GH_QUOTE_NOTES_V1:'
const clamp=(v,max)=>String(v??'').trim().slice(0,max)

export function encodeSupplierQuoteNotes({remarks='',variants=[]}={}){
 const cleaned=(Array.isArray(variants)?variants:[]).slice(0,12).map(x=>({
  size:clamp(x?.size,100),price:String(x?.price??'').trim(),remarks:clamp(x?.remarks,300)
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
    id:'saved-'+i,size:clamp(v?.size,100),price:String(v?.price??''),remarks:clamp(v?.remarks,300)
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
  if(!size&&!price&&!remarks)return true
  return size.length>0&&size.length<=100&&price.length>0&&price.length<=20
   &&Number.isFinite(Number(price))&&Number(price)>=0&&remarks.length<=300
 })
}
