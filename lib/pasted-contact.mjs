import {toCompanyPhone} from './company-contacts.mjs'

// Plain text only. Never invent a name, truncate a long number, or reinterpret
// an overseas country code as a Sri Lankan number.
export function parsePastedContact(input){
 const text=String(input||'').trim().replace(/[\u200e\u200f\u202a-\u202e]/g,'').replace(/[–—]/g,'-')
 if(!text)return {ok:false,message:'Copy a contact number or name and number, then paste it here.'}
 if(text.length>4000)return {ok:false,message:'Paste one contact at a time (up to 4,000 characters).'}
 const phones=new Set(),nameLines=[]
 for(const line of text.split(/[\r\n;,|]+/)){
  let remainder=line
  // Newlines delimit numbers; formatting spaces/dashes stay within a number.
  for(const match of line.matchAll(/(?:\+|00)?\d[\d\t ().-]*\d|\d/g)){
   const raw=match[0].trim(),digits=raw.replace(/[^\d+]/g,'')
   const phone=toCompanyPhone(raw)
   if(phone)phones.add(phone)
   // Remove numeric data from name detection, including invalid country codes.
   if(digits.replace(/\D/g,'').length>=5)remainder=remainder.replace(match[0],' ')
  }
  const name=remainder.replace(/^(?:contact name|mobile|phone|telephone|tel|whatsapp|contact|name|number|work|home|cell)\s*:\s*/i,'').replace(/^(?:mobile|phone|telephone|tel|whatsapp|contact|name|number|work|home|cell)\s*$/i,'').replace(/^[\s:()\-]+|[\s:()\-]+$/g,'').trim().replace(/\s+/g,' ')
  if(name&&/[\p{L}]/u.test(name)&&!/[\d@/]/.test(name))nameLines.push(name)
 }
 if(!phones.size)return {ok:false,message:'No valid Sri Lankan phone number found. Paste a number such as 0771234567 or +94771234567.'}
 const names=[...new Set(nameLines)]
 if(names.length>1)return {ok:false,message:'Several name lines were found. Keep one contact name and its number, then try again.'}
 if(phones.size>10)return {ok:false,message:'Paste one contact with up to 10 numbers.'}
 return {ok:true,contacts:[...phones].map(phone=>({name:(names[0]||'').slice(0,160),phone}))}
}
