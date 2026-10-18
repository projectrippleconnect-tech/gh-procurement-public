import {normalizeCompanyMobile} from './company-contact-directory.mjs'

function supplierPhone(value){
 const digits=String(value??'').replace(/\D/g,'')
 return /^7\d{8}$/.test(digits)?'+94'+digits:normalizeCompanyMobile(value)
}

/** Review-only warnings: never merge supplier records solely by phone number. */
export function supplierNumberConflicts(records=[]) {
 const buckets=new Map()
 for(const record of records){
  const phone=supplierPhone(record.whatsapp)||supplierPhone(record.phone)
  if(!phone)continue
  const name=String(record.name||record.display_name||'').trim()
  if(!name)continue
  const existing=buckets.get(phone)||[]
  if(!existing.some(x=>x.id===record.id&&x.name===name))
   existing.push({id:record.id||null,name,kind:record.supplier_kind||record.kind||'directory',active:record.active!==false})
  buckets.set(phone,existing)
 }
 return [...buckets.entries()].filter(([,entries])=>new Set(entries.map(x=>x.name.toLocaleLowerCase())).size>1)
  .map(([phone,entries])=>({phone,entries}))
  .sort((a,b)=>a.phone.localeCompare(b.phone))
}

/** Search for known names associated with a typed number; never blocks a valid save. */
export function otherNamesForNumber(phone,records=[],proposedName=''){
 const target=normalizeCompanyMobile(phone)
 if(!target)return []
 const proposed=String(proposedName).trim().toLocaleLowerCase()
 return [...new Set(records.filter(s=>(supplierPhone(s.whatsapp)||supplierPhone(s.phone))===target)
  .map(s=>String(s.name||s.display_name||'').trim())
  .filter(name=>name&&name.toLocaleLowerCase()!==proposed))]
}
