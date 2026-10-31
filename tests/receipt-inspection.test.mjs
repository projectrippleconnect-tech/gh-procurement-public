import test from 'node:test'
import assert from 'node:assert/strict'
import {allReceivedAccepted,acceptReceived} from '../lib/receipt-inspection.mjs'
import {receivingValue} from '../lib/procurement-flow.js'

test('typing a received quantity leaves acceptance unconfirmed until explicitly inspected',()=>{
 const received=receivingValue({received:'',accepted:'',rejected:'0',reason:''},'received','12')
 assert.equal(received.accepted,'');assert.equal(allReceivedAccepted(received),false)
 const accepted=acceptReceived(received,true)
 assert.equal(accepted.accepted,'12');assert.equal(allReceivedAccepted(accepted),true)
 const changed=receivingValue(accepted,'received','14')
 assert.equal(changed.accepted,'12');assert.equal(allReceivedAccepted(changed),false)
 assert.equal(acceptReceived(accepted,false).accepted,'')
})
test('rejected quantities preserve inspection detail and cannot count as all accepted',()=>{
 const partial=receivingValue({received:'12',accepted:'',rejected:'0'},'rejected','2')
 assert.equal(partial.accepted,'10');assert.equal(allReceivedAccepted(partial),false)
 for(const received of ['',undefined,'0','-1','NaN','Infinity']){
  const v={received,accepted:'',rejected:'0'}
  assert.equal(allReceivedAccepted(v),false);assert.deepEqual(acceptReceived(v,true),v)
 }
})
