import {choicesFromPicker} from './company-contacts.mjs'

// Chrome owns the native picker; GH Procurement receives only selected contacts
// or a rejection. An empty response is not evidence that the user's address
// book itself is empty.
export function contactPickerOutcome({selection,error}={}){
 if(error){
  const kind=String(error.name||'')
  if(kind==='AbortError'||kind==='NotAllowedError')
   return {ok:false,code:'cancelled',message:'The phone contact picker closed without sharing a contact. Your entered name and number are still here. Try Import .vcf or enter the contact manually.'}
  if(kind==='SecurityError')
   return {ok:false,code:'blocked',message:'This browser could not open its contact picker. Try Pick from phone directly, or use Import .vcf.'}
  return {ok:false,code:'unavailable',message:'Android could not provide a contact to this browser. Your form is unchanged. Import a .vcf contact from Files or enter the name and number manually.'}
 }
 const contacts=choicesFromPicker(selection)
 if(!contacts.length)return {ok:false,code:'empty',message:'The phone picker returned no usable Sri Lankan number. If it shows “No contacts found” or closes when searching, this is the Android/Chrome picker. Your form is unchanged. Import a .vcf file or enter the contact manually.'}
 return {ok:true,code:'selected',contacts}
}
