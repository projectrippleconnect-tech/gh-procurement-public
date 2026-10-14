// Per-company stock table appearance, stored under proc_companies.visible_fields.row_layout.
// This changes presentation only; stock values and procurement rules are unchanged.
export const COMPANY_ROW_LAYOUT_DEFAULTS=Object.freeze({
 size:'first',max:'second',reorder:'second',details:'second',
 nameFont:13,metaFont:11,rowPadding:5,fieldGap:8,lineGap:2,sectionFont:12,sectionPadding:6,sectionIndent:9
})
export const COMPANY_ROW_POSITION_FIELDS=Object.freeze([
 ['size','Size / variant'],
 ['max','Maximum stock'],
 ['reorder','Reorder level'],
 ['details','Unit, colour & other details']
])
const bounds={nameFont:[11,22],metaFont:[9,19],rowPadding:[2,14],fieldGap:[2,20],lineGap:[0,12],sectionFont:[10,20],sectionPadding:[3,16],sectionIndent:[4,22]}
export function normalizeCompanyRowLayout(value={}){
 const v=value&&typeof value==='object'&&!Array.isArray(value)?value:{}
 return Object.fromEntries(Object.entries(COMPANY_ROW_LAYOUT_DEFAULTS).map(([key,fallback])=>{
  if(key in bounds){
   const num=Number(v[key])
   return [key,v[key]!==undefined&&v[key]!==null&&v[key]!==''&&Number.isFinite(num)?Math.round(Math.max(bounds[key][0],Math.min(bounds[key][1],num))):fallback]
  }
  return [key,['first','second'].includes(v[key])?v[key]:fallback]
 }))
}
export function companyRowPosition(layout,key){
 return normalizeCompanyRowLayout(layout)[key]==='first'?'first':'second'
}
export function companyRowStyle(value){
 const p=normalizeCompanyRowLayout(value)
 return {
  '--company-name-font':p.nameFont+'px',
  '--company-meta-font':p.metaFont+'px',
  '--company-row-padding':p.rowPadding+'px',
  '--company-field-gap':p.fieldGap+'px',
  '--company-line-gap':p.lineGap+'px',
  '--company-section-font':p.sectionFont+'px',
  '--company-section-padding':p.sectionPadding+'px',
  '--company-section-indent':p.sectionIndent+'px'
 }
}
