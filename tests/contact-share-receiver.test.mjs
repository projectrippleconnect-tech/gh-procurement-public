import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {webcrypto} from 'node:crypto'
import {pendingPhoneContact,PHONE_SHARE_TTL} from '../lib/pending-phone-contact.mjs'
import {parseSharedPhoneContact} from '../lib/shared-phone-contact.mjs'
const origin='https://fixture.invalid'
function worker(){
 const handlers={},data=new Map()
 const cache={keys:async()=>[...data.keys()].map(url=>new Request(url)),match:async key=>data.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,response)=>data.set(key.url,response.clone()),delete:async key=>data.delete(typeof key==='string'?key:key.url)}
 vm.runInNewContext(readFileSync(new URL('../public/gh-contact-share-sw.js',import.meta.url),'utf8'),{self:{location:{origin},crypto:webcrypto,addEventListener:(name,handler)=>handlers[name]=handler},caches:{open:async()=>cache},URL,Request,Response,Date,Number})
 return {data,cache,receive:request=>{let response;handlers.fetch({request,respondWith:p=>response=p});return response}}
}
const card='BEGIN:VCARD\nVERSION:3.0\nFN:Sales Rep\nTEL:0771234567\nEND:VCARD'
test('worker receives native-style contact share locally and redirects with an opaque id',async()=>{
 const w=worker(),form=new FormData()
 form.append('contact',new File([card],'contact.vcf',{type:'text/x-vcard'}))
 const response=await w.receive(new Request(origin+'/share/contact/receive',{method:'POST',body:form}))
 assert.equal(response.status,303)
 const target=new URL(response.headers.get('location'))
 assert.equal(target.origin,origin);assert.equal(target.pathname,'/share/contact');assert.match(target.searchParams.get('share'),/^[a-f0-9]{32}$/)
 assert.ok(!target.href.includes('0771234567'))
 const stored=await w.cache.match([...w.data.keys()][0])
 assert.deepEqual(parseSharedPhoneContact(await stored.json()),[{name:'Sales Rep',phone:'+94771234567'}])
})
test('worker passes ordinary app traffic through without caching auth or network responses',()=>{
 const w=worker()
 for(const path of ['/','/api/health','/api/company-items/submit','/_next/static/file.js'])assert.equal(w.receive(new Request(origin+path)),undefined)
 assert.equal(w.receive(new Request('https://other.invalid/share/contact/receive',{method:'POST'})),undefined)
 assert.equal(w.data.size,0)
})
test('empty, unsupported and excessive shares produce visible errors without retaining content',async()=>{
 for(const [form,error] of [[new FormData(),'empty'],[(()=>{const f=new FormData();f.append('contact',new File(['no'],'x.pdf',{type:'application/pdf'}));return f})(),'empty'],[(()=>{const f=new FormData();f.append('contact',new File(['x'.repeat(2*1024*1024+1)],'x.vcf'));return f})(),'too-large']]){
  const w=worker(),response=await w.receive(new Request(origin+'/share/contact/receive',{method:'POST',body:form}))
  assert.equal(new URL(response.headers.get('location')).searchParams.get('error'),error);assert.equal(w.data.size,0)
 }
})
test('temporary shares have bounded retention and stale cache entries are removed',async()=>{
 const w=worker()
 await w.cache.put(new Request(origin+'/old'),new Response(JSON.stringify({createdAt:Date.now()-PHONE_SHARE_TTL-1})))
 for(let i=0;i<7;i++){
  const form=new FormData();form.append('text','Supplier\n0771234567')
  await w.receive(new Request(origin+'/share/contact/receive',{method:'POST',body:form}))
 }
 assert.equal(w.data.has(origin+'/old'),false);assert.equal(w.data.size,5)
})
test('pending contact is account-bound and expires without touching the supplier directory',()=>{
 const value={id:'a'.repeat(32),userId:'one',name:'Sales',phone:'0771234567',createdAt:1000}
 assert.equal(pendingPhoneContact(value,'one',1001).phone,'+94771234567')
 assert.equal(pendingPhoneContact(value,'two',1001),null)
 assert.equal(pendingPhoneContact(value,'',1001),null)
 assert.equal(pendingPhoneContact(value,'one',1000+PHONE_SHARE_TTL+1),null)
 assert.equal(pendingPhoneContact(value,'one',999),null)
 assert.equal(pendingPhoneContact({...value,id:'../x'},'one',1001),null)
})
