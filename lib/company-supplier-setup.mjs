export function supplierSetupPlan({assigned=[],recipients=[],mode='manual',suppliers=[]}={}){
 const ids=[...new Set(assigned.filter(Boolean))],to=[...new Set(recipients.filter(Boolean))]
 if(!['manual','rfq','direct'].includes(mode))return {valid:false,error:'Choose what happens after stock submission.'}
 if(ids.length>15)return {valid:false,error:'Assign at most 15 suppliers.'}
 if(to.some(id=>!ids.includes(id)))return {valid:false,error:'Recipients must be selected from this supplier list.'}
 if(mode!=='manual'&&!to.length)return {valid:false,error:'Choose at least one recipient.'}
 if(mode==='direct'&&(ids.length!==1||to.length!==1))return {valid:false,error:'Direct PO needs exactly one assigned supplier and recipient.'}
 for(const id of ids){const s=suppliers.find(x=>x.id===id);if(!s||s.active===false)return {valid:false,error:'Remove or replace an unavailable supplier before saving.'}}
 if(mode!=='manual'&&to.some(id=>{const s=suppliers.find(x=>x.id===id);return !/^\+94\d{9}$/.test(s?.whatsapp||s?.phone||'')}))return {valid:false,error:'Automatic recipients need a valid +94 WhatsApp number.'}
 return {valid:true,assigned:ids,recipients:mode==='manual'?ids:to,mode}
}
