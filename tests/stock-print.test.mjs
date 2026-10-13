import test from 'node:test'
import assert from 'node:assert/strict'
import {stockPrintRows,resolveStockPrint} from '../lib/stock-print.mjs'
import {documentLines,documentCompany,documentCaption,defaultSupplierTemplate} from '../lib/supplier-template.mjs'
import {buildCustomStockPdf} from '../lib/pdf.js'
test('stock printing filters selected categories and movement; company default includes every movement',()=>{
 const rows=[{id:'a',category:'GENERAL',subgroup:'PVC',movement:'FAST'},{id:'b',category:'GENERAL',subgroup:'Pumps',movement:'SLOW'},{id:'c',category:'BATHROOM',movement:'NORMAL'}]
 assert.equal(stockPrintRows(rows,{}).length,3)
 assert.deepEqual(stockPrintRows(rows,{category:'GENERAL',subgroup:'Pumps'}).map(x=>x.id),['b'])
 assert.deepEqual(stockPrintRows(rows,{movement:'FAST',selectedIds:['b']}).map(x=>x.id),[])
 assert.equal(resolveStockPrint({tablesPerPage:9}).tablesPerPage,3)
 assert.throws(()=>resolveStockPrint({columns:['no']}),/Description/)
})
test('custom stock PDF includes all 150 rows without modifying source data',()=>{
 const rows=Array.from({length:150},(_,n)=>({id:String(n),description:'PVC Elbow '+String(n+1).padStart(3,'0'),size:'20 mm',uom:'PCS',reorder_level:10}))
 const snapshot=JSON.stringify(rows)
 for(const layout of ['columns','stacked'])for(const orientation of ['portrait','landscape']){
  const pdf=buildCustomStockPdf({items:rows,company:{name:'General Hardware'},options:{layout,orientation,tablesPerPage:3,fontSize:7,rowHeight:5}})
  const text=pdf.output()
  for(let n=1;n<=150;n++)assert.ok(text.includes('PVC Elbow '+String(n).padStart(3,'0')),String(n))
  assert.ok(text.includes('Stocks Checked By'));assert.ok(text.includes('Stocks Verified By'));assert.ok(text.includes('Order Approved By'))
  assert.ok(pdf.getNumberOfPages()>=1)
 }
 assert.equal(JSON.stringify(rows),snapshot)
})
test('supplier wording and template edits preserve authoritative order quantities and values',()=>{
 const original=[{id:'line',qty:6,unit_price:40,item:{description:'Cycle lock',size:'2 ft',uom:'PCS'}}]
 const template=defaultSupplierTemplate('po');template.name='General Ceramics';template.overrides.line={description:'Supplier cycle lock',qty:999,unit_price:1};template.caption='{company_name} {po_number} {supplier_name}'
 const rows=documentLines(original,template)
 assert.equal(rows[0].item.description,'Supplier cycle lock');assert.equal(rows[0].qty,6);assert.equal(rows[0].unit_price,40);assert.equal(original[0].item.description,'Cycle lock')
 assert.equal(documentCaption(template.caption,{company:documentCompany({},template),po:{po_no:'PO-1',supplier:{name:'Slon'}}}),'General Ceramics PO-1 Slon')
})
