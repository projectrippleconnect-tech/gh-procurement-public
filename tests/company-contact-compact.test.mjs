import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const directory=readFileSync(new URL('../components/company-contact-directory.jsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')

test('saved and routed company contacts render compact single-line rows',()=>{
 assert.match(directory,/company-directory-record company-directory-compact-row"/)
 assert.match(directory,/company-directory-record company-directory-compact-row company-directory-compact-route"/)
 assert.match(css,/\.company-directory-record\.company-directory-compact-row\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) max-content auto/s)
 assert.match(css,/company-directory-compact-row[\s\S]*?border:0;border-bottom:1px solid var\(--line\)/)
})
test('the dense row preserves full contact number and accessible edit/delete controls',()=>{
 assert.match(directory,/className="company-directory-contact-phone" title=\{c\.phone\}>\{c\.phone\}/)
 assert.match(directory,/aria-label=\{'Edit '\+c\.name\}/)
 assert.match(directory,/aria-label=\{'Delete '\+c\.name\}/)
 assert.match(directory,/onClick=\{\(\)=>beginEdit\(c\)\}/)
 assert.match(directory,/onClick=\{\(\)=>removeContact\(c\)\}/)
 assert.match(directory,/Edits change this company’s directory entry only/)
 assert.match(directory,/The supplier record, existing RFQ\/PO routes and order history stay intact/)
})
