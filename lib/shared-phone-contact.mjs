import {parseCompanyVcards,toCompanyPhone} from './company-contacts.mjs'
function sharedTextCandidate(input) {
 const title=String(input?.title||'').trim()
 const text=String(input?.text||'').trim()
 if(!text)return[]
 if(/BEGIN:VCARD/i.test(text))return parseCompanyVcards(text,{maxCards:100})
 const matches=text.match(/(?:\+94|0094|0)[\s().-]*[0-9][0-9\s().-]{7,14}[0-9]/g)||[]
 const phone=matches.map(toCompanyPhone).find(Boolean)
 if(!phone)return[]
 const first=text.split(/\r?\n/).map(v=>v.trim()).find(v=>v&&!/(?:\+94|0094|0)[\s().-]*\d/.test(v)&&!/^tel|mobile|phone/i.test(v))
 return [{name:title||first||'Phone Contact',phone}]
}
export function parseSharedPhoneContact(payload={}) {
 const cards=Array.isArray(payload.cards)?payload.cards.filter(v=>typeof v==='string'):[]
 const candidates=cards.flatMap(card=>parseCompanyVcards(card,{maxCards:100}))
 candidates.push(...sharedTextCandidate(payload))
 const seen=new Set()
 return candidates.filter(c=>{
  const phone=toCompanyPhone(c.phone)
  if(!phone||seen.has(phone))return false
  seen.add(phone)
  c.phone=phone
  return true
 }).slice(0,100)
}
