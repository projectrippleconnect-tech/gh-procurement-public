'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {ModernSelect} from './modern-select'
import {qty} from '@/lib/helpers'
import {companyCompactMeta,reorderFor} from '@/lib/company-items.mjs'
import {COMPANY_ROW_POSITION_FIELDS,normalizeCompanyRowLayout,companyRowPosition,companyRowStyle} from '@/lib/company-row-layout.mjs'
import {COMPANY_DISPLAY_KEY,COMPANY_DISPLAY_FIELDS,normalizeCompanyDisplay} from '@/lib/company-display.mjs'

/** All item information is rendered once, in the row selected by the company layout. */
export function CompanyItemDetails({row,visibleFields={},layout={},preview=false}){
 const item=row.item||{},meta=companyCompactMeta(item,visibleFields),size=meta.find(x=>x.key==='size')
 const p=normalizeCompanyRowLayout(layout)
 const cells=[
  ...(size?[{key:'size',node:<strong className={preview?'company-layout-sample-size':'company-item-size'}>{size.value}</strong>}]:[]),
  ...(visibleFields.max!==false?[{key:'max',node:<span className="company-item-meta company-meta-max">Max <b>{row.max_stock_review?'Review':qty(row.target_stock)}</b></span>}]:[]),
  ...(visibleFields.reorder!==false?[{key:'reorder',node:<span className="company-item-meta company-meta-reorder">Reorder <b>{row.max_stock_review?'—':qty(row.reorder_level??reorderFor(row.target_stock))}</b></span>}]:[]),
  ...meta.filter(x=>x.key!=='size').map(x=>({key:'details:'+x.key,position:'details',node:<span className="company-item-meta company-meta-other">{x.label&&<span className="company-meta-label">{x.label} </span>}{x.value}</span>}))
 ]
 const at=place=>cells.filter(x=>companyRowPosition(p,x.position||x.key)===place)
 return <div className="company-item-presentation">
  <div className="company-item-line company-first-line"><strong className={preview?'company-layout-sample-name':'company-item-name'}>{item.description}</strong>{at('first').map(x=><span className="company-item-field" key={x.key}>{x.node}</span>)}</div>
  {at('second').length>0&&<div className="company-item-line company-second-line">{at('second').map(x=><span className="company-item-field" key={x.key}>{x.node}</span>)}</div>}
 </div>
}

/** Global display preferences shared by every company list; only super admins can save. */
export function CompanyRowLayoutControls({value,onSaved,flash,fail}){
 const[draft,setDraft]=useState(()=>normalizeCompanyDisplay(value)),[busy,setBusy]=useState(false)
 useEffect(()=>setDraft(normalizeCompanyDisplay(value)),[value])
 const setLayout=(key,value)=>setDraft(d=>({...d,row_layout:{...d.row_layout,[key]:value}}))
 const setField=(key,value)=>setDraft(d=>({...d,fields:{...d.fields,[key]:value}}))
 const color=(i,value)=>setDraft(d=>({...d,sectionColors:d.sectionColors.map((c,j)=>j===i?value:c)}))
 async function save(){
  if(busy)return
  setBusy(true)
  try{
   const next=normalizeCompanyDisplay(draft)
   const r=await supabase.from('proc_settings').upsert({key:COMPANY_DISPLAY_KEY,value:next,description:'Shared Company Lists fields, layout and section heading styles for all companies'})
   if(r.error)throw r.error
   await onSaved(next)
   flash('Global Company Lists display saved for every company and staff device.')
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 const preview={item:{description:'GI NUT',size:'1/2',uom:'KG',colour:'ZINC',brand:'SAMPLE'},target_stock:10,reorder_level:5,max_stock_review:false}
 const sliders=[['nameFont','Item & size font',11,22],['metaFont','Additional information font',9,19],['rowPadding','Row padding',2,14],['fieldGap','Horizontal field spacing',2,20],['lineGap','Spacing between first and second row',0,12],['sectionFont','Section heading font',10,20],['sectionPadding','Section heading padding',3,16],['sectionIndent','Nested section indentation',4,22]]
 return <details className="company-row-layout-settings section" data-global-company-settings="true">
  <summary>Company Lists · Global display customization</summary>
  <div className="company-layout-settings-body">
   <p className="muted tiny">These settings apply to ALL company lists. Hiding Max or Reorder changes only the display; saved stock limits and order calculations remain unchanged.</p>
   <h4>Show / hide fields</h4>
   <div className="company-layout-controls company-field-toggles">{COMPANY_DISPLAY_FIELDS.map(([key,label])=><label className="checkline" key={key}><input aria-label={'Show '+label} type="checkbox" checked={draft.fields[key]!==false} onChange={e=>setField(key,e.target.checked)}/>{label}</label>)}</div>
   <h4 className="section">Place fields in first or second row</h4>
   <div className="company-layout-controls">{COMPANY_ROW_POSITION_FIELDS.map(([key,label])=><label className="field" key={key}>{label}<ModernSelect aria-label={label+' row'} className="select" value={draft.row_layout[key]} onChange={e=>setLayout(key,e.target.value)}><option value="first">First row</option><option value="second">Second row</option></ModernSelect></label>)}</div>
   <h4 className="section">Fonts & spacing</h4>
   <div className="company-layout-controls">{sliders.map(([key,label,min,max])=><label className="field" key={key}>{label}: {draft.row_layout[key]} px<input aria-label={label} type="range" min={min} max={max} value={draft.row_layout[key]} onChange={e=>setLayout(key,Number(e.target.value))}/></label>)}</div>
   <h4 className="section">Section header colors by nesting level</h4>
   <div className="company-layout-controls">{draft.sectionColors.map((value,i)=><label className="field" key={i}>Level {i+1}<input aria-label={'Section level '+(i+1)+' color'} type="color" value={value} onChange={e=>color(i,e.target.value)}/></label>)}</div>
   <div className="company-layout-preview" style={companyRowStyle(draft.row_layout)}><span className="muted tiny">Live preview · every company</span><CompanyItemDetails row={preview} visibleFields={draft.fields} layout={draft.row_layout} preview/></div>
   <div className="toolbar section"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save global layout'}</button><button type="button" className="btn" disabled={busy} onClick={()=>setDraft(normalizeCompanyDisplay())}>Reset to defaults</button></div>
  </div>
 </details>
}
