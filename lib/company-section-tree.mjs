import {groupCompanyRows} from './company-items.mjs'
const compare=(a,b)=>String(a||'').localeCompare(String(b||''),undefined,{numeric:true,sensitivity:'base'})
const byOrder=(a,b)=>(Number(a.sort_order)||0)-(Number(b.sort_order)||0)||compare(a.name,b.name)
export function sectionPaths(sections=[]){
 const index=new Map(sections.map(s=>[s.id,s]))
 const paths=new Map()
 function build(id,visited=new Set()){
  if(paths.has(id))return paths.get(id)
  const s=index.get(id)
  if(!s||visited.has(id))return ''
  const parents=new Set(visited);parents.add(id)
  const parent=s.parent_id?build(s.parent_id,parents):''
  const path=[parent,s.name].filter(Boolean).join(' / ')
  paths.set(id,path)
  return path
 }
 for(const s of sections)build(s.id)
 return paths
}
/** One row per item; nested colored section headings and optional collapsed branches. */
export function companySectionRows(rows=[],sections=[],collapsed={},filtering=false){
 if(!sections.length){
  return groupCompanyRows(rows).flatMap(group=>[
   {type:'section',key:group.key,title:group.title,depth:0,count:group.items.length,legacy:true},
   ...group.items.map(row=>({type:'item',key:row.id,row,depth:1}))
  ])
 }
 const index=new Map(sections.filter(s=>s.active!==false).map(s=>[s.id,{...s,children:[],items:[]}]))
 const roots=[]
 for(const s of index.values()){
  if(s.parent_id&&index.has(s.parent_id)&&s.parent_id!==s.id)index.get(s.parent_id).children.push(s)
  else roots.push(s)
 }
 for(const r of rows){const s=index.get(r.section_id);if(s)s.items.push(r)}
 for(const s of index.values()){s.children.sort(byOrder);s.items.sort((a,b)=>compare(a.item?.description,b.item?.description)||compare(a.item?.size,b.item?.size))}
 roots.sort(byOrder)
 const output=[],seen=new Set()
 function visit(s,depth){
  if(seen.has(s.id))return 0
  seen.add(s.id)
  const place=output.length
  output.push({type:'section',key:s.id,id:s.id,title:s.name,depth,count:0,color:s.color,sort_order:s.sort_order})
  if(!collapsed[s.id]||filtering){
   for(const r of s.items)output.push({type:'item',key:r.id,row:r,depth:depth+1})
   for(const child of s.children)visit(child,depth+1)
  }
  // Items are direct plus all descendants, including currently collapsed ones.
  const countItems=(id,traversed=new Set())=>{
   if(traversed.has(id))return 0
   const n=index.get(id);if(!n)return 0
   const v=new Set(traversed);v.add(id)
   return n.items.length+n.children.reduce((sum,c)=>sum+countItems(c.id,v),0)
  }
  const count=countItems(s.id)
  output[place].count=count
  if(!count&&!filtering){output.splice(place,output.length-place);return 0}
  return count
 }
 for(const root of roots)visit(root,0)
 const unmatched=rows.filter(r=>!index.has(r.section_id))
 if(unmatched.length){
  for(const group of groupCompanyRows(unmatched)){
   output.push({type:'section',key:'legacy:'+group.key,title:group.title,depth:0,count:group.items.length,legacy:true})
   for(const r of group.items)output.push({type:'item',key:r.id,row:r,depth:1})
  }
 }
 return output
}
export function validSectionParent(sections=[],id,parentId){
 if(!parentId)return true
 if(id===parentId)return false
 const byId=new Map(sections.map(s=>[s.id,s]))
 let at=parentId
 const seen=new Set()
 while(at&&!seen.has(at)){
  if(at===id)return false
  seen.add(at);at=byId.get(at)?.parent_id
 }
 return !at
}
