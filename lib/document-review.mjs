const normalized=value=>String(value||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()

// Quantity suggestions deliberately require a quantity label or unit, never a trailing price.
export function receiptRows(text,lines=[]){
 return String(text||'').split(/\r?\n/).map(raw=>raw.trim()).filter(raw=>raw&& !/^--- Page|^(?:total|subtotal|tax|vat|invoice|date|qty|description)\b/i.test(raw)).map((raw,index)=>{
  const explicit=raw.match(/\b(?:qty|quantity|received)\s*[:=]?\s*(\d+(?:\.\d+)?)/i)
  const unit=raw.match(/\b(\d+(?:\.\d+)?)\s*(?:pcs?|nos?|ea|boxes?|bags?|sets?|rolls?|sheets?)\b/i)
  const count=explicit||unit
  const tokens=' '+normalized(raw)+' '
  const matches=lines.filter(l=>{const code=normalized(l.item?.item_code);return code&&tokens.includes(' '+code+' ')})
  const names=matches.length?matches:lines.filter(l=>{const name=normalized(l.item?.description),size=normalized(l.item?.size);return name&&tokens.includes(' '+name+' ')&&(!size||tokens.includes(' '+size+' '))})
  return {id:String(index),raw,lineId:names.length===1?names[0].id:'',qty:count?count[1]:'',selected:false}
 }).filter(r=>r.lineId||r.qty!=='')
}

export function reviewedReceipt(rows,lines){
 const selected=rows.filter(r=>r.selected),seen=new Set()
 if(!selected.length)throw new Error('Select at least one reviewed row.')
 return selected.map(r=>{
  const line=lines.find(l=>l.id===r.lineId),n=Number(r.qty)
  if(!line)throw new Error('Choose a PO item for every selected row.')
  if(r.qty===''||!Number.isFinite(n)||n<=0)throw new Error('Enter a positive received quantity for every selected row.')
  if(seen.has(r.lineId))throw new Error('Two selected rows use the same PO item. Combine their quantities into one row.')
  seen.add(r.lineId)
  return {lineId:r.lineId,received:String(n)}
 })
}
