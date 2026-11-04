import test from 'node:test'
import assert from 'node:assert/strict'
import {deliveryProgress} from '../lib/delivery-progress.mjs'
test('only accepted quantities on posted receipts fulfil a PO',()=>{
 const p=deliveryProgress([{qty:10,grn:[{accepted_qty:3,receipt:{status:'posted'}},{accepted_qty:7,receipt:{status:'draft'}}]}])
 assert.equal(p.percent,30);assert.equal(p.remaining,7);assert.equal(p.remainingLines,1)
})
test('cancelled balances close the balance without claiming receipt',()=>{
 const p=deliveryProgress([{qty:10,cancelled_qty:4,grn:[{accepted_qty:6,receipt:{status:'posted'}}]}])
 assert.equal(p.percent,60);assert.equal(p.remaining,0);assert.equal(p.cancelled,4)
})
test('full posted receipts reach 100 and empty orders stay zero',()=>{
 assert.equal(deliveryProgress([{qty:10,grn:[{accepted_qty:10,receipt:{status:'posted'}}]}]).percent,100)
 assert.equal(deliveryProgress().percent,0)
})

test('large-quantity items do not hide another unfulfilled line',()=>{
 const p=deliveryProgress([{qty:1000,grn:[{accepted_qty:1000,receipt:{status:'posted'}}]},{qty:1,grn:[]}])
 assert.equal(p.percent,50);assert.equal(p.remainingLines,1);assert.equal(p.completeLines,1)
})
