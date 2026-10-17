import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const jsx=readFileSync(new URL('../components/company-workflow-directory.jsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')

test('company checklist keeps main-company RFQ and PO choices visible without requiring expansion',()=>{
 assert.match(jsx,/Company Workflow Checklist/)
 assert.match(jsx,/company-workflow-list-head/)
 assert.match(jsx,/company-workflow-company-group/)
 assert.match(jsx,/renderRow\(tree\.company,0\)/)
 assert.match(jsx,/role="group" aria-label="Company and category automation checklist"/)
 assert.match(jsx,/checked=\{chosen\.mode==='rfq'\}/)
 assert.match(jsx,/checked=\{chosen\.mode==='direct'\}/)
 assert.match(jsx,/onChange=\{e=>update\(row,\{mode:e\.target\.checked\?'rfq':'manual',applyChildren:true\}\)\}/)
 assert.match(jsx,/onChange=\{e=>update\(row,\{mode:e\.target\.checked\?'direct':'manual',applyChildren:true\}\)\}/)
});
test('directory offers compact common save and separate supplier choices without a card per company',()=>{
 assert.match(jsx,/Save valid selections \(/)
 assert.match(jsx,/runSave\(pendingRows,\{batch:true\}\)/)
 assert.match(jsx,/company-workflow-contact-option/)
 assert.match(jsx,/Select supplier contacts for/)
 assert.doesNotMatch(jsx,/style=\{\{border:'1px solid var\(--line, #e2e8f0\)',borderRadius:10,marginBottom:8/)
 assert.match(css,/\.company-workflow-check-main\{min-height:43px/)
 assert.match(css,/grid-template-columns:minmax\(0,1fr\) 49px 49px/)
});
test('filter uses text value rather than storing DOM input event',()=>{
 assert.match(jsx,/value=\{query\} onChange=\{e=>setQuery\(e\.target\.value\)\}/)
});
test('saving still requires server supplier verification and never calls an outbound send endpoint',()=>{
 assert.match(jsx,/workflowValidation/)
 assert.match(jsx,/proc_company_save_supplier_setup/)
 assert.match(jsx,/done\.expected\.every/)
 assert.match(jsx,/No messages or orders were sent/)
 assert.doesNotMatch(jsx,/waha.*send|fetch\(.+\/api\/whatsapp/si)
});
