import test from 'node:test'
import assert from 'node:assert/strict'
import {COMPANY_ROW_LAYOUT_DEFAULTS,normalizeCompanyRowLayout,companyRowPosition,companyRowStyle} from '../lib/company-row-layout.mjs'

test('default display places the size with item name and stock levels underneath',()=>{
 const p=normalizeCompanyRowLayout()
 assert.deepEqual(p,COMPANY_ROW_LAYOUT_DEFAULTS)
 assert.equal(companyRowPosition(p,'size'),'first')
 assert.equal(companyRowPosition(p,'max'),'second')
 assert.equal(companyRowPosition(p,'reorder'),'second')
 assert.equal(companyRowPosition(p,'details'),'second')
})
test('per-company layout permits moving size, thresholds and unit independently',()=>{
 const p=normalizeCompanyRowLayout({size:'second',max:'first',reorder:'first',details:'first',nameFont:18,metaFont:14,rowPadding:8,fieldGap:11,lineGap:5})
 assert.equal(companyRowPosition(p,'size'),'second')
 assert.equal(companyRowPosition(p,'max'),'first')
 assert.equal(companyRowPosition(p,'reorder'),'first')
 assert.equal(companyRowPosition(p,'details'),'first')
 assert.equal(companyRowStyle(p)['--company-name-font'],'18px')
 assert.equal(companyRowStyle(p)['--company-line-gap'],'5px')
})
test('invalid and out-of-range settings are normalized safely without mutating defaults',()=>{
 const p=normalizeCompanyRowLayout({size:'third',max:'first',nameFont:500,metaFont:-1,rowPadding:0,fieldGap:'not a number',lineGap:999})
 assert.equal(p.size,'first')
 assert.equal(p.max,'first')
 assert.equal(p.nameFont,22)
 assert.equal(p.metaFont,9)
 assert.equal(p.rowPadding,2)
 assert.equal(p.fieldGap,8)
 assert.equal(p.lineGap,12)
 assert.equal(COMPANY_ROW_LAYOUT_DEFAULTS.max,'second')
})
test('empty stored layout preserves compact default and ignores inherited fields',()=>{
 assert.deepEqual(normalizeCompanyRowLayout(null),COMPANY_ROW_LAYOUT_DEFAULTS)
 assert.deepEqual(normalizeCompanyRowLayout([]),COMPANY_ROW_LAYOUT_DEFAULTS)
 assert.deepEqual(normalizeCompanyRowLayout({}),COMPANY_ROW_LAYOUT_DEFAULTS)
})
