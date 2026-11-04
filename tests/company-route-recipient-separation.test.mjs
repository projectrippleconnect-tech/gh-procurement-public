import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {supplierSetupPlan} from '../lib/company-supplier-setup.mjs'
import {workflowRows} from '../lib/company-workflow-directory.mjs'
import {planBranchMode} from '../lib/company-workflow-tree.mjs'

const suppliers=[{id:'s1',whatsapp:'+94771234567',active:true},{id:'s2',whatsapp:'+94771234568',active:true},{id:'s3',whatsapp:'+94771234569',active:true}]

test('one PO recipient is chosen from multiple assigned company contacts without losing others',()=>{
 const result=supplierSetupPlan({mode:'direct',assigned:['s1','s2','s3'],recipients:['s2'],suppliers})
 assert.equal(result.valid,true)
 assert.deepEqual(result.assigned,['s1','s2','s3'])
 assert.deepEqual(result.recipients,['s2'])
 assert.equal(supplierSetupPlan({mode:'direct',assigned:['s1','s2'],recipients:['s1','s2'],suppliers}).valid,false)
 assert.equal(supplierSetupPlan({mode:'direct',assigned:['s1'],recipients:['s2'],suppliers}).valid,false)
})
test('stored route shows assigned contacts and recipients as independent lists',()=>{
 const companies=[{id:'a',name:'A',default_supplier_id:'s1'}]
 const routes=[{id:'r',company_id:'a',section_id:null,auto_send:true,route_mode:'direct',assigned_supplier_ids:['s1','s2','s3']}]
 const links=[{route_id:'r',supplier_id:'s2',sort_order:1}]
 const r=workflowRows(companies,[],routes,links)[0]
 assert.deepEqual(r.assigned,['s1','s2','s3'])
 assert.deepEqual(r.recipients,['s2'])
})
test('changing a parent mode preserves a child own contact roster and selected recipient',()=>{
 const company={id:'a',name:'A'}
 const root={key:'a:company',company,section:null,section_id:null,path:'Entire company',assigned:['s1','s2'],recipients:['s2'],mode:'direct'}
 const child={key:'a:child',company,section:{id:'child',name:'Child',parent_id:null},section_id:'child',path:'Child',own:{id:'r'},assigned:['s1','s2','s3'],recipients:['s3'],mode:'rfq'}
 const result=planBranchMode([root,child],root,'direct',['s2'],[],['s1','s2'])
 assert.equal(result.conflicts.length,0)
 assert.deepEqual(result.actions[0].assigned,['s1','s2'])
 assert.deepEqual(result.actions[0].ids,['s2'])
 assert.deepEqual(result.actions[1].assigned,['s1','s2','s3'])
 assert.deepEqual(result.actions[1].ids,['s3'])
})
test('checklist persists both lists separately and never dispatches on route-only Save',()=>{
 const source=readFileSync('components/company-workflow-directory.jsx','utf8')
 assert.match(source,/p_assigned_ids:choice\.assigned/)
 assert.match(source,/p_recipient_ids:choice\.mode==='manual'\?choice\.assigned:choice\.ids/)
 assert.match(source,/Assigned contacts vs recipients/)
 assert.match(source,/Assign '\+contact\.label/)
 assert.match(source,/Send to '\+contact\.label/)
 assert.doesNotMatch(source,/fetch\([^\n]*\/api\/integrations\/whatsapp/)
})
test('server migration retains membership and one direct PO recipient checks without forcing only one assigned',()=>{
 const sql=readFileSync('supabase/migrations/20261018134500_company_po_selected_recipient.sql','utf8')
 assert.match(sql,/NOT recipients <@ ids/)
 assert.match(sql,/mode_v='direct' AND cardinality\(recipients\)<>1/)
 assert.doesNotMatch(sql,/cardinality\(ids\)<>1 OR cardinality\(recipients\)<>1/)
 assert.match(sql,/private\.proc_assert_access/)
 assert.match(sql,/p_expected_updated_at/)
})
