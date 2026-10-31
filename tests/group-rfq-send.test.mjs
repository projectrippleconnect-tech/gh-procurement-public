import test from 'node:test'
import assert from 'node:assert/strict'
import {sendGroupRfqImages} from '../lib/group-rfq-send.mjs'
function fixture({offline=false,previous=[],failAt='',itemError=null}={}){
 const posts=[],images=[]
 const tables={proc_rfqs:{data:{id:'rfq',rfq_no:'RFQ-1'}},proc_rfq_items:{data:[{id:'line',requested_qty:3}],error:itemError},proc_rfq_suppliers:{data:['one','two'].map(id=>({supplier_id:id,status:'pending',supplier:{id,name:id}}))}}
 const db={from(table){const q={then(resolve,reject){return Promise.resolve(tables[table]).then(resolve,reject)}};for(const method of ['select','eq','single','order','limit'])q[method]=()=>q;return q}}
 const args={db,rfqId:'rfq',request:async(path,body)=>{if(!body)return{connected:!offline,sendingEnabled:true,dispatches:previous};posts.push(body);if(body.supplierId===failAt)throw new Error('Interrupted — check WhatsApp');return{status:'accepted'}},createImage:async args=>{images.push(args);return{blob:{size:100}}},encode:async()=> 'PNG'}
 return {args,posts,images}
}
test('sends group RFQ image and caption separately to each selected supplier',async()=>{
 const f=fixture(),results=await sendGroupRfqImages(f.args)
 assert.deepEqual(results.map(r=>r.status),['accepted','accepted'])
 assert.deepEqual(f.posts.map(p=>p.supplierId),['one','two'])
 assert.equal(f.posts[0].pngBase64,'PNG');assert.match(f.posts[0].caption,/RFQ-1/)
 assert.equal(f.images[0].items[0].requested_qty,3)
})
test('resume skips accepted and uncertain audited attempts',async()=>{
 for(const status of ['accepted','unknown','sending','failed']){
  const f=fixture({previous:[{supplier_id:'one',status}]})
  const results=await sendGroupRfqImages(f.args)
  assert.equal(results[0].status,status);assert.deepEqual(f.posts.map(p=>p.supplierId),['two'])
 }
})
test('offline gateway leaves documents intact and sends nothing',async()=>{
 const f=fixture({offline:true});await assert.rejects(sendGroupRfqImages(f.args),/Connect WhatsApp/);assert.equal(f.posts.length,0);assert.equal(f.images.length,0)
})
test('interrupted request stops batch without automatic retry',async()=>{
 const f=fixture({failAt:'one'}),results=await sendGroupRfqImages(f.args)
 assert.equal(results[0].status,'check_required');assert.equal(f.posts.length,1)
})
test('data access error blocks sending before image creation',async()=>{
 const f=fixture({itemError:new Error('Access denied')});await assert.rejects(sendGroupRfqImages(f.args),/Access denied/);assert.equal(f.posts.length,0)
})
