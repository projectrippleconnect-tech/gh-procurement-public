import {toCompanyPhone} from './company-contacts.mjs'
export const PHONE_SHARE_CACHE='gh-procurement-contact-shares-v2'
export const PHONE_SHARE_PREFIX='/_gh_private_shared_contact/'
export const PHONE_SHARE_PENDING='gh_phone_contact_pending_v1'
export const PHONE_SHARE_TTL=5*60*1000
export function pendingPhoneContact(value,userId,now=Date.now()){
 if(!value||!userId||value.userId!==userId||!Number.isFinite(value.createdAt)||value.createdAt>now||now-value.createdAt>PHONE_SHARE_TTL)return null
 const phone=toCompanyPhone(value.phone),name=String(value.name||'').trim().slice(0,160)
 if(!name||!phone||typeof value.id!=='string'||!/^[a-f0-9]{32}$/.test(value.id))return null
 return {id:value.id,userId,name,phone,createdAt:value.createdAt}
}
