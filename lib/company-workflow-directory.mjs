// Pure helpers for the company workflow directory. Read-only: never dispatch orders.
export const uniqueIds=values=>[...new Set((values||[]).filter(Boolean))];

export function companyWorkflowMode(route){
 return route?.auto_send ? (route.route_mode==='direct'?'direct':'rfq') : 'manual';
}

export function workflowRows(companies=[],sections=[],routes=[],links=[],pool=[]){
 const sectionPaths=new Map();
 const byId=new Map(sections.filter(s=>s.active!==false).map(s=>[s.id,s]));
 function pathFor(section,visited=new Set()){
  if(!section||visited.has(section.id))return '';
  if(sectionPaths.has(section.id))return sectionPaths.get(section.id);
  const parent=byId.get(section.parent_id);
  const path=[parent?pathFor(parent,new Set([...visited,section.id])):'',section.name].filter(Boolean).join(' / ');
  sectionPaths.set(section.id,path);return path;
 }
 const routeLinks=new Map();
 for(const link of links){const ids=routeLinks.get(link.route_id)||[];ids.push(link);routeLinks.set(link.route_id,ids)}
 const groupedPool=new Map();
 for(const contact of pool){const k=contact.company_id+':'+contact.section_id;const list=groupedPool.get(k)||[];list.push(contact);groupedPool.set(k,list)}
 function idsFromLinks(route){
  if(!route)return [];
  const selected=(routeLinks.get(route.id)||[]).sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(a=>a.supplier_id);
  // Assignment is not authorization to send. A route with zero saved
  // recipient links must display zero recipients, not every available contact.
  return uniqueIds(selected);
 }
 const list=[];
 for(const company of [...companies].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}))){
  const ownedRoutes=routes.filter(r=>r.company_id===company.id);
  const routeBySection=new Map(ownedRoutes.map(r=>[r.section_id||'company',r]));
  const ownedSections=sections.filter(s=>s.company_id===company.id&&s.active!==false)
   .sort((a,b)=>pathFor(a).localeCompare(pathFor(b),undefined,{numeric:true}));
  for(const section of [null,...ownedSections]){
   const id=section?.id||'company';
   let node=section, effective=null, source='company', seen=new Set();
   if(!section){effective=routeBySection.get('company')||null}
   else{
    while(node&&!seen.has(node.id)){
     seen.add(node.id);
     const match=routeBySection.get(node.id);
     if(match){effective=match;source=node.id;break}
     node=byId.get(node.parent_id);
    }
    if(!effective){effective=routeBySection.get('company')||null;source='company'}
   }
   const own=routeBySection.get(id)||null;
   let contactIds=[];
   if(section){
    node=section;seen=new Set();
    while(node&&!seen.has(node.id)){
     seen.add(node.id);
     const contacts=groupedPool.get(company.id+':'+node.id)||[];
     if(contacts.length){contactIds=uniqueIds(contacts.sort((a,b)=>(a.sort_order||0)-(b.sort_order||0)).map(x=>x.supplier_id));break}
     node=byId.get(node.parent_id);
    }
   }
   const routeIds=idsFromLinks(effective);
   // An assigned contact pool is broader than the recipients selected to receive
   // an RFQ or PO. Never replace either list with the other when reading a route.
   const savedAssigned=uniqueIds(effective?.assigned_supplier_ids||[]);
   const exactAssigned=own?.assigned_supplier_ids===null||own?.assigned_supplier_ids===undefined
    ?[]:uniqueIds(own.assigned_supplier_ids);
   const fallback=company.default_supplier_id?[company.default_supplier_id]:[];
   const assigned=uniqueIds([
    ...(own?exactAssigned:savedAssigned),
    ...contactIds,
    ...routeIds,
    ...(!own&&!savedAssigned.length&&!contactIds.length&&!routeIds.length?fallback:[])
   ]);
   const recipients=effective?routeIds:assigned;
   list.push({key:company.id+':'+id,company,section,section_id:section?.id||null,path:section?pathFor(section):'Entire company',own,effective,source,mode:companyWorkflowMode(effective),assigned,recipients,hasOverride:!!own,inherited:!!effective&&!own});
  }
 }
 return list;
}

export function workflowValidation(mode,ids=[],suppliers=[]){
 const selected=uniqueIds(ids);
 if(mode==='manual')return {valid:true,error:''};
 if(!selected.length)return {valid:false,error:'Assign a company contact first.'};
 if(mode==='direct'&&selected.length!==1)return {valid:false,error:'Auto PO requires exactly one supplier.'};
 if(selected.length>15)return {valid:false,error:'Choose at most 15 suppliers.'};
 for(const id of selected){
  const s=suppliers.find(v=>v.id===id);
  if(!s)return {valid:false,error:'Supplier no longer exists. Refresh the directory.'};
  if(!/^\+947\d{8}$/.test(s.whatsapp||s.phone||''))return {valid:false,error:'Supplier must have a valid +94 WhatsApp number.'};
 }
 return {valid:true,error:''};
}
