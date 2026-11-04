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
