import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {quickAddReorderLevel} from '../lib/quick-add-reorder.mjs'

test('quick-add General reorder preview matches database trigger',()=>{
 assert.equal(quickAddReorderLevel(100,'FAST'),50)
 assert.equal(quickAddReorderLevel(100,'NORMAL'),34)
 assert.equal(quickAddReorderLevel(100,'SLOW'),25)
 assert.equal(quickAddReorderLevel(3,'NORMAL'),1)
 assert.equal(quickAddReorderLevel(0,'FAST'),0)
 assert.equal(quickAddReorderLevel('', 'FAST'),null)
 assert.equal(quickAddReorderLevel('-1','SLOW'),null)
 assert.equal(quickAddReorderLevel('Infinity','NORMAL'),null)
})
test('quick-add company reorder ignores movement and preserves fractional levels',()=>{
 assert.equal(quickAddReorderLevel(9,'FAST',true),4.5)
 assert.equal(quickAddReorderLevel(100,'SLOW',true),50)
 assert.equal(quickAddReorderLevel('', 'NORMAL',true),null)
})
test('General and Company quick create expose appropriate fields and saving',async()=>{
 const src=await readFile(new URL('../components/quick-add-item.jsx',import.meta.url),'utf8')
 const company=await readFile(new URL('../components/modules-company.jsx',import.meta.url),'utf8')
 assert.match(src,/!isCompany&&<label className="field">Movement/)
 assert.match(src,/<label className="field">Maximum stock/)
 assert.match(src,/Calculated reorder level/)
 assert.match(src,/allowCustom customOptionLabel="UOM"/)
 assert.match(src,/await supabase\.rpc\('proc_quick_add_item_v1'/)
 assert.match(src,/await onCreated\(r\.data\.item,\{companyId:/)
 assert.match(company,/mode="company"/)
 assert.match(company,/onCreateCompany=\{createCompanyForQuickAdd\}/)
 assert.match(company,/async function saveQuickCompanyItem/)
 assert.doesNotMatch(company,/Quick create company \/ item/)
})
