'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {ModernSelect} from './modern-select'
import {qty} from '@/lib/helpers'
import {companyCompactMeta,reorderFor} from '@/lib/company-items.mjs'
import {COMPANY_ROW_LAYOUT_DEFAULTS,COMPANY_ROW_POSITION_FIELDS,normalizeCompanyRowLayout,companyRowPosition,companyRowStyle} from '@/lib/company-row-layout.mjs'

/** All item information is rendered once, in the row selected by the company layout. */
export function CompanyItemDetails({row,visibleFields={},layout={}}){
 const item=row.item||{},meta=companyCompactMeta(item,visibleFields),size=meta.find(x=>x.key==='size')
 const p=normalizeCompanyRowLayout(layout)
 const cells=[
  ...(size?[{key:'size',node:<strong className="company-item-size">{size.value}</strong>}]:[]),
  ...(visibleFields.max!==false?[{key:'max',node:<span className="company-item-meta company-meta-max">Max <b>{row.max_stock_review?'Review':qty(row.target_stock)}</b></span>}]:[]),
  ...(visibleFields.reorder!==false?[{key:'reorder',node:<span className="company-item-meta company-meta-reorder">Reorder <b>{row.max_stock_review?'—':qty(row.reorder_level??reorderFor(row.target_stock))}</b></span>}]:[]),
  ...meta.filter(x=>x.key!=='size').map(x=>({key:'details:'+x.key,position:'details',node:<span className="company-item-meta company-meta-other">{x.label&&<span className="company-meta-label">{x.label} </span>}{x.value}</span>}))
 ]
 const at=place=>cells.filter(x=>companyRowPosition(p,x.position||x.key)===place)
 return <div className="company-item-presentation">
  <div className="company-item-line company-first-line"><strong className="company-item-name">{item.description}</strong>{at('first').map(x=><span className="company-item-field" key={x.key}>{x.node}</span>)}</div>
  {at('second').length>0&&<div className="company-item-line company-second-line">{at('second').map(x=><span className="company-item-field" key={x.key}>{x.node}</span>)}</div>}
 </div>
}

/** Settings are saved per company and do not affect physical counts or any other company. */
export function CompanyRowLayoutControls({company,onSaved,flash,fail}){
 const[draft,setDraft]=useState(()=>normalizeCompanyRowLayout(company?.visible_fields?.row_layout))
 const[busy,setBusy]=useState(false)
 useEffect(()=>setDraft(normalizeCompanyRowLayout(company?.visible_fields?.row_layout)),[company?.id,company?.updated_at,company?.visible_fields?.row_layout])
 if(!company?.id)return null
 const set=(key,value)=>setDraft(d=>({...d,[key]:value}))
 async function save(){
  if(busy)return
  setBusy(true)
  try{
   const row_layout=normalizeCompanyRowLayout(draft)
   const visible_fields={...(company.visible_fields||{}),row_layout}
   const r=await supabase.from('proc_companies').update({visible_fields,updated_at:new Date().toISOString()}).eq('id',company.id).select('id,visible_fields,updated_at').single()
   if(r.error)throw r.error
   onSaved(r.data)
   flash('Company stock layout saved for all staff. Refresh to see it on another device.')
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 const preview={item:{description:'GI NUT',size:'1/2',uom:'KG'},target_stock:10,reorder_level:5,max_stock_review:false}
 const fields={...(company.visible_fields||{}),size:true,uom:true,max:true,reorder:true}
 const fontSliders=[['nameFont','Item & size font',11,22],['metaFont','Max, reorder & details font',9,19],['rowPadding','Row padding',2,14],['fieldGap','Space between fields',2,20],['lineGap','Space between first and second row',0,12]]
 return <details className="company-row-layout-settings section">
  <summary>Customize row layout · Font & spacing</summary>
  <div className="company-layout-settings-body">
   <p className="muted tiny">For {company.name}: choose first or second row for each detail, then adjust font and spacing. Item name and size always use the same font size. Saved settings apply to this company list on all devices.</p>
   <div className="company-layout-controls">
    {COMPANY_ROW_POSITION_FIELDS.map(([key,label])=><label className="field" key={key}>{label}<ModernSelect aria-label={label+' row'} className="select" value={draft[key]} onChange={e=>set(key,e.target.value)}><option value="first">First row</option><option value="second">Second row</option></ModernSelect></label>)}
   </div>
   <div className="company-layout-controls section">
    {fontSliders.map(([key,label,min,max])=><label className="field" key={key}>{label}: {draft[key]} px<input aria-label={label} type="range" min={min} max={max} step="1" value={draft[key]} onChange={e=>set(key,Number(e.target.value))}/></label>)}
   </div>
   <div className="company-layout-preview" style={companyRowStyle(draft)}>
    <span className="muted tiny">Live preview</span>
    <CompanyItemDetails row={preview} visibleFields={fields} layout={draft}/>
   </div>
   <div className="toolbar section"><button type="button" className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save company layout'}</button><button type="button" className="btn" disabled={busy} onClick={()=>setDraft({...COMPANY_ROW_LAYOUT_DEFAULTS})}>Reset layout to default</button></div>
  </div>
 </details>
}
