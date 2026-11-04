import test from 'node:test'
import assert from 'node:assert/strict'
import {dashboardActions,resumeTaskLabel} from '../lib/dashboard-actions.mjs'
const allow=()=>true
const ready={urgent:'ready',po:'ready',rfq:'ready',review:'ready',approval:'ready',send:'ready',prices:'ready',deliveries:'ready',stockDue:'ready'}
test('attention queues put urgent and overdue work before routine tasks',()=>{
 const tasks=dashboardActions({counts:{urgent:2,po:3,review:7,deliveries:1},states:ready,canNavigate:allow})
 assert.deepEqual(tasks.map(t=>t.key),['urgent','po','review','deliveries'])
 assert.deepEqual([tasks[2].view,tasks[2].filter,tasks[2].step],['requirements','pending_review',2])
})
test('failed and loading counts never appear as completed or empty',()=>{
 const tasks=dashboardActions({counts:{review:0},states:{...ready,review:'error',deliveries:'loading'},canNavigate:allow})
 assert.deepEqual(tasks.map(t=>[t.key,t.state]),[['review','error'],['deliveries','loading']])
})
test('attention actions respect permitted screens and exact zero queues disappear',()=>{
 assert.deepEqual(dashboardActions({counts:{review:4},states:ready,canNavigate:()=>false}),[])
 assert.deepEqual(dashboardActions({states:ready,canNavigate:allow}),[])
})
test('resume action describes the saved work rather than a generic order',()=>{
 assert.equal(resumeTaskLabel({view:'po'}),'Continue purchase order')
 assert.equal(resumeTaskLabel({view:'receiving'}),'Continue delivery entry')
})

test('read-only users see status labels rather than actions they cannot perform',()=>{
 const tasks=dashboardActions({counts:{approval:1,send:1},states:ready,canNavigate:allow,can:()=>false})
 assert.deepEqual(tasks.map(t=>t.label),['Orders awaiting approval','Approved orders'])
})
