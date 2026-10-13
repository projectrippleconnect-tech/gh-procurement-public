import {normalizeQuantityInput,isQuantityInput} from './quantity-input.mjs'
export const COMPANY_REVIEW_FIELDS=[['description','Item name'],['size','Size'],['uom','UOM'],['category','Category'],['subgroup','Subcategory'],['max_stock','Target stock'],['brand','Brand'],['external_code','Item code'],['movement','Movement'],['main_group','Main category group']]
const clean=v=>String(v??'').trim()
export function companyReviewRow(values={},defaults={}){
 return {description:'',size:'',uom:'PCS',category:'GENERAL',subgroup:'',max_stock:'0',brand:'',external_code:'',movement:'NORMAL',main_group:'',...defaults,...values,selected:values.selected??true}
}
// Keep uncertain lines for human review; never guess corrected spellings or save OCR directly.
export function parseCompanyBillPages(pages,defaults={}){
 const rows=[]
 for(const page of pages||[]){
  const lines=page.ocrLines?.length?page.ocrLines:String(page.text||'').split(/\r?\n/).map(text=>({text,confidence:null}))
  for(const line of lines){
   const raw=clean(line.text)
   if(!/[a-z\u0b80-\u0bff\u0d80-\u0dff]/i.test(raw)||/^(?:page\b|description\b|item\s+(?:code|description)\b|price list\b|company\b|telephone\b|tel\b|email\b|total\b|sub\s*total\b|grand total\b|invoice\b|bill\s*(?:no|number|date)\b|date\b|vat\b|discount\b|balance\b|payment\b|tax\b)/i.test(raw))continue
   const cells=raw.split(/\t+|\s{2,}/).map(clean).filter(Boolean)
   // OCR/PDF geometry supplies separated columns. Remove the numeric quantity/rate/amount tail.
   while(cells.length>1&&/^(?:(?:rs\.?|lkr)\s*)?[\d,]+(?:\.\d+)?(?:\s*%\s*)?$/i.test(cells.at(-1)))cells.pop()
   if(cells.length>1&&/^\d+[.)]?$/.test(cells[0]))cells.shift()
   let description=cells.join(' ').replace(/^\d+[.)]?\s+(?=[a-z])/i,'')
   // With flat text, only strip a decimal money suffix; integers may be part of an item name.
   description=description.replace(/\s+(?:(?:rs\.?|lkr)\s*)?\d[\d,]*\.\d{2}(?:\s+\d[\d,]*\.\d{2})*\s*$/i,'').trim()
   const size=description.match(/\b\d+(?:\.\d+)?\s*(?:[x×]\s*\d+(?:\.\d+)?\s*)?(?:mm|cm|mtr|ft|feet|inch|ltr|litre|kg|ml)\b|\b\d+\/\d+\s*(?:inch|in)?\b/i)?.[0]||''
   const uom=description.match(/\b(PCS|PC|EA|BOX|BAG|PKT|ROLL|SET|PAIR|SHEET|NOS)\b/i)?.[0]||''
   let external_code=''
   const first=description.split(/\s+/)[0]
   if(/^(?=.*[a-z])(?=.*\d)[a-z\d._/-]{2,24}$/i.test(first)){external_code=first;description=description.slice(first.length).trim()}
   if(size)description=description.replace(size,' ').trim()
   if(uom)description=description.replace(new RegExp('\\b'+uom+'\\b','i'),' ').trim()
   if(!description)description=raw
   rows.push(companyReviewRow({description:description.replace(/\s+/g,' '),size,uom:uom?(['PC','EA','NOS'].includes(uom.toUpperCase())?'PCS':uom.toUpperCase()):'PCS',external_code,raw_line:raw,source_page:page.page||1,extraction_confidence:line.confidence,selected:false},defaults))
  }
 }
 return rows
}
export function parseCompanySpreadsheet(text,defaults={}){
 const lines=String(text||'').split(/\r?\n/).filter(x=>x.trim())
 if(lines.length>1000)throw new Error('Paste at most 1,000 rows at a time.')
 if(!lines.length)return []
 const keys=COMPANY_REVIEW_FIELDS.map(([key])=>key)
 const aliases=new Map(COMPANY_REVIEW_FIELDS.flatMap(([key,label])=>[[key,key],[label.toLowerCase(),key]]))
 aliases.set('description','description');aliases.set('subcategory','subgroup');aliases.set('target stock','max_stock')
 const first=lines[0].split('\t').map(v=>aliases.get(clean(v).toLowerCase()))
 const header=first[0]==='description'&&first.every(Boolean)
 const fields=header?first:keys
 return lines.slice(header?1:0).map(line=>{
  const cells=line.split('\t');if(cells.length>fields.length)throw new Error('Too many columns. Use the displayed paste column order or include matching column headings.')
  return companyReviewRow(Object.fromEntries(cells.map((v,i)=>[fields[i],clean(v)])),defaults)
 })
}
export function companyReviewPayload(rows){
 const selected=rows.filter(r=>r.selected&&!r.status)
 if(!selected.length)throw new Error('Select reviewed items before adding.')
 return selected.map(r=>{
  const row=Object.fromEntries(COMPANY_REVIEW_FIELDS.map(([key])=>[key,clean(r[key])]))
  row.uom=row.uom.toUpperCase();row.movement=row.movement.toUpperCase();row.max_stock=normalizeQuantityInput(row.max_stock)??row.max_stock
  if(!row.description||!row.category||!row.uom||!isQuantityInput(row.max_stock)||!Number.isFinite(Number(row.max_stock))||!['FAST','NORMAL','SLOW'].includes(row.movement))throw new Error('Each selected row needs an item name, category, UOM, FAST/NORMAL/SLOW movement and a non-negative target stock.')
  return {...row,item_code:row.external_code,max_stock:Number(row.max_stock)}
 })
}
