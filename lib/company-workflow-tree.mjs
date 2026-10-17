// Pure, side-effect-free hierarchy and preset helpers for Company Workflow Directory.
// Saving settings is handled separately, through authenticated procurement RPCs.
export const REQUESTED_COMPANY_MODES = Object.freeze({
 'PANEL SHEETS':'rfq', 'CEMENT BASED':'rfq', 'BOARD ITEMS':'rfq',
 'REGIFOAM':'direct', 'RUBBER HOSE':'rfq', 'ALCATHINE':'direct',
 'BIXTON':'direct', 'BOLT & NUTS':'direct', 'WURTH':'direct',
 'CASING':'rfq', 'PE+':'direct', 'KOBE':'rfq', 'MULTI BOND':'direct',
 'KEVILTON':'direct', 'ORANGE':'rfq', 'POLYCHROME':'rfq',
 'FEVICOL':'direct', 'ROCKER':'direct', 'WIRE CABLES':'rfq'
});
const aliases={'ALKATHINE':'ALCATHINE','ALKATHENE':'ALCATHINE'};
export const canonicalCompanyName=name=>{
 const norm=String(name||'').trim().replace(/\s+/g,' ').toUpperCase();
 return aliases[norm]||norm;
};
export function requestedModeFor(name){return REQUESTED_COMPANY_MODES[canonicalCompanyName(name)]||null}

export function companyBranchRows(rows=[],root){
 const owned=rows.filter(r=>r.company.id===root.company.id);
 if(!root.section)return owned;
 const byId=new Map(owned.filter(r=>r.section).map(r=>[r.section_id,r]));
 return owned.filter(row=>{
  if(!row.section)return false;
  let node=row.section,visited=new Set();
  while(node&&!visited.has(node.id)){
   if(node.id===root.section_id)return true;
   visited.add(node.id);node=byId.get(node.parent_id)?.section||null;
  }
  return false;
 });
}

export function branchOverrideRows(rows=[],root){
 return companyBranchRows(rows,root).filter(r=>r.key!==root.key&&!!r.own);
}

// Tree is for rendering only; the DB's section.parent_id remains authoritative.
export function companyScopeTree(rows=[],companyId){
 const owned=rows.filter(r=>r.company.id===companyId);
 const nodes=new Map(owned.filter(r=>r.section).map(r=>[r.section_id,{row:r,children:[]}]));
 const roots=[];
 for(const node of nodes.values()){
  const parentId=node.row.section.parent_id;
  const parent=nodes.get(parentId);
  if(parent&&parent!==node)parent.children.push(node);
  else roots.push(node);
 }
 const sort=(a,b)=>a.row.section.name.localeCompare(b.row.section.name,undefined,{numeric:true});
 const clean=(list,stack=new Set())=>list.sort(sort).filter(node=>{
  if(stack.has(node.row.section_id))return false;
  node.children=clean(node.children,new Set([...stack,node.row.section_id]));
  return true;
 });
 return {company:owned.find(r=>!r.section)||null,sections:clean(roots)};
}

export function branchItemCount(items=[],root,sections=[]){
 const ids=new Set();
 if(root.section){
  ids.add(root.section_id);
  const candidates=sections.filter(s=>s.company_id===root.company.id&&s.active!==false);
  let pending=true;
  while(pending){
   pending=false;
   for(const child of candidates)if(!ids.has(child.id)&&ids.has(child.parent_id)){ids.add(child.id);pending=true}
  }
 }
 const counted=new Set();
 for(const item of items){
  if(item.company_id!==root.company.id||item.active===false)continue;
  if(root.section&&!ids.has(item.section_id))continue;
  counted.add(item.id);
 }
 return counted.size;
}

// Choosing a parent means its descendants inherit the saved route unless
// explicitly spared. Returns only persisted child overrides that need clearing.
export function parentApplyPreview(rows,root,{includeChildren=true}={}){
 const descendants=companyBranchRows(rows,root).filter(r=>r.key!==root.key);
 return {descendantSections:descendants.length,overridesToClear:includeChildren?descendants.filter(r=>!!r.own):[],inheritedSections:descendants.filter(r=>!r.own).length};
}

export function branchSupplierConflicts(rows,root,selectedIds,pool=[]){
 const wanted=[...new Set(selectedIds)].sort().join('|');
 const scoped=new Set(companyBranchRows(rows,root).filter(r=>r.key!==root.key&&r.section).map(r=>r.section_id));
 const groups=new Map();
 for(const entry of pool){
  if(entry.company_id!==root.company.id||!scoped.has(entry.section_id))continue;
  const list=groups.get(entry.section_id)||new Set();
  list.add(entry.supplier_id);groups.set(entry.section_id,list);
 }
 return [...groups].filter(([,ids])=>[...ids].sort().join('|')!==wanted).map(([id])=>{
  const section=rows.find(r=>r.company.id===root.company.id&&r.section_id===id);
  return section?.path||'Unnamed subcategory';
 });
}

// A parent sets the mode of the full branch while retaining suppliers assigned
// to child routes or to exact child contact groups. Nothing is sent here.
export function planBranchMode(rows,root,mode,ids,pool=[]){
 const selected=[...new Set(ids.filter(Boolean))]
 const owned=companyBranchRows(rows,root).filter(r=>r.key!==root.key).sort((a,b)=>a.path.split(' / ').length-b.path.split(' / ').length)
 const byId=new Map(owned.map(r=>[r.section_id,r]))
 const planned=new Map([[root.section_id||'company',selected]])
 const actions=[{row:root,mode,ids:selected}]
 const expected=[{row:root,mode,ids:selected}]
 const conflicts=[]
 const same=(a,b)=>[...a].sort().join('|')===[...b].sort().join('|')
 for(const child of owned){
  const parentKey=child.section?.parent_id||'company'
  const parentIds=planned.get(parentKey)||selected
  const exact=[...new Set(pool.filter(p=>p.company_id===root.company.id&&p.section_id===child.section_id).map(p=>p.supplier_id))]
  const ownIds=child.own?child.recipients:[]
  if(ownIds.length&&exact.length&&!same(ownIds,exact)){
   conflicts.push({path:child.path,reason:'Saved route recipients differ from the designated contact group'})
  }
  const childIds=ownIds.length?ownIds:exact.length?exact:parentIds
  planned.set(child.section_id,childIds)
  expected.push({row:child,mode,ids:childIds})
  const mustOwn=!!child.own||(exact.length>0&&!same(childIds,parentIds))
  if(mustOwn&&(!child.own||child.mode!==mode||!same(child.recipients,childIds))){
   actions.push({row:child,mode,ids:childIds})
  }
 }
 return {actions,expected,conflicts,descendantSections:owned.length}
}
