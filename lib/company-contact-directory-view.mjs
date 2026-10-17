// Company Supplier Directory filtering. "all" is for display only; a save needs a real company ID.
export const ALL_DIRECTORY_COMPANIES='all'

export function companyDirectoryView({saved=[],assigned=[],companies=[],companyId=ALL_DIRECTORY_COMPANIES,query=''}) {
 const companyNames=new Map(companies.map(c=>[c.id,String(c.name||'')]))
 const text=String(query||'').trim().toLocaleLowerCase()
 const matches=c=>(companyId===ALL_DIRECTORY_COMPANIES||c.company_id===companyId)&&
  (!text||[companyNames.get(c.company_id)||'',c.name||'',c.phone||'']
   .some(value=>String(value).toLocaleLowerCase().includes(text)))
 const compare=(a,b)=>(companyNames.get(a.company_id)||'').localeCompare(companyNames.get(b.company_id)||'','en',{sensitivity:'base',numeric:true})||
  String(a.name||'').localeCompare(String(b.name||''),'en',{sensitivity:'base',numeric:true})||
  String(a.id||a.supplier_id||'').localeCompare(String(b.id||b.supplier_id||''))
 const savedRows=saved.filter(matches).sort(compare)
 const savedSupplierKeys=new Set(saved.map(c=>String(c.company_id)+':'+String(c.supplier_id)))
 const assignedRows=assigned.filter(c=>!savedSupplierKeys.has(String(c.company_id)+':'+String(c.supplier_id))).filter(matches).sort(compare)
 return {savedRows,assignedRows,companyNames}
}
