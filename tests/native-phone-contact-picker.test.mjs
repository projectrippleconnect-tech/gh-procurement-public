import test from 'node:test'
import assert from 'node:assert/strict'
import {nativePhoneContactsAvailable,pickNativePhoneContact} from '../lib/native-phone-contact-picker.mjs'
function phoneHost() {
 const listeners=new Map()
 let requestId=null
 const host={
  crypto:{randomUUID:()=> '3f6b1c98-20db-4a22-b9cd-a94af006ef23'},
  GHProcurementAndroid:{pickLocalPhoneContact(id){requestId=id}},
  addEventListener(k,fn){listeners.set(k,fn)},
  removeEventListener(k,fn){if(listeners.get(k)===fn)listeners.delete(k)},
  setTimeout(fn,delay){return setTimeout(fn,delay)},
  clearTimeout(id){clearTimeout(id)},
  emit(detail){listeners.get('gh-procurement-native-contact')?.({detail})},
  get requestId(){return requestId},
  get activeListeners(){return listeners.size}
 }
 return host
}
test('native picker capability appears only in installed GH Procurement Android app',()=>{
 assert.equal(nativePhoneContactsAvailable(null),false)
 assert.equal(nativePhoneContactsAvailable({GHProcurementAndroid:{}}),false)
 assert.equal(nativePhoneContactsAvailable(phoneHost()),true)
})
test('only matching chosen contact is passed into supplier form and listener is released',async()=>{
 const host=phoneHost()
 const pending=pickNativePhoneContact(host)
 host.emit({requestId:'wrong',status:'selected',name:'Wrong',phone:'0771111111'})
 host.emit({requestId:host.requestId,status:'selected',name:'Alkathene Sales',phone:'0771234567'})
 assert.deepEqual(await pending,[{name:['Alkathene Sales'],tel:['0771234567']}])
 assert.equal(host.activeListeners,0)
})
test('permission denial is surfaced without returning any phonebook information',async()=>{
 const host=phoneHost(),pending=pickNativePhoneContact(host)
 host.emit({requestId:host.requestId,status:'permission_denied'})
 await assert.rejects(pending,/Allow Contacts permission/)
 assert.equal(host.activeListeners,0)
})
test('back button or user cancellation rejects with AbortError and cleans up',async()=>{
 const host=phoneHost(),pending=pickNativePhoneContact(host)
 host.emit({requestId:host.requestId,status:'cancelled'})
 await assert.rejects(pending,e=>e.name==='AbortError')
 assert.equal(host.activeListeners,0)
})
test('native bridge failure and no bridge both fail safely',async()=>{
 await assert.rejects(pickNativePhoneContact({}),/unavailable/)
 const host=phoneHost()
 host.GHProcurementAndroid.pickLocalPhoneContact=()=>{throw new Error('Native failure')}
 await assert.rejects(pickNativePhoneContact(host),/Native failure/)
 assert.equal(host.activeListeners,0)
})
test('native picker waits only bounded time and discards stale result',async()=>{
 const host=phoneHost()
 await assert.rejects(pickNativePhoneContact(host,{timeoutMs:5}),/timed out/)
 assert.equal(host.activeListeners,0)
})
