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
 assert.equal(resolveStockPrint({}).splitLongTables,true)
 assert.equal(resolveStockPrint({splitLongTables:false}).splitLongTables,false)
 assert.throws(()=>resolveStockPrint({columns:['no']}),/Description/)
})
test('custom stock PDF includes all 150 rows without modifying source data',()=>{
 const rows=Array.from({length:150},(_,n)=>({id:String(n),description:'PVC Elbow '+String(n+1).padStart(3,'0'),size:'20 mm',uom:'PCS',reorder_level:10}))
 const snapshot=JSON.stringify(rows)
 for(const layout of ['columns','stacked'])for(const orientation of ['portrait','landscape']){
  const pdf=buildCustomStockPdf({items:rows,company:{name:'General Hardware'},options:{layout,orientation,tablesPerPage:3,fontSize:7,rowHeight:5}})
  const text=pdf.output();const renderedText=[...text.matchAll(/\(([^()]*)\)\s*Tj/g)].map(m=>m[1]).join(' ')
  for(let n=1;n<=150;n++)assert.ok(renderedText.includes('PVC ELBOW '+String(n).padStart(3,'0')),String(n))
  assert.ok(text.includes('Stocks Checked By'));assert.ok(text.includes('Stocks Verified By'));assert.ok(text.includes('Order Approved By'))
  assert.ok(pdf.getNumberOfPages()>=1)
 }
 assert.equal(JSON.stringify(rows),snapshot)
})

test('A4 portrait 2-table stock setup renders side-by-side columns without losing rows',()=>{
 const rows=Array.from({length:54},(_,n)=>({id:String(n),description:'ITEM-'+String(n+1).padStart(3,'0')+' 1 GANG 1-WAY SWITCH WHITE KEVILTON - KEVILTON - WHITE',size:'',uom:'PCS',reorder_level:10}))
 const original=JSON.stringify(rows)
 const settings={orientation:'portrait',layout:'columns',tablesPerPage:2,splitLongTables:true,fontSize:6.5,rowHeight:5,rowsPerTable:0}
 const pdf=buildCustomStockPdf({items:rows,company:{name:'General Hardware'},options:settings,subtitle:'KEVILTON'})
 const firstPage=pdf.internal.pages[1].join(' ')
 assert.equal((firstPage.match(/\(Description\)\s*Tj/g)||[]).length,2,'Long rows must be split into two visible tables on the first page')
 const output=pdf.output()
 for(let n=1;n<=54;n++)assert.ok(output.includes('ITEM-'+String(n).padStart(3,'0')),'All stock items must remain printable: '+n)
 assert.equal(JSON.stringify(rows),original,'Printing must not alter catalog data')
 const single=buildCustomStockPdf({items:rows,options:{...settings,splitLongTables:false}})
 assert.equal((single.internal.pages[1].join(' ').match(/\(Description\)\s*Tj/g)||[]).length,1,'Disabling the split should use one full-width table')
})

test('supplier wording and template edits preserve authoritative order quantities and values',()=>{
 const original=[{id:'line',qty:6,unit_price:40,item:{description:'Cycle lock',size:'2 ft',uom:'PCS'}}]
 const template=defaultSupplierTemplate('po');template.name='General Ceramics';template.overrides.line={description:'Supplier cycle lock',qty:999,unit_price:1};template.caption='{company_name} {po_number} {supplier_name}'
 const rows=documentLines(original,template)
 assert.equal(rows[0].item.description,'Supplier cycle lock');assert.equal(rows[0].qty,6);assert.equal(rows[0].unit_price,40);assert.equal(original[0].item.description,'Cycle lock')
 assert.equal(documentCaption(template.caption,{company:documentCompany({},template),po:{po_no:'PO-1',supplier:{name:'Slon'}}}),'General Ceramics PO-1 Slon')
})

test('adaptive stock headings remain whole and short lists fill the page',()=>{
 const rows=Array.from({length:10},(_,n)=>({description:'ALCATHINE HOSE 1/2" · 1/2"',size:n%2?'200 FT':'100 FT',uom:'PCS',reorder_level:10}))
 const pdf=buildCustomStockPdf({items:rows,options:{tablesPerPage:3,fontSize:9}})
 const text=pdf.output()
 assert.ok(text.includes('(Reorder level)'))
 assert.ok(text.includes('(Current stock)'))
 assert.ok(text.includes('(ALCATHINE HOSE 1/2"'))
 assert.equal(pdf.getNumberOfPages(),1)
 const rects=[...text.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) (-?[\d.]+) re/g)]
 const firstWidths=rects.slice(0,6).reduce((sum,m)=>sum+Number(m[3]),0)
 assert.ok(Math.abs(firstWidths-190*72/25.4)<1,'One short table uses the complete printable width')
})

test('adaptive tables preserve every row with many columns and long descriptions',()=>{
 const rows=Array.from({length:90},(_,n)=>({description:'Long stock description '+n+' with several different product specifications and finishes',size:'100 FT',uom:'PCS',category:'GENERAL',movement:'FAST',max_stock:20,reorder_level:10,brand:'Example'}))
 const pdf=buildCustomStockPdf({items:rows,options:{tablesPerPage:3,fontSize:11,columns:['no','description','size','uom','category','movement','max_stock','reorder_level','current_stock','brand']}})
 const text=pdf.output()
 for(const header of ['Reorder level','Current stock','Movement','Max stock'])assert.ok(text.includes('('+header+')'),header)
 assert.equal((text.match(/\(LONG STOCK/g)||[]).length,90)
})
