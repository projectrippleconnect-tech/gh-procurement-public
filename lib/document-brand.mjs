// Document branding is separate from the legal/business name stored in settings.
export function documentBrand(company={}){
 const explicit=String(company.document_name||'').trim()
 if(explicit)return explicit
 const name=String(company.name||'').trim()
 return !name||/^general\s+hardware$/i.test(name)?'GEN':name
}
