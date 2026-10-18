import test from 'node:test'
import assert from 'node:assert/strict'
import {stockPrintRows,resolveStockPrint,stockPrintDescription,resolveStockColumnStyles,groupStockPrintRows} from '../lib/stock-print.mjs'
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
test('stock PDF cleans only repeated printed brand metadata and retains catalog source',()=>{
 const item={description:'1 GANG 1-WAY SWITCH WHITE KEVILTON - KEVILTON - WHITE',brand:'KEVILTON',colour:'WHITE'}
 const snapshot=JSON.stringify(item)
 assert.equal(stockPrintDescription(item),'1 GANG 1-WAY SWITCH WHITE KEVILTON')
 assert.equal(stockPrintDescription(item,{removeRepeatedSuffix:false}),item.description)
 assert.equal(stockPrintDescription({description:'STEEL BAR 6mm - 8mm'}),'STEEL BAR 6mm - 8mm')
 assert.equal(stockPrintDescription({description:'KEVILTON 1-WAY SWITCH - BLACK'}),'KEVILTON 1-WAY SWITCH - BLACK')
 assert.equal(JSON.stringify(item),snapshot,'Source catalog row must remain unchanged')
 const clean=buildCustomStockPdf({items:[item],options:{tablesPerPage:1}})
 const raw=buildCustomStockPdf({items:[item],options:{tablesPerPage:1,removeRepeatedSuffix:false}})
 assert.equal((clean.output().match(/KEVILTON/g)||[]).length,1)
 assert.equal((raw.output().match(/KEVILTON/g)||[]).length,2)
})

test('all printable stock columns support bold and left-centre-right alignment with safe defaults',()=>{
 const defaults=resolveStockPrint({})
 assert.deepEqual(defaults.columnStyles.description,{align:'left',bold:true})
 assert.deepEqual(defaults.columnStyles.reorder_level,{align:'center',bold:true})
 for(const key of ['no','size','uom','current_stock'])assert.equal(defaults.columnStyles[key].align,'center',key)
 const customised=resolveStockPrint({columnStyles:{description:{align:'right',bold:false},no:{align:'left',bold:true},reorder_level:{align:'right',bold:false},uom:{align:'invalid',bold:'invalid'}}})
 assert.deepEqual(customised.columnStyles.description,{align:'right',bold:false})
 assert.deepEqual(customised.columnStyles.no,{align:'left',bold:true})
 assert.deepEqual(customised.columnStyles.reorder_level,{align:'right',bold:false})
 assert.deepEqual(customised.columnStyles.uom,{align:'center',bold:false})
 assert.equal(resolveStockColumnStyles().description.bold,true)
 const item={description:'Steel Nail 4 inch',uom:'PCS',reorder_level:12}
 const pdf=buildCustomStockPdf({items:[item],options:{...customised,tablesPerPage:1}})
 const plain=pdf.output()
 assert.ok(plain.includes('Steel Nail 4 inch'))
 assert.ok(plain.includes('(12)'),'Reorder level remains printable after styling')
 assert.ok(plain.includes('(PCS)'),'UOM remains printable after styling')
})

test('custom stock PDF includes all 150 rows without modifying source data',()=>{
 const rows=Array.from({length:150},(_,n)=>({id:String(n),description:'PVC Elbow '+String(n+1).padStart(3,'0'),size:'20 mm',uom:'PCS',reorder_level:10}))
 const snapshot=JSON.stringify(rows)
 for(const layout of ['columns','stacked'])for(const orientation of ['portrait','landscape']){
  const pdf=buildCustomStockPdf({items:rows,company:{name:'General Hardware'},options:{layout,orientation,tablesPerPage:3,fontSize:7,rowHeight:5}})
  const text=pdf.output();const renderedText=[...text.matchAll(/\(([^()]*)\)\s*Tj/g)].map(m=>m[1]).join(' ')
  for(let n=1;n<=150;n++)assert.ok(renderedText.includes('PVC Elbow '+String(n).padStart(3,'0')),String(n))
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
 assert.equal((text.match(/\(Long stock/g)||[]).length,90)
})


test('company stock print groups the saved section hierarchy and isolates uncategorized rows',()=>{
 const sections=[
  {id:'switches',name:'Switches',sort_order:10},
  {id:'black',parent_id:'switches',name:'Black',sort_order:20},
  {id:'white',parent_id:'switches',name:'White',sort_order:10},
  {id:'lights',name:'Lights',sort_order:20}
 ]
 const rows=[
  {id:'1',section_id:'black',description:'Black switch'},
  {id:'2',section_id:'white',description:'White switch'},
  {id:'3',section_id:'lights',description:'Bulb'},
  {id:'4',section_id:null,description:'Loose item',category:'Unrelated catalogue field'},
  {id:'5',section_id:'white',description:'White switch'}
 ]
 const original=JSON.stringify({rows,sections})
 const groups=groupStockPrintRows(rows,sections)
 assert.deepEqual(groups.map(g=>g.title),[
  'Switches / White','Switches / Black','Lights / General items','Other / Uncategorized'
 ])
 assert.deepEqual(groups.map(g=>g.items.map(i=>i.id)),[['2','5'],['1'],['3'],['4']])
 assert.equal(groups.reduce((sum,g)=>sum+g.items.length,0),rows.length)
 assert.equal(JSON.stringify({rows,sections}),original,'No catalogue or section mutation')
})

test('legacy company stock still uses category and subgroup before assigning Others',()=>{
 const rows=[
  {id:'1',description:'1 way switch',category:'KEVILTON',subgroup:'WHITE SWITCHES'},
  {id:'2',description:'2 way switch',category:'KEVILTON',subgroup:'BLACK SWITCHES'},
  {id:'3',description:'Other',category:'KEVILTON'},
 ]
 const groups=groupStockPrintRows(rows)
 assert.deepEqual(groups.map(x=>x.title),[
  'KEVILTON / BLACK SWITCHES','KEVILTON / WHITE SWITCHES','Other / Uncategorized'
 ])
})

test('grouped company PDF has category headers, separate tables, reset numbering and no missing items',()=>{
 const sections=[
  {id:'switches',name:'Switches',sort_order:1},
  {id:'white',parent_id:'switches',name:'White',sort_order:1},
  {id:'black',parent_id:'switches',name:'Black',sort_order:2}
 ]
 const rows=[
  ...Array.from({length:62},(_,n)=>({id:'w'+n,section_id:'white',description:'WHITE-ITEM-'+String(n+1).padStart(3,'0'),uom:'PCS',reorder_level:20})),
  ...Array.from({length:38},(_,n)=>({id:'b'+n,section_id:'black',description:'BLACK-ITEM-'+String(n+1).padStart(3,'0'),uom:'PCS',reorder_level:10})),
  {id:'misc',description:'UNCATEGORIZED-ITEM',uom:'PCS',reorder_level:5}
 ]
 const snapshot=JSON.stringify(rows)
 const pdf=buildCustomStockPdf({items:rows,sections,company:{name:'General Hardware'},subtitle:'KEVILTON',options:{
  groupBySubcategory:true,includeUncategorized:true,orientation:'portrait',
  layout:'columns',tablesPerPage:3,rowsPerTable:0
 }})
 const output=pdf.output()
 assert.ok(output.includes('Switches / White'),'White subcategory has its own heading')
 assert.ok(output.includes('Switches / Black'),'Black subcategory has its own heading')
 assert.ok(output.includes('Other / Uncategorized'),'Unassigned items have a separate heading')
 for(const item of rows)assert.ok(output.includes(item.description),'Missing item: '+item.description)
 const allText=pdf.internal.pages.map(page=>(page||[]).join(' ')).join(' ')
 assert.ok((allText.match(/\(No\.\)\s*Tj/g)||[]).length>=3,'Subcategories print as separate titled tables')
 assert.ok(pdf.getNumberOfPages()>=2,'Long categories paginate')
 assert.ok(output.includes('Stocks Checked By'))
 assert.ok(output.includes('Stocks Verified By'))
 assert.ok(output.includes('Order Approved By'))
 assert.equal(JSON.stringify(rows),snapshot,'Grouped printing must not change stock records')
})

test('two short company subcategories fit on one compact A4 page',()=>{
 const sections=[{id:'a',name:'Switches'},{id:'a1',name:'White',parent_id:'a'},{id:'a2',name:'Black',parent_id:'a'}]
 const items=[{id:'1',section_id:'a1',description:'ONE GANG WHITE',uom:'PCS',reorder_level:10},
  {id:'2',section_id:'a2',description:'ONE GANG BLACK',uom:'PCS',reorder_level:10}]
 const pdf=buildCustomStockPdf({items,sections,options:{groupBySubcategory:true,tablesPerPage:3}})
 assert.equal(pdf.getNumberOfPages(),1)
 assert.ok(pdf.output().includes('Switches / White'))
 assert.ok(pdf.output().includes('Switches / Black'))
})


test('root-assigned company stock uses existing finish/type leaves, without editing any records',()=>{
 const sections=[
  {id:'root',name:'KEVILTON',parent_id:null,sort_order:0},
  {id:'white',name:'KEVILTON WHITE',parent_id:'root',sort_order:0},
  {id:'black',name:'KEVILTON BLACK',parent_id:'root',sort_order:10},
  {id:'mahogany',name:'KEVILTON MAHOGANI',parent_id:'root',sort_order:20},
  {id:'ws',name:'SWITCHES',parent_id:'white',sort_order:0},
  {id:'bs',name:'SWITCHES',parent_id:'black',sort_order:0},
  {id:'ms',name:'SWITCHES',parent_id:'mahogany',sort_order:0},
  {id:'wc',name:'SOCKETS & PLUG ACCESSORIES',parent_id:'white',sort_order:10}
 ]
 const rows=[
  {id:'w',section_id:'root',category:'KEVILTON',main_group:'SWITCHES',subgroup:'WHITE',colour:'WHITE',description:'White 1-way'},
  {id:'b',section_id:'root',category:'KEVILTON',main_group:'SWITCHES',subgroup:'BLACK',colour:'BLACK',description:'Black 1-way'},
  {id:'m',section_id:'root',category:'KEVILTON',main_group:'SWITCHES',subgroup:'MAHOGANY',colour:'MAHOGANI',description:'Mahogany 1-way'},
  {id:'socket',section_id:'wc',main_group:'SWITCHES',subgroup:'BLACK',description:'Explicit placement wins'},
  {id:'u',section_id:'root',main_group:'KEVILTON',subgroup:'WHITE',description:'Unknown type'}
 ]
 const before=JSON.stringify({sections,rows})
 const groups=groupStockPrintRows(rows,sections)
 assert.deepEqual(groups.map(g=>[g.title,g.items.map(i=>i.id)]),[
  ['KEVILTON / KEVILTON WHITE / SWITCHES',['w']],
  ['KEVILTON / KEVILTON WHITE / SOCKETS & PLUG ACCESSORIES',['socket']],
  ['KEVILTON / KEVILTON BLACK / SWITCHES',['b']],
  ['KEVILTON / KEVILTON MAHOGANI / SWITCHES',['m']],
  ['Other / Uncategorized',['u']]
 ])
 assert.equal(groups.reduce((n,g)=>n+g.items.length,0),rows.length)
 assert.equal(JSON.stringify({sections,rows}),before,'The catalogue and saved section assignments must remain untouched')
})

test('ambiguous root matches are left uncategorized, without guessing an item type',()=>{
 const sections=[
  {id:'r',name:'EXAMPLE'}, {id:'white',parent_id:'r',name:'EXAMPLE WHITE'},
  {id:'g1',parent_id:'white',name:'SWITCHES'},
  {id:'g2',parent_id:'white',name:'SWITCHES'}
 ]
 const rows=[{section_id:'r',description:'Ambiguous',main_group:'SWITCHES',subgroup:'WHITE'}]
 const groups=groupStockPrintRows(rows,sections)
 assert.equal(groups.length,1)
 assert.equal(groups[0].title,'Other / Uncategorized')
})

test('standalone company root without subgroups retains direct items under General items',()=>{
 const sections=[{id:'r',name:'ALKATHINE'}]
 const groups=groupStockPrintRows([{section_id:'r',description:'Alkathine pipe',main_group:'ALKATHINE'}],sections)
 assert.deepEqual(groups.map(g=>g.title),['ALKATHINE / General items'])
})
