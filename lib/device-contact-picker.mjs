import {choicesFromPicker} from './company-contacts.mjs'

// The device owns the native picker. It can close itself when contacts are
// hidden/unavailable and supplies no error details to a website in many cases.
// Treat cancellation and an empty native result as recoverable, never a form reset.
export function interpretContactPickerResult({selected,error,supported=true}={}){
 if(!supported)return {status:'unsupported',choices:[],showFallback:true}
 if(error){
  if(['AbortError','NotAllowedError','InvalidStateError','SecurityError'].includes(error.name))
   return {status:'dismissed',choices:[],showFallback:true}
  return {status:'failed',choices:[],showFallback:true}
 }
 const choices=choicesFromPicker(Array.isArray(selected)?selected:[])
 if(!choices.length)return{status:'empty',choices:[],showFallback:true}
 return{status:'selected',choices,showFallback:false}
}
export function contactPickerStatusMessage(status){
 switch(status){
  case 'unsupported':return 'Direct contacts are unavailable in this browser. Import a .vcf file from Contacts instead.'
  case 'dismissed':return 'The phone contact picker closed without a selection. Your supplier details are unchanged. Use Import .vcf or enter manually.'
  case 'empty':return 'The phone picker returned no usable contacts. Check that contacts are visible in your phone Contacts app or import a .vcf file.'
  case 'failed':return 'Android could not complete the contact selection. Import a .vcf file or enter the contact manually.'
  default:return ''
 }
}
