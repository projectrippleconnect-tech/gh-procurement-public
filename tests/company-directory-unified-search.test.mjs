import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {companyDirectoryView} from '../lib/company-contact-directory-view.mjs'

test('company directory renders one search box for companies, contacts and phones',()=>{
 const source=readFileSync('components/company-contact-directory.jsx','utf8')
 assert.match(source,/id="company-directory-search"/)
 assert.match(source,/Search company, contact name or phone/)
 assert.doesNotMatch(source,/company-directory-contact-search/)
 assert.doesNotMatch(source,/contactSearch/)
 assert.match(source,/companyDirectoryView\(\{saved,assigned,companies:sorted,companyId,query:search\}\)/)
 assert.match(source,/numberPart\.length>=6/)
})
test('one search finds full company names, supplier names and 07-format numbers',()=>{
 const companies=[{id:'a',name:'ALCATHINE'},{id:'b',name:'BIXTON'}]
 const saved=[{id:'c1',company_id:'a',supplier_id:'s1',name:'Purchase Manager',phone:'+94779792078'},
  {id:'c2',company_id:'b',supplier_id:'s2',name:'Amila',phone:'+94777740922'}]
 assert.equal(companyDirectoryView({saved,companies,query:'ALCATHINE'}).savedRows.length,1)
 assert.equal(companyDirectoryView({saved,companies,query:'Purchase Manager'}).savedRows.length,1)
 assert.equal(companyDirectoryView({saved,companies,query:'0779792078'}).savedRows.length,1)
 assert.equal(companyDirectoryView({saved,companies,query:'Amila'}).savedRows[0].company_id,'b')
})
test('save and editing remain explicitly gated; search never writes suppliers',()=>{
 const source=readFileSync('components/company-contact-directory.jsx','utf8')
 assert.match(source,/if\(!selected\|\|!complete\|\|savingLock\.current\)return/)
 assert.match(source,/proc_company_directory_save_contact/)
 assert.match(source,/proc_company_directory_update_contact/)
 assert.match(source,/onReviewRouting/)
})
