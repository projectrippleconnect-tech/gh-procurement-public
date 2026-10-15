// Only a contact explicitly selected by the user is saved. The device address book is never synced.
export function toCompanyPhone(value) {
 const raw=String(value||'').trim().replace(/^tel:/i,'').split(/[;,]/)[0].trim()
 const digits=raw.replace(/[\s().\-]/g,'')
 let local=digits
 if(/^0094\d+$/.test(local))local='+94'+local.slice(4)
 else if(/^94\d{9}$/.test(local))local='+'+local
 else if(/^0\d{9}$/.test(local))local='+94'+local.slice(1)
 else if(/^\d{9}$/.test(local))local='+94'+local
 return /^\+94\d{9}$/.test(local)?local:null
}
function unescapeVcard(value) {
 return String(value||'').replace(/\\n/gi,' ').replace(/\\([,;\\])/g,'$1').trim()
}
export function choicesFromPicker(selected=[]) {
 const result=[]
 for(const item of selected){
  const name=String(item.name?.[0]||'').trim()
  for(const number of item.tel||[])result.push({name,phone:String(number||'')})
 }
 return uniqueChoices(result)
}
export function uniqueChoices(rows=[]) {
 const seen=new Set(),out=[]
 for(const row of rows){
  const phone=toCompanyPhone(row.phone)
  const name=String(row.name||'').trim().slice(0,160)
  if(!phone||seen.has(phone))continue
  seen.add(phone);out.push({name:name||phone,phone})
 }
 return out
}
export function parseCompanyVcards(input,{maxCards=5000}={}) {
 // Unfold vCard 2.1/3.0/4.0 continuation lines; do not upload the file to a server.
 const lines=String(input||'').replace(/\r\n?/g,'\n').split('\n')
 const unfolded=[]
 for(const line of lines){
  if(/^[ \t]/.test(line)&&unfolded.length)unfolded[unfolded.length-1]+=line.slice(1)
  else unfolded.push(line)
 }
 const contacts=[];let card=null;let count=0
 function finish() {
  if(!card)return
  const fallback=card.n.split(';').filter(Boolean).reverse().join(' ')
  const name=unescapeVcard(card.fn||fallback)
  for(const tel of card.phones)contacts.push({name,phone:tel})
  card=null
 }
 for(const line of unfolded){
  if(/^BEGIN:VCARD$/i.test(line.trim())){finish();if(++count>maxCards)throw new Error('This contacts file is too large. Export a smaller selection.');card={fn:'',n:'',phones:[]};continue}
  if(/^END:VCARD$/i.test(line.trim())){finish();continue}
  if(!card)continue
  const colon=line.indexOf(':');if(colon<0)continue
  const key=line.slice(0,colon).split(';')[0].toUpperCase().split('.').pop()
  const value=line.slice(colon+1).trim()
  if(key==='FN')card.fn=value
  else if(key==='N')card.n=value
  else if(key==='TEL')card.phones.push(value)
 }
 finish()
 return uniqueChoices(contacts)
}
