import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {ALL_DIRECTORY_COMPANIES,companyDirectoryView} from '../lib/company-contact-directory-view.mjs'

const companies=[{id:'b',name:'Bixton'},{id:'a',name:'Alcatine'}]
const saved=[
 {id:'s1',company_id:'b',supplier_id:'1',name:'Shivantha Long Sales Representative Name',phone:'+94760000001'},
 {id:'s2',company_id:'a',supplier_id:'2',name:'Amila Alcathine Purchase',phone:'+94770000002'},
 {id:'s3',company_id:'a',supplier_id:'3',name:'A Contact',phone:'+94770000003'}
]
const assigned=[
 {company_id:'a',supplier_id:'2',name:'Amila duplicate route',phone:'+94770000002'},
 {company_id:'a',supplier_id:'4',name:'Main',phone:'+94770000004'},
 {company_id:'b',supplier_id:'1',name:'Duplicate on another company',phone:'+94760000001'},
 {company_id:'b',supplier_id:'4',name:'Main',phone:'+94770000004'}
]

test('All Companies shows every saved contact sorted by company then contact name',()=>{
 const r=companyDirectoryView({saved,assigned,companies})
 assert.equal(ALL_DIRECTORY_COMPANIES,'all')
 assert.deepEqual(r.savedRows.map(c=>c.id),['s3','s2','s1'])
 assert.deepEqual(r.assignedRows.map(c=>c.company_id+':'+c.supplier_id),['a:4','b:4'])
})
test('Single company continues to scope both saved and routing-only contacts',()=>{
 const r=companyDirectoryView({saved,assigned,companies,companyId:'b'})
 assert.deepEqual(r.savedRows.map(c=>c.id),['s1'])
 assert.deepEqual(r.assignedRows.map(c=>c.supplier_id),['4'])
})
test('Search matches company name, full supplier name or phone across all companies',()=>{
 assert.deepEqual(companyDirectoryView({saved,assigned,companies,query:'bixton'}).savedRows.map(c=>c.id),['s1'])
 assert.deepEqual(companyDirectoryView({saved,assigned,companies,query:'long sales'}).savedRows.map(c=>c.id),['s1'])
 assert.deepEqual(companyDirectoryView({saved,assigned,companies,query:'00000003'}).savedRows.map(c=>c.id),['s3'])
 assert.equal(companyDirectoryView({saved,assigned,companies,query:'not real'}).savedRows.length,0)
})
test('Company directory maintains real-company save guard and name wrapping',()=>{
 const jsx=readFileSync(new URL('../components/company-contact-directory.jsx',import.meta.url),'utf8')
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
 assert.match(jsx,/if\(!selected\|\|!complete\|\|savingLock\.current\)return/)
 assert.match(jsx,/companyId===ALL_DIRECTORY_COMPANIES/)
 assert.match(jsx,/c\.company_id===companyId\|\|companyId===ALL_DIRECTORY_COMPANIES/)
 assert.match(css,/\.company-directory-compact-row \.company-directory-contact-name\s*\{[^}]*white-space:normal/s)
 assert.match(css,/\.company-directory-compact-row \.company-directory-contact-name\s*\{[^}]*overflow-wrap:anywhere/s)
})
