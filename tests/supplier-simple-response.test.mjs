import test from 'node:test'
import assert from 'node:assert/strict'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {bootstrapProcurementSchema} from '../scripts/qa/schema-bootstrap.mjs'
import {supplierPriceResponse,missingSupplierPrice,PRICE_REVIEW_NOTE} from '../lib/supplier-price-response.mjs'
import {documentBrand} from '../lib/document-brand.mjs'
import {routeTemplate} from '../lib/company-route-template.mjs'
import {interfaceTranslator} from '../lib/interface-copy.mjs'

test('simple price responses preserve history values without falsely confirming hidden terms',()=>{
 const rows=[{id:'a',status:'in_stock',price:'12',quantity:'4',discount:'8',lead_days:'3',terms_confirmed:true,notes:'Blue'}]
 const p=supplierPriceResponse(rows)[0]
 assert.equal(p.terms_confirmed,false);assert.equal(p.discount,'8');assert.equal(p.lead_days,'3')
 assert.equal(p.confirmation_scope,'price_availability');assert.match(p.notes,/Commercial terms require staff review/)
 assert.equal(rows[0].notes,'Blue');assert.equal(rows[0].terms_confirmed,true)
 const fresh=supplierPriceResponse([{id:'b',status:'in_stock',price:12,quantity:4}])[0]
 assert.equal(fresh.lead_days,undefined);assert.equal(fresh.discount,undefined)
 assert.equal(supplierPriceResponse([p])[0].notes,p.notes,'Repeated draft saves do not duplicate the review note')
})
test('simple confirmation needs price and availability, with no delivery fields',()=>{
 const items=[{id:'a'},{id:'b'}],rows=[{id:'a',status:'in_stock',price:'12',quantity:'2'},{id:'b',status:'no_stock'}]
 assert.equal(missingSupplierPrice(items,rows),undefined)
 for(const price of ['',0,'NaN',-1])assert.equal(missingSupplierPrice(items,[{...rows[0],price},rows[1]]).id,'a')
 assert.equal(missingSupplierPrice(items,[rows[0],{id:'b',status:'skip'}]).id,'b')
})
test('document branding uses GEN while preserving business identity and custom document headers',()=>{
 const company={name:'General Hardware'}
 assert.equal(documentBrand(company),'GEN');assert.equal(company.name,'General Hardware')
 assert.equal(documentBrand({...company,document_name:'GEN Wholesale'}),'GEN Wholesale')
 assert.equal(routeTemplate({name:'General Hardware'}).name,'GEN')
 assert.equal(routeTemplate({name:'Custom Header'}).name,'Custom Header')
})
test('essential Tamil labels translate without changing stored task names',()=>{
 const tr=interfaceTranslator('ta')
 for(const label of ['Needs me','Final confirm','Review quantity','Stock count & requirement','I confirm the displayed items, units, rates and available quantities.'])assert.notEqual(tr(label),label)
 assert.equal(interfaceTranslator('en')('Final confirm'),'Final confirm')
 assert.equal(tr('REQ-021'),'REQ-021')
})
test('real anonymous supplier confirmation imports prices but leaves commercial eligibility unconfirmed',async()=>{
 const db=new PGlite({extensions:{pgcrypto}})
 try{
  await bootstrapProcurementSchema(db)
  const one=async(sql,params=[])=> (await db.query(sql,params)).rows[0]
  const item=await one("insert into public.proc_items(item_code,category,description,uom) values('SIMPLE-QA','QA','Simple price QA','PCS') returning id")
  const supplier=await one("insert into public.proc_suppliers(supplier_code,name) values('SIMPLE-QA','Simple supplier QA') returning id")
  const req=await one("insert into public.proc_requirements(requirement_no,item_id,location_id,required_qty,adjusted_qty,approval_status,selected_for_order) values('SIMPLE-QA',$1,'00000000-0000-4000-8000-000000000099',20,20,'approved',true) returning id",[item.id])
  const rfq=await one("insert into public.proc_rfqs(rfq_no,status) values('SIMPLE-QA','sent') returning id")
  const line=await one('insert into public.proc_rfq_items(rfq_id,requirement_id,requested_qty) values($1,$2,20) returning id',[rfq.id,req.id])
  const invitation=await one("insert into public.proc_rfq_suppliers(rfq_id,supplier_id,status) values($1,$2,'sent') returning id",[rfq.id,supplier.id])
  const token='b'.repeat(64)
  await db.query("select public.proc_portal_issue_link_v1($1,encode(extensions.digest($2,'sha256'),'hex'),6)",[invitation.id,token])
  const response=supplierPriceResponse([{id:line.id,status:'in_stock',price:'12.50',quantity:'8',uom:'PCS'}])
  await db.exec('set role anon')
  await db.query('select public.proc_portal_submit_v1($1,$2::jsonb,0,true)',[token,JSON.stringify(response)])
  await db.exec('reset role')
  const result=await one('select unit_price,lead_days,portal_freight_unit,portal_valid_until,notes from public.proc_quote_lines where rfq_item_id=$1',[line.id])
  assert.equal(Number(result.unit_price),12.5);assert.equal(result.lead_days,null)
  assert.equal(result.portal_freight_unit,null);assert.equal(result.portal_valid_until,null)
  assert.equal(result.notes,PRICE_REVIEW_NOTE)
  const saved=await one("select response->0 as line from public.proc_supplier_portal_links where rfq_supplier_id=$1",[invitation.id])
  assert.equal(saved.line.terms_confirmed,false)
  const terms=await one('select private.proc_portal_terms($1::jsonb) as terms',[JSON.stringify(saved.line)])
  assert.equal(terms.terms,null,'Supplier price confirmation cannot create confirmed commercial terms')
 }finally{await db.close()}
})

test('a long existing supplier remark remains available beyond the imported review-note preview',()=>{
 const remark='x'.repeat(500)
 const response=supplierPriceResponse([{id:'long',status:'in_stock',price:12,quantity:2,notes:remark}])[0]
 assert.equal(response.supplier_notes,remark)
 assert.equal(response.notes.length,500)
 assert.ok(response.notes.startsWith(PRICE_REVIEW_NOTE))
})
