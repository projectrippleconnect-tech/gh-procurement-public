/**
 * Direct Android phone contacts through GH Procurement's trusted native app.
 *
 * Chrome's navigator.contacts.select is unavailable/broken on some devices.
 * The native bridge opens an in-app searchable Android contacts view instead.
 * Only one explicitly selected name/phone travels from Android to the page.
 */
export function nativePhoneContactsAvailable(win=typeof window==='undefined'?null:window) {
 return Boolean(win && typeof win.GHProcurementAndroid?.pickLocalPhoneContact==='function'
  && typeof win.addEventListener==='function' && typeof win.removeEventListener==='function')
}

export function pickNativePhoneContact(win=typeof window==='undefined'?null:window,{timeoutMs=300000}={}) {
 if(!nativePhoneContactsAvailable(win))return Promise.reject(new Error('GH Procurement Android contact selection is unavailable in this browser.'))
 return new Promise((resolve,reject)=>{
  const requestId='ghc_'+(win.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)+Date.now().toString(36)).replaceAll('-','')
  let timeout
  let completed=false
  function complete(error,choice){
   if(completed)return
   completed=true
   if(timeout)win.clearTimeout(timeout)
   win.removeEventListener('gh-procurement-native-contact',onReply)
   if(error)reject(error)
   else resolve(choice)
  }
  function onReply(evt){
   const result=evt?.detail
   if(!result||result.requestId!==requestId)return
   if(result.status==='selected'){
    const name=String(result.name||'').trim()
    const phone=String(result.phone||'').trim()
    if(!phone)return complete(new Error('Selected phone contact has no number. Choose another contact.'))
    return complete(null,[{name:[name],tel:[phone]}])
   }
   if(result.status==='cancelled')return complete(Object.assign(new Error('Contact selection cancelled.'),{name:'AbortError'}))
   if(result.status==='permission_denied')return complete(new Error('Allow Contacts permission for GH Procurement in Android Settings → Apps → GH Procurement → Permissions → Contacts, then try again.'))
   return complete(new Error('The Android contacts list could not open. Check GH Procurement app permissions, then try again.'))
  }
  win.addEventListener('gh-procurement-native-contact',onReply)
  timeout=win.setTimeout(()=>complete(new Error('Android contact selection timed out. Try opening it again.')),timeoutMs)
  try{win.GHProcurementAndroid.pickLocalPhoneContact(requestId)}
  catch(error){complete(error)}
 })
}
