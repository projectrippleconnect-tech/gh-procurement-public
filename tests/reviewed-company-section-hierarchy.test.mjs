import test from 'node:test'
import assert from 'node:assert/strict'
import {companySectionRows,sectionPaths} from '../lib/company-section-tree.mjs'

const root={id:'root',name:'BOARD ITEMS',parent_id:null,sort_order:0,color:null,active:true}
const plywood={id:'plywood',name:'PLYWOOD BOARDS',parent_id:'root',sort_order:0,color:'#2563EB',active:true}
const melamine={id:'melamine',name:'MELAMINE BOARDS',parent_id:'root',sort_order:14,color:'#2563EB',active:true}
const ash={id:'ash',name:'WHITE ASH',parent_id:'melamine',sort_order:21,color:'#0F766E',active:true}
const rows=[
 {id:'l1',section_id:'plywood',sort_order:0,item:{id:'i1',description:'PLYWOOD BOARD LOCAL 1/8IN'}},
 {id:'l2',section_id:'ash',sort_order:21,item:{id:'i2',description:'MELAMINE BOARD WHITE ASH 1/8IN'}}
]
test('reviewed sections produce nested, colored collapsible Stock Entry headers and preserve original row IDs',()=>{
 const sections=[root,plywood,melamine,ash]
 const rendered=companySectionRows(rows,sections)
 assert.deepEqual(rendered.filter(r=>r.type==='section').map(r=>[r.title,r.depth,r.count]),[
 ['BOARD ITEMS',0,2],['PLYWOOD BOARDS',1,1],['MELAMINE BOARDS',1,1],['WHITE ASH',2,1]])
 assert.deepEqual(rendered.filter(r=>r.type==='item').map(x=>x.row.id),['l1','l2'])
 assert.equal(rendered.find(x=>x.title==='WHITE ASH').color,'#0F766E')
 assert.equal(sectionPaths(sections).get('ash'),'BOARD ITEMS / MELAMINE BOARDS / WHITE ASH')
})
test('collapsing a reviewed child section hides descendants but preserves other products',()=>{
 const rendered=companySectionRows(rows,[root,plywood,melamine,ash],{melamine:true})
 assert.deepEqual(rendered.filter(r=>r.type==='item').map(x=>x.row.id),['l1'])
 assert.ok(rendered.some(x=>x.title==='MELAMINE BOARDS'))
 assert.ok(!rendered.some(x=>x.title==='WHITE ASH'))
})
test('search bypasses collapse to reveal a matched source item',()=>{
 const rendered=companySectionRows([rows[1]],[root,plywood,melamine,ash],{melamine:true},true)
 assert.deepEqual(rendered.filter(r=>r.type==='item').map(x=>x.row.id),['l2'])
 assert.equal(rendered.find(x=>x.title==='BOARD ITEMS').count,1)
})
test('existing ceiling hierarchy still keeps its customized branches without duplication',()=>{
 const panel=[
 {id:'panel',name:'PANEL SHEETS',parent_id:null,sort_order:0,active:true},
 {id:'ceiling',name:'CEILING FITTINGS',parent_id:'panel',sort_order:0,active:true},
 {id:'channel',name:'GI CHANNEL',parent_id:'ceiling',sort_order:0,active:true},
 {id:'ipanel',name:'I PANEL',parent_id:'panel',sort_order:12,active:true},
 {id:'teak',name:'TEAK',parent_id:'ipanel',sort_order:12,active:true}
 ]
 const saved=[{id:'gi1',section_id:'channel',sort_order:0,item:{description:'GI CHANNEL 35MM'}},{id:'p1',section_id:'teak',sort_order:12,item:{description:'I PANEL TEAK 10FT'}}]
 const out=companySectionRows(saved,panel)
 assert.equal(out.filter(x=>x.type==='item').length,2)
 assert.equal(out.filter(x=>x.title==='GI CHANNEL').length,1)
 assert.equal(out.filter(x=>x.title==='I PANEL').length,1)
})
