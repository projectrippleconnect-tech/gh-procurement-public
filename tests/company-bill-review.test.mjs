import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCompanyBillPages,parseCompanySpreadsheet,companyReviewRow,companyReviewPayload} from '../lib/company-bill-review.mjs'

test('bill extraction separates item identity from monetary columns and retains OCR evidence',()=>{
 const rows=parseCompanyBillPages([{page:2,ocrLines:[{text:'Invoice No 123',confidence:95},{text:'1   SL-01   PVC Elbw 20 mm PCS   5   100.00   500.00',confidence:63},{text:'Water pump 101',confidence:90},{text:'Total   500.00',confidence:80}]}],{category:'GENERAL',subgroup:'PVC fittings'})
 assert.equal(rows.length,2);assert.equal(rows[0].description,'PVC Elbw');assert.equal(rows[0].size,'20 mm');assert.equal(rows[0].external_code,'SL-01');assert.equal(rows[0].max_stock,'0');assert.equal(rows[0].selected,false);assert.equal(rows[0].source_page,2);assert.equal(rows[0].extraction_confidence,63);assert.ok(rows[0].raw_line.includes('500.00'));assert.equal(rows[1].description,'Water pump 101')
})
test('spreadsheet headings allow reordered fields and defaults for omitted columns',()=>{
 const rows=parseCompanySpreadsheet('Item name\tSubcategory\tSize\tTarget stock\nCorrected elbow\tPVC fittings\t20 mm\t0012\nWater pump\tPumps\t1 HP\t5',{category:'GENERAL'})
 assert.equal(rows[0].description,'Corrected elbow');assert.equal(rows[0].size,'20 mm');assert.equal(rows[0].uom,'PCS');assert.equal(rows[1].subgroup,'Pumps');assert.equal(rows[1].selected,true)
 const payload=companyReviewPayload(rows);assert.equal(payload[0].max_stock,12);assert.equal(payload[1].category,'GENERAL')
})
test('review only imports corrected selected pending rows and does not mutate source',()=>{
 const rows=[companyReviewRow({description:'Corrected item',max_stock:'0.5'}),companyReviewRow({description:'Unreviewed OCR',selected:false}),companyReviewRow({description:'Already added',status:'Imported / matched'})]
 const payload=companyReviewPayload(rows);assert.equal(payload.length,1);assert.equal(payload[0].max_stock,.5);assert.equal(rows[0].max_stock,'0.5');assert.ok(!('selected' in payload[0]));assert.ok(!('status' in payload[0]))
 for(const max_stock of ['-1','1e3','NaN','0 01',''])assert.throws(()=>companyReviewPayload([companyReviewRow({description:'Item',max_stock})]))
 assert.throws(()=>companyReviewPayload([companyReviewRow({description:'Item',movement:'INVALID'})]))
 assert.throws(()=>companyReviewPayload([companyReviewRow({description:''})]))
})
test('spreadsheet paste keeps manual spelling and bounds malformed column counts',()=>{
 const rows=parseCompanySpreadsheet('Manual spelling\t2 ft\tpcs\tELECTRICAL\tLocks\t10')
 assert.equal(rows[0].description,'Manual spelling');assert.equal(companyReviewPayload(rows)[0].uom,'PCS')
 assert.throws(()=>parseCompanySpreadsheet(Array(1001).fill('Item').join('\n')))
 assert.throws(()=>parseCompanySpreadsheet('Item\t'+Array(11).fill('x').join('\t')))
})
