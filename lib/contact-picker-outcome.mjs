import {choicesFromPicker} from './company-contacts.mjs'

export function contactPickerOutcome({selection,error}={}){
 if(error){
  const kind=String(error.name||'')
  if(kind==='AbortError')return {ok:false,code:'cancelled',message:'No contact was shared. Your entered details are unchanged; tap Pick from phone to try again.'}
  if(kind==='NotAllowedError')return {ok:false,code:'denied',message:'The browser did not allow contact access. Check its Contacts permission in phone Settings, then try again.'}
  if(kind==='SecurityError')return {ok:false,code:'blocked',message:'Open the secure app directly in a browser tab, then tap Pick from phone again.'}
  if(kind==='NotSupportedError')return {ok:false,code:'unsupported',message:error.message||'Open this page in Chrome on Android to select a phone contact.'}
  if(kind==='InvalidStateError')return {ok:false,code:'busy',message:'Another contact picker may still be open. Close it and tap Pick from phone again.'}
  return {ok:false,code:'unavailable',message:'The browser could not share a contact. Try Pick phone number only and check the steps below. Your entered details are unchanged.'}
 }
 if(!Array.isArray(selection)||selection.length===0)return {ok:false,code:'empty',message:'The browser shared no contact. If the picker says “No contacts found,” check the steps below, then try Pick phone number only. Your entered details are unchanged.'}
 const contacts=choicesFromPicker(selection)
 if(!contacts.length)return {ok:false,code:'no_number',message:'The selected contact did not share a valid Sri Lankan phone number. Keep Phone numbers selected or try Pick phone number only.'}
 return {ok:true,code:'selected',contacts}
}
