import test from 'node:test'
import assert from 'node:assert/strict'
import {changedWork,reminderDue} from '../lib/work-notifications.mjs'
test('initial snapshot is silent; creation and approval notify once',()=>{
 const a={id:'1',status:'pending_approval',po_no:'PO001'}
 const first=changedWork(undefined,[a],'po')
 assert.deepEqual(first.events,[])
 const update=changedWork(first.next,[{...a,status:'approved'},{id:'2',status:'draft'}],'po')
 assert.equal(update.events.length,2)
 assert.equal(update.events[0].filter,'1')
 assert.match(update.events[0].text,/approved/)
 assert.equal(changedWork(update.next,[...update.next.values()],'po').events.length,0)
})
test('supplier revisions notify only on confirmed quotation timestamp changes',()=>{
 const a={id:'1',rfq_id:'rfq-1',status:'quoted',replied_at:'2026-10-23T00:00:00Z'}
 const first=changedWork(undefined,[a],'reply')
 assert.equal(changedWork(first.next,[a],'reply').events.length,0)
 const revised=changedWork(first.next,[{...a,replied_at:'2026-10-23T01:00:00Z'}],'reply')
 assert.equal(revised.events.length,1)
 assert.equal(revised.events[0].filter,'rfq-1')
 assert.equal(changedWork(first.next,[{...a,status:'declined'}],'reply').events.length,0)
})
test('reminders wait four hours and tolerate future timestamps',()=>{
 assert.equal(reminderDue(undefined,1000),true)
 assert.equal(reminderDue(1000,1001),false)
 assert.equal(reminderDue(1000,1000+14400000),true)
 assert.equal(reminderDue(2000,1000),false)
})
