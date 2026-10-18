import {normalizeCompanyMobile} from './company-contact-directory.mjs'

/** Identify the same Sri Lankan mobile stored in multiple directory entries.
 * A supplier can have phone and WhatsApp fields; it is counted once per number.
 * Company associations are distinct entries but route/directory copies of the
 * same company+supplier record should be supplied only once by the caller.
 */
export function contactNameKey(value) {
 return String(value??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en')
}
export function matchContactPhone(records,phone) {
 const number=normalizeCompanyMobile(phone)
 if(!number)return []
 return (records||[]).filter(r=>[r.phone,r.whatsapp].some(v=>normalizeCompanyMobile(v)===number))
}
export function duplicateContactNumbers(records) {
 const numbers=new Map()
 for(const [index,r] of (records||[]).entries()){
  const entryKey=[r.company_id??'',r.supplier_id??r.id??index].join(':')
  for(const number of new Set([normalizeCompanyMobile(r.phone),normalizeCompanyMobile(r.whatsapp)].filter(Boolean))){
   if(!numbers.has(number))numbers.set(number,new Map())
   numbers.get(number).set(entryKey,r)
  }
 }
 return [...numbers].flatMap(([phone,entries])=>{
  const contacts=[...entries.values()]
  if(contacts.length<2)return []
  const differentNames=new Set(contacts.map(r=>contactNameKey(r.name||r.display_name))).size>1
  return [{phone,contacts,differentNames,type:differentNames?'different-names':'same-name'}]
 }).sort((a,b)=>Number(b.differentNames)-Number(a.differentNames)||a.phone.localeCompare(b.phone))
}
