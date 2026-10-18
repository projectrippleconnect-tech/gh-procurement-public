import {normalizeCompanyMobile} from './company-contact-directory.mjs'

/** Review-only warnings: never merge supplier records solely by phone number. */
export function supplierNumberConflicts(records=[]) {
 const buckets=new Map()
 for(const record of records){
  const phone=normalizeCompanyMobile(record.whatsapp)||normalizeCompanyMobile(record.phone)
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
 return [...new Set(records.filter(s=>(normalizeCompanyMobile(s.whatsapp)||normalizeCompanyMobile(s.phone))===target)
  .map(s=>String(s.name||s.display_name||'').trim())
  .filter(name=>name&&name.toLocaleLowerCase()!==proposed))]
}
