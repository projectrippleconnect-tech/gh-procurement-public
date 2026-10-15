// Call select synchronously from the click. Never await permission/property checks
// before it: doing so can lose the user activation required by the browser.
export function openWebContactPicker({navigator:nav,window:win,properties=['name','tel'],numberOnly=false}){
 if(!win?.isSecureContext)return Promise.reject(Object.assign(new Error('Open the secure HTTPS app.'),{name:'SecurityError'}))
 if(win.top!==win.self)return Promise.reject(Object.assign(new Error('Open the app in its own browser tab.'),{name:'SecurityError'}))
 if(typeof nav?.contacts?.select!=='function')return Promise.reject(Object.assign(new Error('Phone contacts are unavailable in this browser. Open this page in Chrome on Android.'),{name:'NotSupportedError'}))
 const supported=Array.isArray(properties)?properties:['name','tel']
 if(!supported.includes('tel'))return Promise.reject(Object.assign(new Error('This browser cannot share phone numbers.'),{name:'NotSupportedError'}))
 const fields=numberOnly||!supported.includes('name')?['tel']:['name','tel']
 return nav.contacts.select(fields,{multiple:false})
}
