import {defaultCompanyFields} from './company-items.mjs'
import {normalizeCompanyRowLayout} from './company-row-layout.mjs'

// One shared display profile for every Company List. Never store it on a company.
export const COMPANY_DISPLAY_KEY='company_lists_display'
export const COMPANY_DISPLAY_FIELDS=Object.freeze([
 ['size','Size'],['max','Maximum stock'],['reorder','Reorder level'],['uom','Unit'],
 ['colour','Colour'],['variation','Variation'],['brand','Brand'],
 ['category','Category'],['subgroup','Subcategory'],['remarks','Remarks']
])
export const DEFAULT_SECTION_COLORS=Object.freeze(['#295b89','#187969','#a46a23','#714c95','#4e7387','#516277'])
export function normalizeCompanyDisplay(value={}){
 const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{}
 const incoming=source.fields&&typeof source.fields==='object'&&!Array.isArray(source.fields)?source.fields:{}
 const fields=Object.fromEntries(Object.entries(defaultCompanyFields).map(([key,v])=>[key,incoming[key]===undefined?v:incoming[key]!==false]))
 const colors=DEFAULT_SECTION_COLORS.map((fallback,i)=>{
  const color=String(source.sectionColors?.[i]??'')
  return /^#[0-9a-fA-F]{6}$/.test(color)?color:fallback
 })
 return {fields,row_layout:normalizeCompanyRowLayout(source.row_layout),sectionColors:colors}
}
