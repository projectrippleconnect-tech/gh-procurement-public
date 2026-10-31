import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {companyOrderImages} from '../lib/company-order-image.mjs'
const line={description:'Pipe & fittings <50mm>',uom:'PCS',qty:12,remarks:'Confirm size'}
const job={po_no:'PO-10',company:'ALCATHINE',supplier:'Main',lines:[line]}
test('quantity-only company order produces a real PNG with escaped supplier text',async()=>{
 const images=await companyOrderImages({...job,supplier:'Main <& "store">'})
 assert.equal(images.length,1)
 const meta=await sharp(images[0]).metadata()
 assert.equal(meta.format,'png');assert.equal(meta.width,1200);assert.ok(meta.height>200)
})
test('large orders split into bounded image pages instead of dropping rows',async()=>{
 const images=await companyOrderImages({...job,lines:Array.from({length:110},(_,i)=>({...line,description:'Item '+i}))})
 assert.ok(images.length>1)
 for(const image of images){const meta=await sharp(image).metadata();assert.ok(meta.height<3000)}
})
test('empty orders fail before contacting WhatsApp',async()=>{
 await assert.rejects(companyOrderImages({...job,lines:[]}),/no items/)
})
