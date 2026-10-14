import test from 'node:test'
import assert from 'node:assert/strict'
import {COMPANY_DISPLAY_KEY,normalizeCompanyDisplay,DEFAULT_SECTION_COLORS} from '../lib/company-display.mjs'
test('one global display profile defaults to matched name and size with thresholds under',()=>{
 const p=normalizeCompanyDisplay()
 assert.equal(COMPANY_DISPLAY_KEY,'company_lists_display')
 assert.equal(p.fields.max,true)
 assert.equal(p.row_layout.size,'first')
 assert.equal(p.row_layout.max,'second')
 assert.equal(p.sectionColors.length,DEFAULT_SECTION_COLORS.length)
})
test('hidden stock limits remain a display setting, not a stock value change',()=>{
 const p=normalizeCompanyDisplay({fields:{max:false,reorder:false,colour:true},row_layout:{size:'second',nameFont:19},sectionColors:['#123456','bad']})
 assert.equal(p.fields.max,false)
 assert.equal(p.fields.reorder,false)
 assert.equal(p.fields.colour,true)
 assert.equal(p.row_layout.size,'second')
 assert.equal(p.row_layout.nameFont,19)
 assert.equal(p.sectionColors[0],'#123456')
 assert.equal(p.sectionColors[1],DEFAULT_SECTION_COLORS[1])
})
test('malformed settings recover safely',()=>{
 assert.deepEqual(normalizeCompanyDisplay(null),normalizeCompanyDisplay({}))
 assert.deepEqual(normalizeCompanyDisplay({fields:[],sectionColors:'wrong'}),normalizeCompanyDisplay({}))
})
