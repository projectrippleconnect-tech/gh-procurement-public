import test from 'node:test'
import assert from 'node:assert/strict'
import {selectedRequirementRows,eligibleRfqRequirements,paginateRfqItems} from '../lib/review-selection.mjs'
import {createSupplierPriceRequestPngs,shareSupplierPriceRequestPng} from '../lib/rfq-share.js'

const rows=Array.from({length:152},(_,i)=>({id:String(i),description:'ITEM '+i,status:'open',approval_status:i<100?'approved':'pending_review',remaining_to_order:12,has_active_rfq:false}))
test('152-item selection persists across pages and includes a mixed review state',()=>{
 const selected=new Set(rows.map(r=>r.id))
 const result=selectedRequirementRows(selected,rows,rows.slice(140).map(r=>({...r,remaining_to_order:24})))
 assert.equal(result.length,152)
 assert.equal(eligibleRfqRequirements(result).length,100)
 assert.equal(result[151].remaining_to_order,24)
 selected.delete('3');assert.equal(selectedRequirementRows(selected,rows,[]).length,151)
 assert.equal(eligibleRfqRequirements(rows.map(r=>({...r,approval_status:'approved'}))).length,152)
 assert.equal(eligibleRfqRequirements([{...rows[0],has_active_rfq:true},{...rows[1],remaining_to_order:0},{...rows[2],status:'closed'}]).length,0)
})
test('152 items split into six numbered pages at 30 rows or eight at 20',()=>{
 const pages=paginateRfqItems(rows,30)
 assert.deepEqual(pages.map(p=>p.items.length),[30,30,30,30,30,2])
 assert.deepEqual(pages.map(p=>p.startNumber),[1,31,61,91,121,151])
 assert.equal(pages[5].pageCount,6)
 assert.equal(pages.flatMap(p=>p.items).length,new Set(pages.flatMap(p=>p.items.map(x=>x.id))).size)
 assert.equal(paginateRfqItems(rows,20).length,8)
 assert.equal(paginateRfqItems(rows,40).length,4)
 assert.throws(()=>paginateRfqItems([],30),/at least one/)
 assert.throws(()=>paginateRfqItems(rows,0),/Choose/)
})
test('PNG generation and native sharing retain every page and global row numbers',async()=>{
 const originalDoc=globalThis.document,originalNav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),drawn=[]
 const ctx=new Proxy({font:'',measureText:s=>({width:String(s).length*12}),fillText:text=>drawn.push(text)},{get:(o,k)=>k in o?o[k]:()=>{},set:(o,k,v)=>(o[k]=v,true)})
 globalThis.document={createElement:()=>({getContext:()=>ctx,toBlob:cb=>cb(new Blob(['png'],{type:'image/png'}))})}
 let shared
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{canShare:()=>true,share:async data=>{shared=data}}})
 try{
  const args={rfq:{rfq_no:'RFQ-152'},items:rows.map(r=>({requested_qty:12,item:{description:r.description,uom:'PCS'}}))}
  const pages=await createSupplierPriceRequestPngs(args)
  assert.equal(pages.length,6);assert.match(pages[5].filename,/page-06-of-6/)
  assert.ok(drawn.includes('Page 6 of 6 · Items 151–152 of 152'))
  assert.ok(drawn.includes('152'))
  const result=await shareSupplierPriceRequestPng(args)
  assert.equal(result.shared,true);assert.equal(shared.files.length,6)
 }finally{
  globalThis.document=originalDoc
  if(originalNav)Object.defineProperty(globalThis,'navigator',originalNav);else delete globalThis.navigator
 }
})
