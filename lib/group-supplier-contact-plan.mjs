import {toCompanyPhone} from './company-contacts.mjs'

// The picker and imported vCards stay local until a single contact is explicitly saved.
// Reusing the same phone number must not silently rename a different supplier.
export function planGroupSupplierSave({name,phone,editingId='',suppliers=[]}={}){
 const normalizedName=String(name||'').trim().slice(0,160)
 const normalizedPhone=toCompanyPhone(phone)
 if(!normalizedName)return{valid:false,error:'Enter a supplier name.'}
 if(!normalizedPhone)return{valid:false,error:'Enter a valid Sri Lankan phone number (+94 followed by 9 digits).'}
 const match=suppliers.find(s=>toCompanyPhone(s.phone||s.whatsapp)===normalizedPhone)
 if(editingId){
  if(!suppliers.some(s=>s.id===editingId))return{valid:false,error:'The supplier contact is no longer available. Refresh and try again.'}
  if(match&&match.id!==editingId)return{valid:false,error:'That number already belongs to '+match.name+'. Select that saved supplier instead.'}
  return{valid:true,action:'update',id:editingId,name:normalizedName,phone:normalizedPhone}
 }
 if(match)return{valid:true,action:'reuse',id:match.id,name:match.name,phone:normalizedPhone}
 return{valid:true,action:'create',name:normalizedName,phone:normalizedPhone}
}
