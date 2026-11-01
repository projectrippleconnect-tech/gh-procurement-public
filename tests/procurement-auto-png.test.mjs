import test from 'node:test'
import assert from 'node:assert/strict'
import {inflateSync} from 'node:zlib'
import {verifyPng} from '../lib/waha-rfq.js'
import {renderProcurementPng} from '../lib/procurement-auto-png.mjs'

test('unattended RFQ image contains a valid readable-size PNG and actual drawing data',()=>{
 const out=renderProcurementPng({
  kind:'rfq',number:'RFQ-12345',supplier:'TEST SUPPLIER',dueDate:'2026-11-02',
  rows:[{description:'GI PIPE',size:'3/4 X 20 FT',qty:12,uom:'PCS'},{description:'PLASTIC ELBOW',size:'1/2',qty:7,uom:'PCS'}]
 })
 assert.equal(out.width,1536)
 assert.ok(out.height>=480)
 assert.ok(out.png.length<4_500_000)
 assert.deepEqual(verifyPng(out.base64),out.png)
 assert.equal(out.png[24],1,'1-bit grayscale')
 assert.equal(out.png[25],0)
 const idatSize=out.png.readUInt32BE(33)
 const expanded=inflateSync(out.png.subarray(41,41+idatSize))
 assert.equal(expanded.length,(Math.ceil(out.width/8)+1)*out.height)
 assert.ok(expanded.some(x=>x!==255),'document must contain black text pixels')
})

test('unattended PO image renders and refuses blank, unsupported, or unbounded documents',()=>{
 const sample={kind:'po',number:'PO-6',supplier:'SUPPLIER',rows:[{description:'NAILS',size:'2 X 4',qty:10,uom:'BOX',unitPrice:125.50,lineTotal:1255}]}
 assert.equal(renderProcurementPng(sample).png.subarray(0,8).toString('hex'),'89504e470d0a1a0a')
 assert.throws(()=>renderProcurementPng({...sample,rows:[]}),/1-120/)
 assert.throws(()=>renderProcurementPng({...sample,rows:[{description:'NAILS',qty:0}]}),/Incomplete/)
 assert.throws(()=>renderProcurementPng({...sample,rows:[{description:'\u0ba4\u0bae\u0bbf\u0bb4\u0bcd',qty:10}]}),/Unsupported character/)
 assert.throws(()=>renderProcurementPng({...sample,kind:'bad'}),/Invalid document kind/)
})
