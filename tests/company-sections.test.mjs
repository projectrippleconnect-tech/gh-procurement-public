import test from 'node:test'
import assert from 'node:assert/strict'
import {companySectionRows,sectionPaths,validSectionParent} from '../lib/company-section-tree.mjs'
const sections=[
 {id:'a',name:'Panels',parent_id:null,sort_order:10,active:true},
 {id:'b',name:'Ceiling Fittings',parent_id:'a',sort_order:10,active:true},
 {id:'c',name:'GI Channel',parent_id:'b',sort_order:2,active:true,color:'#a46a23'},
 {id:'d',name:'Switches',parent_id:null,sort_order:20,active:true}
]
const rows=[
 {id:'1',section_id:'c',item:{description:'GI Channel',size:'12ft'}},
 {id:'2',section_id:'c',item:{description:'GI Channel',size:'10ft'}},
 {id:'3',section_id:'d',item:{description:'1 Way Switch',size:'1G'}}
]
test('section paths include nested grandchildren',()=>{
 const paths=sectionPaths(sections)
 assert.equal(paths.get('c'),'Panels / Ceiling Fittings / GI Channel')
 assert.equal(paths.get('d'),'Switches')
})
test('nested rows keep each stock item once and color and depth are isolated',()=>{
 const output=companySectionRows(rows,sections)
 assert.deepEqual(output.filter(x=>x.type==='item').map(x=>x.key).sort(),['1','2','3'])
 assert.deepEqual(output.filter(x=>x.type==='section').map(x=>[x.title,x.depth,x.count]),[['Panels',0,2],['Ceiling Fittings',1,2],['GI Channel',2,2],['Switches',0,1]])
 assert.equal(output.find(x=>x.title==='GI Channel').color,'#a46a23')
})
test('collapsing ancestors hides children until searching, without losing stock entries',()=>{
 const collapsed=companySectionRows(rows,sections,{a:true})
 assert.equal(collapsed.filter(x=>x.type==='item').length,1)
 assert.equal(collapsed.find(x=>x.title==='Panels').count,2)
 assert.equal(companySectionRows(rows,sections,{a:true},true).filter(x=>x.type==='item').length,3)
})
test('section moves reject cycles while allowing children of other sections',()=>{
 assert.equal(validSectionParent(sections,'a','c'),false)
 assert.equal(validSectionParent(sections,'c','c'),false)
 assert.equal(validSectionParent(sections,'c','d'),true)
 assert.equal(validSectionParent(sections,'c',''),true)
})
test('legacy rows remain visible when a new company has not yet been migrated',()=>{
 const legacy=[{id:'x',item:{description:'GI Nut',category:'Hardware',subgroup:'Nuts'}}]
 assert.equal(companySectionRows(legacy,[]).filter(x=>x.type==='item').length,1)
 assert.equal(companySectionRows(legacy,sections).filter(x=>x.type==='item').length,1)
})
