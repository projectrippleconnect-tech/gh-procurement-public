import test from 'node:test'
import assert from 'node:assert/strict'
import {orderProgress,stageForTask,normalizeInterface,FONT_DEFAULTS,sriLankaTimestamp} from '../lib/procurement-journey.mjs'
test('viewing a task cannot increase order completion',()=>{
 assert.equal(orderProgress().percent,0)
 assert.equal(orderProgress({prepared:true}).percent,20)
 assert.equal(stageForTask(3,'rfq'),1)
 assert.equal(stageForTask(6,'rfq'),2)
 assert.equal(stageForTask(6,'po'),3)
})
test('partially priced and partly sent orders stay below complete',()=>{
 const base={prepared:true,invitations:[{status:'sent'},{status:'sent'}],itemCount:4,pricedCount:4,orders:[{status:'sent'},{status:'approved'}]}
 assert.equal(orderProgress(base).percent,93)
 assert.equal(orderProgress({...base,orders:[{status:'sent'},{status:'received'}]}).percent,100)
 assert.equal(orderProgress({...base,pricedCount:2}).complete,false)
 assert.equal(orderProgress({...base,orders:[{status:'cancelled'}]}).percent,65)
})
test('opening WhatsApp alone is not a completed send',()=>{
 assert.equal(orderProgress({prepared:true,invitations:[{status:'prepared',opened:true}]}).sent,0)
 assert.equal(orderProgress({prepared:true,invitations:[{status:'quoted'}]}).sent,0)
})
test('font settings recover defaults and constrain invalid values',()=>{
 assert.deepEqual(normalizeInterface().mobile,FONT_DEFAULTS)
 const result=normalizeInterface({mobile:{description:999,reorder:-4,input:'bad',spacing:100},desktop:{size:20}})
 assert.equal(result.mobile.description,24);assert.equal(result.mobile.reorder,12)
 assert.equal(result.mobile.input,16);assert.equal(result.mobile.spacing,14);assert.equal(result.desktop.size,20)
 assert.equal(result.desktop.reorder,18)
})
test('submission time is explicitly Sri Lanka time',()=>{
 assert.match(sriLankaTimestamp('2026-10-12T09:00:00Z'),/02:30|2:30/)
 assert.equal(sriLankaTimestamp('invalid'),'—')
})

test('rounding must never mark a nearly complete order complete',()=>{
 const p=orderProgress({prepared:true,invitations:[{status:'sent'}],itemCount:1000,pricedCount:999,orders:[{status:'sent'}]})
 assert.equal(p.percent,99);assert.equal(p.complete,false)
})
