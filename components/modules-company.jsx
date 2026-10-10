'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {allRows,containsAny} from '@/lib/query-pages'
import {businessDate,money,qty} from '@/lib/helpers'
import {Badge,DataTable,Empty,fieldEnabled,fieldLabel} from './ui'
import {extractPriceListFile} from '@/lib/price-list-extract'

const cleanName=s=>String(s||'file').replace(/[^a-zA-Z0-9._-]/g,'_')
const makeId=()=>globalThis.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(16).slice(2)
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n))

function ImageCropper({file,onReady,t=(k,f)=>f||k}){
 const[src,setSrc]=useState(''),[crop,setCrop]=useState({x:5,y:5,w:90,h:90}),[busy,setBusy]=useState(false)
 const box=useRef(null),drag=useRef(null)

 useEffect(()=>{
  if(!file||!String(file.type||'').startsWith('image/')){setSrc('');return}
  const u=URL.createObjectURL(file);setSrc(u);setCrop({x:5,y:5,w:90,h:90})
  return()=>URL.revokeObjectURL(u)
 },[file])

 function start(e,mode){
  if(!box.current)return
  e.currentTarget.setPointerCapture?.(e.pointerId)
  drag.current={id:e.pointerId,mode,x:e.clientX,y:e.clientY,c:{...crop}}
 }
 function move(e){
  const d=drag.current;if(!d||d.id!==e.pointerId||!box.current)return
  const r=box.current.getBoundingClientRect(),dx=(e.clientX-d.x)/r.width*100,dy=(e.clientY-d.y)/r.height*100,c={...d.c}
  if(d.mode==='move'){
   c.x=clamp(d.c.x+dx,0,100-d.c.w);c.y=clamp(d.c.y+dy,0,100-d.c.h)
  }else{
   const min=8
   if(d.mode.includes('e'))c.w=clamp(d.c.w+dx,min,100-d.c.x)
   if(d.mode.includes('s'))c.h=clamp(d.c.h+dy,min,100-d.c.y)
   if(d.mode.includes('w')){const nx=clamp(d.c.x+dx,0,d.c.x+d.c.w-min);c.w=d.c.w+(d.c.x-nx);c.x=nx}
   if(d.mode.includes('n')){const ny=clamp(d.c.y+dy,0,d.c.y+d.c.h-min);c.h=d.c.h+(d.c.y-ny);c.y=ny}
  }
  setCrop(c)
 }
 function stop(){drag.current=null}

 async function useCrop(){
  if(!src)return
  setBusy(true)
  try{
   const img=new Image()
   await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=src})
   const sx=img.naturalWidth*crop.x/100,sy=img.naturalHeight*crop.y/100,sw=img.naturalWidth*crop.w/100,sh=img.naturalHeight*crop.h/100
   const canvas=document.createElement('canvas')
   canvas.width=Math.max(1,Math.round(sw));canvas.height=Math.max(1,Math.round(sh))
   canvas.getContext('2d').drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height)
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.92))
   if(!blob)throw new Error(t('validation.crop_failed','Could not create cropped image.'))
   onReady?.(blob,{...crop})
  }finally{setBusy(false)}
 }
 if(!src)return null
 const handle={position:'absolute',width:22,height:22,borderRadius:'50%',background:'#fff',border:'2px solid #111827',touchAction:'none'}
 return <div className="section">
  <div className="muted tiny">{t('crop.hint','Touch and drag the crop area or corner handles. Only the cropped staff copy is exposed to ordinary staff.')}</div>
  <div ref={box} style={{position:'relative',maxWidth:560,marginTop:10,userSelect:'none',touchAction:'none',overflow:'hidden',borderRadius:12,background:'#111827'}}>
   <img src={src} alt="Crop preview" style={{display:'block',width:'100%',height:'auto',pointerEvents:'none'}}/>
   <div onPointerDown={e=>start(e,'move')} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}
    style={{position:'absolute',left:crop.x+'%',top:crop.y+'%',width:crop.w+'%',height:crop.h+'%',border:'2px solid #fff',boxShadow:'0 0 0 9999px rgba(0,0,0,.45)',touchAction:'none'}}>
    {[
      ['nw',{left:-11,top:-11}],['ne',{right:-11,top:-11}],['sw',{left:-11,bottom:-11}],['se',{right:-11,bottom:-11}]
    ].map(([m,p])=><span key={m} onPointerDown={e=>{e.stopPropagation();start(e,m)}} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} style={{...handle,...p}}/>)}
   </div>
  </div>
  <button className="btn primary section" disabled={busy} onClick={useCrop}>{busy?t('crop.preparing','Preparing crop…'):t('crop.use','Use This Crop')}</button>
 </div>
}

export function CompanyLists({profile,fields,flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const canManage=can('company_lists.manage'),canCount=can('stock.count.enter')
 const[companies,setCompanies]=useState([]),[companyId,setCompanyId]=useState(''),[rows,setRows]=useState([]),[balances,setBalances]=useState({}),[entry,setEntry]=useState({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[search,setSearch]=useState('')
 const[newCompany,setNewCompany]=useState({code:'',name:''}),[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([]),[target,setTarget]=useState(''),[reorder,setReorder]=useState('')
 const startedAt=useRef(null)

 const loadCompanies=useCallback(async()=>{const r=await supabase.from('proc_companies').select('*').eq('active',true).eq('company_list_enabled',true).order('name');if(r.error)return fail(r.error);setCompanies(r.data||[]);if(!companyId&&r.data?.length)setCompanyId(r.data[0].id)},[companyId,fail])
 useEffect(()=>{loadCompanies()},[loadCompanies])

 const loadRows=useCallback(async()=>{if(!companyId){setRows([]);return}setLoading(true);try{
  const r=await supabase.from('proc_company_list_items').select('*,item:proc_items(id,item_code,description,size,uom,movement,category)').eq('company_id',companyId).eq('active',true).order('sort_order').order('created_at')
  if(r.error)throw r.error
  const list=r.data||[];setRows(list)
  const ids=list.map(x=>x.item_id)
  if(ids.length){const b=await supabase.from('proc_stock_balances').select('item_id,qty').in('item_id',ids);if(b.error)throw b.error;setBalances(Object.fromEntries((b.data||[]).map(x=>[x.item_id,Number(x.qty)])))}else setBalances({})
  const saved=localStorage.getItem('gh-company-count-'+companyId)
  if(saved)try{const p=JSON.parse(saved);setEntry(p.entry||{});startedAt.current=p.startedAt||null}catch{}
 }catch(e){fail(e)}finally{setLoading(false)}},[companyId,fail])
 useEffect(()=>{loadRows()},[loadRows])

 useEffect(()=>{
  if(!companyId)return
  const t=setTimeout(()=>localStorage.setItem('gh-company-count-'+companyId,JSON.stringify({entry,startedAt:startedAt.current})),200)
  return()=>clearTimeout(t)
 },[entry,companyId])

 useEffect(()=>{
  if(!canManage||itemSearch.trim().length<2){setItemResults([]);return}
  const t=setTimeout(async()=>{const term=itemSearch.trim();const r=await supabase.from('proc_items').select('id,item_code,description,size,uom,category').eq('active',true).or(containsAny(['description','item_code','size'],term)).order('description').limit(20);if(r.error)fail(r.error);else setItemResults(r.data||[])},180)
  return()=>clearTimeout(t)
 },[itemSearch,canManage,fail])

 function setCount(id,v){
  if(!startedAt.current)startedAt.current=new Date().toISOString()
  setEntry(x=>({...x,[id]:v}))
 }
 const shown=useMemo(()=>rows.filter(r=>(r.item?.description+' '+(r.item?.item_code||'')+' '+(r.item?.size||'')).toLowerCase().includes(search.toLowerCase())),[rows,search])
 const suggested=r=>{
  const v=entry[r.id];if(v===undefined||v==='')return null
  const n=Number(v),trigger=Number(r.reorder_level??r.target_stock)
  return Number.isFinite(n)&&n<=trigger?Math.max(Number(r.target_stock)-n,0):0
 }

 async function createCompany(){
  if(!newCompany.name.trim())return fail(new Error(t('company_lists.name_required','Company name is required.')))
  const code=newCompany.code.trim()||newCompany.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'')
  const r=await supabase.from('proc_companies').insert({company_code:code,name:newCompany.name.trim(),created_by:profile.id})
  if(r.error)return fail(r.error);flash('Company list created.');setNewCompany({code:'',name:''});loadCompanies()
 }
 async function addItem(item){
  if(!companyId)return
  const targetQty=Number(target),rr=reorder===''?null:Number(reorder)
  if(!Number.isFinite(targetQty)||targetQty<0)return fail(new Error(t('company_lists.target_error','Enter a valid target stock.')))
  if(rr!==null&&(!Number.isFinite(rr)||rr<0))return fail(new Error(t('company_lists.reorder_error','Enter a valid reorder level.')))
  const r=await supabase.from('proc_company_list_items').insert({company_id:companyId,item_id:item.id,target_stock:targetQty,reorder_level:rr,created_by:profile.id})
  if(r.error)return fail(r.error);flash(item.description+' added to company list.');setItemSearch('');setItemResults([]);setTarget('');setReorder('');loadRows()
 }
 async function updateCompanyLevel(r,key,value){
  if(!canManage)return
  const n=value===''&&key==='reorder_level'?null:Number(value)
  if(n!==null&&(!Number.isFinite(n)||n<0))return fail(new Error(t('company_lists.level_error','Stock levels must be zero or positive.')))
  const x=await supabase.from('proc_company_list_items').update({[key]:n,updated_at:new Date().toISOString()}).eq('id',r.id)
  if(x.error)fail(x.error);else{flash(key==='target_stock'?'Target stock updated.':'Reorder level updated.');loadRows()}
 }
 async function removeItem(r){
  if(!confirm(t('confirm.company_remove','Remove this item from the active company list?')))return
  const x=await supabase.from('proc_company_list_items').update({active:false,updated_at:new Date().toISOString()}).eq('id',r.id)
  if(x.error)fail(x.error);else{flash('Company-list item removed.');loadRows()}
 }
 async function submit(){
  if(!canCount)return
  const counted=rows.filter(r=>entry[r.id]!==undefined&&entry[r.id]!=='')
  if(!counted.length)return fail(new Error(t('company_lists.enter_one','Enter at least one stock quantity.')))
  if(counted.some(r=>!Number.isFinite(Number(entry[r.id]))||Number(entry[r.id])<0))return fail(new Error(t('company_lists.stock_error','Stock quantities must be zero or positive.')))
  if(!confirm(t('confirm.company_submit_prefix','Submit')+' '+counted.length+' '+t('confirm.company_submit_suffix','company-list count(s)? Shortages will go to Admin review, not directly to suppliers.')))return
  setBusy(true)
  try{
   const p=counted.map(r=>({company_list_item_id:r.id,current_stock:Number(entry[r.id])}))
   const x=await supabase.rpc('proc_submit_company_list_check_v1',{p_company_id:companyId,p_lines:p,p_notes:null,p_count_started_at:startedAt.current||new Date().toISOString()})
   if(x.error)throw x.error
   localStorage.removeItem('gh-company-count-'+companyId);setEntry({});startedAt.current=null
   flash(x.data.count_no+' submitted. '+(x.data.requirements_created||0)+' new shortage(s) sent for Admin review.');loadRows()
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 return <>
  <div className="card pad">
   <div className="sectionhead"><div><h3>{t('company_lists.title','Company Lists')}</h3><p>{t('company_lists.hint','Permanent company-specific stock lists. Staff only enter physical stock; shortages are calculated automatically and sent for approval.')}</p></div>{canCount&&<button className="btn primary" disabled={busy} onClick={submit}>{busy?t('stock.submitting','Submitting…'):t('company_lists.submit','Submit Count')}</button>}</div>
   <div className="filters two"><select className="select" value={companyId} onChange={e=>{setCompanyId(e.target.value);setEntry({});startedAt.current=null}}><option value="">{t('company_lists.select_company','Select company…')}</option>{companies.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><input className="input" placeholder={t('company_lists.search','Search this company list')} value={search} onChange={e=>setSearch(e.target.value)}/></div>
  </div>

  {canManage&&<div className="split section">
   <div className="card pad"><h3>{t('company_lists.create_company','Create Company')}</h3><div className="formgrid section"><div className="field"><label>{t('company_lists.company_code','Company code')}</label><input className="input" value={newCompany.code} onChange={e=>setNewCompany(x=>({...x,code:e.target.value}))}/></div><div className="field"><label>{t('company_lists.company_name','Company name')}</label><input className="input" value={newCompany.name} onChange={e=>setNewCompany(x=>({...x,name:e.target.value}))}/></div></div><button className="btn" onClick={createCompany}>{t('company_lists.create_company','Create Company')}</button></div>
   <div className="card pad"><h3>{t('company_lists.add_item','Add Item to Company List')}</h3><div className="formgrid section"><div className="field"><label>{t('company_lists.find_item','Find item')}</label><input className="input" value={itemSearch} onChange={e=>setItemSearch(e.target.value)} placeholder={t('company_lists.item_placeholder','Item, code or size')}/></div><div className="field"><label>{t('company_lists.target','Target stock')}</label><input className="input" inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)}/></div><div className="field"><label>{t('company_lists.reorder_optional','Reorder at (optional)')}</label><input className="input" inputMode="decimal" value={reorder} onChange={e=>setReorder(e.target.value)}/></div></div>
    {itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button className="btn record-button" key={i.id} onClick={()=>addItem(i)}><div><strong>{i.description}</strong><div className="muted tiny">{[i.item_code,i.size,i.uom,i.category].filter(Boolean).join(' · ')}</div></div><span>+ Add</span></button>)}</div>}
   </div>
  </div>}

  <div className="card pad section">{loading?<Empty>{t('company_lists.loading','Loading company list…')}</Empty>:!companyId?<Empty>{t('company_lists.select_prompt','Select a company.')}</Empty>:shown.length===0?<Empty>{t('company_lists.empty','No items in this company list.')}</Empty>:<>
   <div className="muted tiny">{shown.length} item(s) · entered quantities are saved locally until submission.</div>
   <div className="desktop-table tablewrap section"><table className="table"><thead><tr><th>Item</th><th>Target</th><th>Reorder</th><th>Book Stock</th><th>Current Stock</th><th>Suggested Order</th>{canManage&&<th/>}</tr></thead><tbody>{shown.map(r=><tr key={r.id}><td><strong>{r.item?.description}</strong><div className="muted tiny">{[r.item?.item_code,r.item?.size,r.item?.uom].filter(Boolean).join(' · ')}</div></td><td>{canManage?<input className="input stock-entry" inputMode="decimal" defaultValue={r.target_stock} onBlur={e=>updateCompanyLevel(r,'target_stock',e.target.value)}/>:qty(r.target_stock)}</td><td>{canManage?<input className="input stock-entry" inputMode="decimal" placeholder="Target" defaultValue={r.reorder_level??''} onBlur={e=>updateCompanyLevel(r,'reorder_level',e.target.value)}/>:qty(r.reorder_level??r.target_stock)}</td><td>{qty(balances[r.item_id]??0)}</td><td>{canCount?<input className="input stock-entry" inputMode="decimal" value={entry[r.id]??''} onChange={e=>setCount(r.id,e.target.value)}/>:qty(balances[r.item_id]??0)}</td><td><b className="warn-text">{suggested(r)===null?'—':qty(suggested(r))}</b></td>{canManage&&<td><button className="btn small" onClick={()=>removeItem(r)}>{t('company_lists.remove','Remove')}</button></td>}</tr>)}</tbody></table></div>
   <div className="mobile-card-list section">{shown.map(r=><div className="mobile-data-card" key={r.id}><div className="stock-card-title"><strong>{r.item?.description}</strong><Badge>{r.item?.movement}</Badge></div><div className="muted tiny">{[r.item?.item_code,r.item?.size,r.item?.uom].filter(Boolean).join(' · ')}</div><div className="stock-mobile-grid"><div><span>Target</span>{canManage?<input className="input" inputMode="decimal" defaultValue={r.target_stock} onBlur={e=>updateCompanyLevel(r,'target_stock',e.target.value)}/>:<b>{qty(r.target_stock)}</b>}</div><div><span>Reorder</span>{canManage?<input className="input" inputMode="decimal" placeholder="Target" defaultValue={r.reorder_level??''} onBlur={e=>updateCompanyLevel(r,'reorder_level',e.target.value)}/>:<b>{qty(r.reorder_level??r.target_stock)}</b>}</div><div><span>Book</span><b>{qty(balances[r.item_id]??0)}</b></div><div><span>Suggested</span><b className="warn-text">{suggested(r)===null?'—':qty(suggested(r))}</b></div>{canCount&&<div className="wide"><span>Current Stock</span><input className="input" inputMode="decimal" value={entry[r.id]??''} onChange={e=>setCount(r.id,e.target.value)}/></div>}</div>{canManage&&<button className="btn small section" onClick={()=>removeItem(r)}>{t('company_lists.remove','Remove')}</button>}</div>)}</div>
  </>}</div>
 </>
}

export function CompanyPriceLists({profile,fields,flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const isAdmin=can('admin.configure_app')
 const canUpload=can('price_lists.manage')
 const canImportItems=can('items.edit')
 const[companies,setCompanies]=useState([]),[companyId,setCompanyId]=useState(''),[lists,setLists]=useState([]),[active,setActive]=useState(null),[lines,setLines]=useState([]),[docs,setDocs]=useState([]),[search,setSearch]=useState('')
 const[form,setForm]=useState({title:'',effective_date:'',list_type:'mrp'}),[file,setFile]=useState(null),[cropped,setCropped]=useState(null),[cropMeta,setCropMeta]=useState(null),[safeForStaff,setSafeForStaff]=useState(true)
 const[busy,setBusy]=useState(false),[extracting,setExtracting]=useState(false),[extractProgress,setExtractProgress]=useState(null),[extractError,setExtractError]=useState('')
 const[draftRows,setDraftRows]=useState([]),[itemMeta,setItemMeta]=useState({categories:[],brands:[],mainGroups:[],subgroups:[],uoms:[]})
 const[namingTemplate,setNamingTemplate]=useState('{brand} {description} {size}')
 const[importDefaults,setImportDefaults]=useState({category:'GENERAL',brand:'',main_group:'',subgroup:'',uom:'',movement:'NORMAL',max_stock:'0',reorder_level:'0'})
 const[importFields,setImportFields]=useState({item_code:true,brand:true,main_group:true,subgroup:true,size:true,uom:true,movement:true,max_stock:true,reorder_level:true})
 const[addToCompanyList,setAddToCompanyList]=useState(true)
 const[line,setLine]=useState({external_code:'',description:'',size:'',uom:'',mrp:'',cost:'',discount_percent:'0',extra_discount_percent:'0',tax_percent:'0'})

 const listType=isAdmin?form.list_type:'mrp'
 const currentCompany=companies.find(x=>x.id===companyId)
 const staffMode=!isAdmin&&!canUpload

 const loadCompanies=useCallback(async()=>{
  const r=await supabase.from('proc_companies').select('*').eq('active',true).eq('price_list_enabled',true).order('name')
  if(r.error)return fail(r.error)
  const data=r.data||[]
  setCompanies(data)
  if(!companyId&&data.length)setCompanyId(data[0].id)
 },[companyId,fail])
 useEffect(()=>{loadCompanies()},[loadCompanies])

 useEffect(()=>{
  if(!canImportItems)return
  ;(async()=>{try{
   const r=await allRows(()=>supabase.from('proc_items').select('category,brand,main_group,subgroup,uom').eq('active',true).order('id'))
   if(r.error)throw r.error
   const uniq=k=>[...new Set((r.data||[]).map(x=>x[k]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)))
   setItemMeta({categories:uniq('category'),brands:uniq('brand'),mainGroups:uniq('main_group'),subgroups:uniq('subgroup'),uoms:uniq('uom')})
  }catch(e){fail(e)}})()
 },[canImportItems,fail])

 const openList=useCallback(async pl=>{
  setActive(pl)
  const[a,b]=await Promise.all([
   supabase.from('proc_company_price_list_lines').select('*').eq('price_list_id',pl.id).order('description'),
   supabase.from('proc_company_price_documents').select('*').eq('price_list_id',pl.id).order('created_at')
  ])
  if(a.error)return fail(a.error)
  if(b.error)return fail(b.error)
  setLines(a.data||[]);setDocs(b.data||[])
 },[fail])

 const loadLists=useCallback(async()=>{
  if(!companyId){setLists([]);setActive(null);setLines([]);setDocs([]);return}
  const r=await supabase.from('proc_company_price_lists').select('*').eq('company_id',companyId).order('created_at',{ascending:false})
  if(r.error)return fail(r.error)
  const data=r.data||[]
  setLists(data)
  const current=data.find(x=>x.is_current&&x.list_type==='mrp')||data[0]||null
  if(current)openList(current);else{setActive(null);setLines([]);setDocs([])}
 },[companyId,fail,openList])
 useEffect(()=>{loadLists()},[loadLists])

 useEffect(()=>{
  const brand=currentCompany?.name||''
  setImportDefaults(v=>({...v,brand:v.brand||brand}))
 },[currentCompany?.id])

 function resetDraft(){
  setDraftRows([]);setExtractError('');setExtractProgress(null)
 }
 function makeDraftRows(rows){
  const brand=currentCompany?.name||''
  return (rows||[]).slice(0,2500).map(r=>({
   ...r,
   _draftId:makeId(),
   _selected:true,
   price_description:r.description||'',
   import_name:r.description||'',
   brand,
   category:importDefaults.category||'GENERAL',
   main_group:importDefaults.main_group||'',
   subgroup:importDefaults.subgroup||'',
   movement:importDefaults.movement||'NORMAL',
   max_stock:importDefaults.max_stock||'0',
   reorder_level:importDefaults.reorder_level||'0',
   _importStatus:''
  }))
 }
 async function runExtraction(source,kind=listType){
  if(!source)return
  setExtracting(true);setExtractError('');setDraftRows([]);setExtractProgress({stage:'Starting OCR',progress:0})
  try{
   const result=await extractPriceListFile(source,kind,setExtractProgress)
   const rows=makeDraftRows(result.rows)
   setDraftRows(rows)
   flash(rows.length+' item row'+(rows.length===1?'':'s')+' detected. Review, edit, deselect or delete before saving/importing.')
  }catch(e){
   setExtractError(String(e?.message||e));fail(e)
  }finally{
   setExtracting(false);setExtractProgress(null)
  }
 }
 async function handleFileChange(e){
  const next=e.target.files?.[0]||null
  setFile(next);setCropped(null);setCropMeta(null);resetDraft()
  if(!next)return
  if(String(next.type||'').startsWith('image/'))return
  await runExtraction(next,listType)
 }
 async function handleCropReady(blob,meta){
  setCropped(blob);setCropMeta(meta)
  const src=new File([blob],'cropped-price-list.jpg',{type:'image/jpeg'})
  await runExtraction(src,listType)
 }
 function setDraft(id,key,value){setDraftRows(rows=>rows.map(r=>r._draftId===id?{...r,[key]:value}:r))}
 function deleteDraft(id){setDraftRows(rows=>rows.filter(r=>r._draftId!==id))}
 function selectedRows(){return draftRows.filter(r=>r._selected)}
 function selectAll(value){setDraftRows(rows=>rows.map(r=>({...r,_selected:value})))}
 function deleteSelected(){setDraftRows(rows=>rows.filter(r=>!r._selected))}
 function cleanJoined(parts){return parts.map(v=>String(v||'').trim()).filter(Boolean).join(' ').replace(/\s+/g,' ').trim()}
 function formatName(r){
  const tokens={
   brand:r.brand||'',
   description:r.price_description||'',
   size:r.size||'',
   code:r.external_code||'',
   category:r.category||''
  }
  return namingTemplate.replace(/\{(brand|description|size|code|category)\}/gi,(_,k)=>tokens[k.toLowerCase()]||'').replace(/\s+/g,' ').trim()
 }
 function applyNameFormat(){
  setDraftRows(rows=>rows.map(r=>r._selected?{...r,import_name:formatName(r)}:r))
 }
 function applyDefaults(){
  setDraftRows(rows=>rows.map(r=>r._selected?{
   ...r,
   category:importDefaults.category||r.category||'GENERAL',
   brand:importDefaults.brand||r.brand||'',
   main_group:importDefaults.main_group,
   subgroup:importDefaults.subgroup,
   uom:importDefaults.uom||r.uom||'PCS',
   movement:importDefaults.movement||'NORMAL',
   max_stock:importDefaults.max_stock===''?r.max_stock:importDefaults.max_stock,
   reorder_level:importDefaults.reorder_level===''?r.reorder_level:importDefaults.reorder_level
  }:r))
 }
 function toggleField(k){setImportFields(v=>({...v,[k]:!v[k]}))}

 function itemImportPayload(){
  return selectedRows().map(r=>({
   selected:true,
   item_code:importFields.item_code?(r.external_code||''):'',
   description:String(r.import_name||r.price_description||'').trim(),
   brand:importFields.brand?(r.brand||''):'',
   category:r.category||'GENERAL',
   main_group:importFields.main_group?(r.main_group||''):'',
   subgroup:importFields.subgroup?(r.subgroup||''):'',
   size:importFields.size?(r.size||''):'',
   uom:importFields.uom?(r.uom||'PCS'):'PCS',
   movement:importFields.movement?(r.movement||'NORMAL'):'NORMAL',
   max_stock:importFields.max_stock?(r.max_stock||0):0,
   reorder_level:importFields.reorder_level?(r.reorder_level||0):0
  }))
 }
 async function createSelectedItems(){
  if(!canImportItems)return
  const payload=itemImportPayload()
  if(!payload.length)return fail(new Error(t('validation.import_select','Select at least one extracted item.')))
  if(payload.some(x=>!x.description))return fail(new Error(t('validation.import_name','Every selected row needs an Item Name.')))
  if(payload.some(x=>!x.category))return fail(new Error(t('validation.import_category','Every selected row needs a Category.')))
  if(!confirm(t('confirm.import_prefix','Create/check')+' '+payload.length+' '+t('confirm.import_suffix','selected Item Master record(s)? Existing matches will be skipped automatically.')))return
  setBusy(true)
  try{
   const r=await supabase.rpc('proc_import_company_items_v1',{
    p_rows:payload,
    p_company_id:companyId||null,
    p_add_to_company_list:!!addToCompanyList
   })
   if(r.error)throw r.error
   const result=r.data||{}
   const statuses=result.results||[]
   setDraftRows(rows=>rows.map(row=>{
    if(!row._selected)return row
    const pos=selectedRows().findIndex(x=>x._draftId===row._draftId)
    const s=statuses.find(x=>Number(x.row_index)===pos+1)
    return s?{...row,_importStatus:s.status,_selected:false}:row
   }))
   flash((result.created||0)+' new item(s) created; '+(result.existing||0)+' existing item(s) skipped/matched.'+(result.company_list_linked?' '+result.company_list_linked+' linked to Company List.':''))
  }catch(e){fail(e)}finally{setBusy(false)}
 }

 async function viewDoc(d){
  const r=await supabase.storage.from('gh-procurement').createSignedUrl(d.storage_path,600)
  if(r.error)return fail(r.error)
  window.open(r.data.signedUrl,'_blank','noopener,noreferrer')
 }

 function priceRowsForSave(){
  return draftRows.map(r=>({
   external_code:r.external_code||null,
   description:String(r.price_description||'').trim(),
   size:r.size||null,uom:r.uom||null,
   mrp:r.mrp===''||r.mrp==null?null:Number(r.mrp),
   cost:listType==='cost'&&r.cost!==''&&r.cost!=null?Number(r.cost):null,
   discount_percent:listType==='cost'?Number(r.discount_percent||0):0,
   extra_discount_percent:listType==='cost'?Number(r.extra_discount_percent||0):0,
   tax_percent:listType==='cost'?Number(r.tax_percent||0):0,
   raw_line:r.raw_line||null,source_page:r.source_page||null,extraction_confidence:r.extraction_confidence||null,
   match_status:'unmatched'
  })).filter(r=>r.description)
 }

 async function savePriceList(){
  if(!canUpload||!companyId||!file)return fail(new Error(t('price_lists.choose_file','Choose a company and price-list file.')))
  if(extracting)return fail(new Error(t('price_lists.ocr_running','OCR is still running.')))
  const extracted=priceRowsForSave()
  if(!extracted.length)return fail(new Error(t('price_lists.no_products','No extracted products are ready. Retry OCR with a clearer crop.')))

  const title=form.title.trim()||cleanJoined([currentCompany?.name,form.effective_date||businessDate(),'Price List'])
  setBusy(true)
  const uploaded=[]
  let pl=null
  try{
   const ins=await supabase.from('proc_company_price_lists').insert({
    company_id:companyId,list_type:listType,title,effective_date:form.effective_date||null,
    status:profile.role==='document_assistant'?'pending_approval':'draft',
    extraction_status:'ready',submitted_by:profile.id
   }).select('*').single()
   if(ins.error)throw ins.error
   pl=ins.data

   const folder=listType==='cost'?'cost':'mrp',base='company-price-lists/'+companyId+'/'+folder+'/'+makeId()
   const originalPath=base+'-'+cleanName(file.name)
   const up=await supabase.storage.from('gh-procurement').upload(originalPath,file)
   if(up.error)throw up.error
   uploaded.push(originalPath)

   const isImage=String(file.type||'').startsWith('image/')
   const originalKind=listType==='cost'?'cost_original':(!isImage&&safeForStaff?'mrp_staff':'mrp_original')
   const doc=await supabase.from('proc_company_price_documents').insert({
    price_list_id:pl.id,document_kind:originalKind,storage_path:originalPath,file_name:file.name,mime_type:file.type,
    visible_to_staff:listType==='mrp'&&!isImage&&safeForStaff,created_by:profile.id
   })
   if(doc.error)throw doc.error

   if(cropped){
    const cropPath=base+'-crop.jpg'
    const cu=await supabase.storage.from('gh-procurement').upload(cropPath,cropped,{contentType:'image/jpeg'})
    if(cu.error)throw cu.error
    uploaded.push(cropPath)
    const cd=await supabase.from('proc_company_price_documents').insert({
     price_list_id:pl.id,
     document_kind:listType==='cost'?'cost_crop':'mrp_staff',
     storage_path:cropPath,file_name:'cropped-'+file.name+'.jpg',mime_type:'image/jpeg',
     visible_to_staff:listType==='mrp',crop_meta:cropMeta||{},created_by:profile.id
    })
    if(cd.error)throw cd.error
   }

   for(let i=0;i<extracted.length;i+=200){
    const rows=extracted.slice(i,i+200).map(r=>({...r,price_list_id:pl.id}))
    const rr=await supabase.from('proc_company_price_list_lines').insert(rows)
    if(rr.error)throw rr.error
   }
   if(listType==='mrp'){
    const m=await supabase.rpc('proc_match_company_price_list',{p_price_list_id:pl.id})
    if(m.error)throw m.error
   }
   flash(title+' saved with '+extracted.length+' extracted product row(s).')
   setForm({title:'',effective_date:'',list_type:'mrp'});setFile(null);setCropped(null);setCropMeta(null);setSafeForStaff(true);resetDraft()
   await loadLists()
  }catch(e){
   if(uploaded.length)await supabase.storage.from('gh-procurement').remove(uploaded)
   if(pl?.id)await supabase.from('proc_company_price_lists').delete().eq('id',pl.id)
   fail(e)
  }finally{setBusy(false)}
 }

 async function addLine(){
  if(!active||!canUpload)return
  if(!line.description.trim())return fail(new Error(t('validation.item_description','Item description is required.')))
  const payload={price_list_id:active.id,external_code:line.external_code||null,description:line.description.trim(),size:line.size||null,uom:line.uom||null,mrp:line.mrp===''?null:Number(line.mrp),cost:isAdmin&&active.list_type==='cost'&&line.cost!==''?Number(line.cost):null,discount_percent:isAdmin?Number(line.discount_percent||0):0,extra_discount_percent:isAdmin?Number(line.extra_discount_percent||0):0,tax_percent:isAdmin?Number(line.tax_percent||0):0,match_status:'unmatched'}
  const r=await supabase.from('proc_company_price_list_lines').insert(payload)
  if(r.error)return fail(r.error)
  setLine({external_code:'',description:'',size:'',uom:'',mrp:'',cost:'',discount_percent:'0',extra_discount_percent:'0',tax_percent:'0'})
  openList(active)
 }
 async function updateLine(row,key,value){
  if(!canUpload||active?.status==='approved')return
  let v=value
  if(['mrp','cost','discount_percent','extra_discount_percent','tax_percent'].includes(key)){
   if(value==='')v=key==='mrp'||key==='cost'?null:0
   else{v=Number(value);if(!Number.isFinite(v)||v<0)return fail(new Error(t('validation.nonnegative','Enter a valid non-negative number.')))}
   if(['discount_percent','extra_discount_percent','tax_percent'].includes(key)&&v>100)return fail(new Error(t('validation.percent','Percentages must be between 0 and 100.')))
  }else v=value===''?null:value
  const r=await supabase.from('proc_company_price_list_lines').update({[key]:v}).eq('id',row.id)
  if(r.error)return fail(r.error)
  setLines(x=>x.map(y=>y.id===row.id?{...y,[key]:v}:y))
 }
 async function ignoreLine(row){
  if(!canUpload||active?.status==='approved')return
  const r=await supabase.from('proc_company_price_list_lines').update({match_status:row.match_status==='ignored'?'unmatched':'ignored'}).eq('id',row.id)
  if(r.error)return fail(r.error)
  setLines(x=>x.map(y=>y.id===row.id?{...y,match_status:y.match_status==='ignored'?'unmatched':'ignored'}:y))
 }
 async function rematch(){
  if(!active||active.list_type!=='mrp'||!canUpload)return
  const r=await supabase.rpc('proc_match_company_price_list',{p_price_list_id:active.id})
  if(r.error)return fail(r.error)
  flash((r.data?.matched||0)+' row(s) matched to existing GH items.')
  openList(active)
 }
 async function populateCompanyList(){
  if(!isAdmin||!active||active.list_type!=='mrp')return
  if(active.status!=='approved')return fail(new Error(t('validation.approve_mrp','Approve the MRP price list before populating the permanent Company List.')))
  if(!confirm(t('confirm.populate_company','Populate the Company List from all reviewed non-ignored rows in this approved price list?')))return
  setBusy(true)
  const r=await supabase.rpc('proc_populate_company_list_from_price_list',{p_price_list_id:active.id})
  setBusy(false)
  if(r.error)return fail(r.error)
  flash('Company List updated: '+(r.data?.company_list_rows_processed||0)+' existing/matched item(s) linked.'+((r.data?.skipped_missing_items||0)?' '+r.data.skipped_missing_items+' missing item(s) were skipped — create them first through Item Master Import.':''))
  openList(active)
 }
 async function approve(){
  if(!isAdmin||!active)return
  if(!confirm(t('confirm.approve_price_prefix','Approve this price list and make it the current')+' '+active.list_type.toUpperCase()+' '+t('confirm.approve_price_suffix','list?')))return
  const r=await supabase.rpc('proc_approve_company_price_list',{p_price_list_id:active.id})
  if(r.error)return fail(r.error)
  flash('Price list approved and set as current.')
  loadLists()
 }

 const shown=lines.filter(x=>(x.description+' '+(x.external_code||'')+' '+(x.size||'')).toLowerCase().includes(search.toLowerCase()))
 const currentMrp=lists.find(x=>x.list_type==='mrp'&&x.is_current&&x.status==='approved')
 const visibleDocs=staffMode?docs.filter(d=>d.visible_to_staff&&d.document_kind==='mrp_staff'):docs
 const selectedCount=draftRows.filter(r=>r._selected).length
 const ocrSource=cropped?new File([cropped],'cropped-price-list.jpg',{type:'image/jpeg'}):file

 return <>
  <div className="card pad">
   <div className="sectionhead"><div><h3>{t('price_lists.title','Company Price Lists')}</h3><p>{staffMode?t('price_lists.staff_hint','Latest approved company MRP only. Confidential cost, discount and history are hidden.'):t('price_lists.admin_hint','Upload company price lists, extract products, optionally create Item Master records, then save/approve the document.')}</p></div></div>
   <div className="filters two"><select className="select" value={companyId} onChange={e=>{setCompanyId(e.target.value);setActive(null);resetDraft()}}><option value="">{t('company_lists.select_company','Select company…')}</option>{companies.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select><input className="input" placeholder={t('price_lists.search','Search saved price-list items')} value={search} onChange={e=>setSearch(e.target.value)}/></div>
  </div>

  {canUpload&&<div className="card pad section">
   <div className="sectionhead"><div><h3>Add Company Price List</h3><p>OCR runs before anything is saved. Review the extracted rows first.</p></div></div>
   <div className="formgrid">
    <div className="field"><label>Title (optional)</label><input className="input" value={form.title} onChange={e=>setForm(x=>({...x,title:e.target.value}))} placeholder="Auto-generated if blank"/></div>
    <div className="field"><label>Effective date</label><input className="input" type="date" value={form.effective_date} onChange={e=>setForm(x=>({...x,effective_date:e.target.value}))}/></div>
    {isAdmin&&<div className="field"><label>List type</label><select className="select" value={form.list_type} onChange={e=>{setForm(x=>({...x,list_type:e.target.value}));setCropped(null);setCropMeta(null);resetDraft()}}><option value="mrp">MRP / staff price list</option><option value="cost">Costing / discount list · Admin only</option></select></div>}
    <div className="field"><label>PDF or image</label><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={handleFileChange}/></div>
   </div>
   {listType==='mrp'&&file&&!String(file.type||'').startsWith('image/')&&<label className="choice-pill selected-choice section"><input type="checkbox" checked={safeForStaff} onChange={e=>setSafeForStaff(e.target.checked)}/>This PDF itself is safe for staff to view as MRP</label>}
   {file&&String(file.type||'').startsWith('image/')&&<ImageCropper file={file} onReady={handleCropReady} t={t}/>}
   {cropped&&<div className="success section">Crop prepared and OCR started automatically.</div>}
   {extracting&&<div className="notice section"><b>{extractProgress?.stage||'Reading price list…'}</b><div className="muted tiny">{Math.round(Number(extractProgress?.progress||0)*100)}%</div></div>}
   {extractError&&<div className="error section"><b>OCR needs another try.</b><div>{extractError}</div>{ocrSource&&<button className="btn section" onClick={()=>runExtraction(ocrSource,listType)}>Retry OCR</button>}</div>}
  </div>}

  {canUpload&&draftRows.length>0&&<div className="card pad section">
   <div className="sectionhead"><div><h3>OCR Review</h3><p>{draftRows.length} detected row(s). Select, edit or delete anything before saving.</p></div><div className="toolbar"><button className="btn small" onClick={()=>selectAll(true)}>Select All</button><button className="btn small" onClick={()=>selectAll(false)}>Select None</button><button className="btn small bad" disabled={!selectedCount} onClick={deleteSelected}>Delete Selected</button></div></div>
   <div className="desktop-table tablewrap section"><table className="table"><thead><tr><th/><th>Code</th><th>Supplier Item</th><th>Size</th><th>UOM</th><th>{listType==='cost'?'MRP':'MRP'}</th>{listType==='cost'&&<th>Cost</th>}<th/></tr></thead><tbody>{draftRows.map(r=><tr key={r._draftId}><td><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/></td><td><input className="input" value={r.external_code||''} onChange={e=>setDraft(r._draftId,'external_code',e.target.value)}/></td><td><input className="input" value={r.price_description||''} onChange={e=>{setDraft(r._draftId,'price_description',e.target.value);if(r.import_name===r.price_description)setDraft(r._draftId,'import_name',e.target.value)}}/></td><td><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></td><td><input className="input short-entry" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></td><td><input className="input stock-entry" inputMode="decimal" value={r.mrp??''} onChange={e=>setDraft(r._draftId,'mrp',e.target.value)}/></td>{listType==='cost'&&<td><input className="input stock-entry" inputMode="decimal" value={r.cost??''} onChange={e=>setDraft(r._draftId,'cost',e.target.value)}/></td>}<td><button className="btn small bad" onClick={()=>deleteDraft(r._draftId)}>Delete</button></td></tr>)}</tbody></table></div>
   <div className="mobile-card-list section">{draftRows.map(r=><div className="mobile-data-card" key={r._draftId}><div className="stock-card-title"><label className={'choice-pill '+(r._selected?'selected-choice':'')}><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/>Use</label><button className="btn small bad" onClick={()=>deleteDraft(r._draftId)}>Delete</button></div><div className="formgrid section"><div className="field"><label>Code</label><input className="input" value={r.external_code||''} onChange={e=>setDraft(r._draftId,'external_code',e.target.value)}/></div><div className="field"><label>Supplier Item</label><input className="input" value={r.price_description||''} onChange={e=>setDraft(r._draftId,'price_description',e.target.value)}/></div><div className="field"><label>Size</label><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></div><div className="field"><label>UOM</label><input className="input" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></div><div className="field"><label>MRP</label><input className="input" inputMode="decimal" value={r.mrp??''} onChange={e=>setDraft(r._draftId,'mrp',e.target.value)}/></div>{listType==='cost'&&<div className="field"><label>Cost</label><input className="input" inputMode="decimal" value={r.cost??''} onChange={e=>setDraft(r._draftId,'cost',e.target.value)}/></div>}</div></div>)}</div>
  </div>}

  {canImportItems&&draftRows.length>0&&<div className="card pad section">
   <div className="sectionhead"><div><h3>Item Master Import <span className="muted">(Optional)</span></h3><p>Use the extracted price list only as a source for missing company items. Existing items are detected and not duplicated.</p></div><button className="btn primary" disabled={busy||!selectedCount} onClick={createSelectedItems}>{busy?'Creating…':'Create Selected Items'}</button></div>

   <div className="notice"><b>Item Name Format</b><div className="muted tiny">Available placeholders: {'{brand}'} {'{description}'} {'{size}'} {'{code}'} {'{category}'}</div><div className="toolbar section"><input className="input" style={{minWidth:260}} value={namingTemplate} onChange={e=>setNamingTemplate(e.target.value)}/><button className="btn" onClick={applyNameFormat}>Apply Format to Selected</button></div></div>

   <div className="formgrid section">
    <div className="field"><label>Default Category</label><input className="input" list="proc-import-categories" value={importDefaults.category} onChange={e=>setImportDefaults(x=>({...x,category:e.target.value}))}/></div>
    <div className="field"><label>Default Brand</label><input className="input" list="proc-import-brands" value={importDefaults.brand} onChange={e=>setImportDefaults(x=>({...x,brand:e.target.value}))}/></div>
    <div className="field"><label>Main Group</label><input className="input" list="proc-import-main-groups" value={importDefaults.main_group} onChange={e=>setImportDefaults(x=>({...x,main_group:e.target.value}))}/></div>
    <div className="field"><label>Subgroup</label><input className="input" list="proc-import-subgroups" value={importDefaults.subgroup} onChange={e=>setImportDefaults(x=>({...x,subgroup:e.target.value}))}/></div>
    <div className="field"><label>Default UOM</label><input className="input" list="proc-import-uoms" value={importDefaults.uom} onChange={e=>setImportDefaults(x=>({...x,uom:e.target.value}))}/></div>
    <div className="field"><label>Movement</label><select className="select" value={importDefaults.movement} onChange={e=>setImportDefaults(x=>({...x,movement:e.target.value}))}><option>FAST</option><option>NORMAL</option><option>SLOW</option></select></div>
    <div className="field"><label>Max Stock</label><input className="input" inputMode="decimal" value={importDefaults.max_stock} onChange={e=>setImportDefaults(x=>({...x,max_stock:e.target.value}))}/></div>
    <div className="field"><label>Reorder Level</label><input className="input" inputMode="decimal" value={importDefaults.reorder_level} onChange={e=>setImportDefaults(x=>({...x,reorder_level:e.target.value}))}/></div>
   </div>
   <datalist id="proc-import-categories">{itemMeta.categories.map(x=><option key={x} value={x}/>)}</datalist>
   <datalist id="proc-import-brands">{itemMeta.brands.map(x=><option key={x} value={x}/>)}</datalist>
   <datalist id="proc-import-main-groups">{itemMeta.mainGroups.map(x=><option key={x} value={x}/>)}</datalist>
   <datalist id="proc-import-subgroups">{itemMeta.subgroups.map(x=><option key={x} value={x}/>)}</datalist>
   <datalist id="proc-import-uoms">{itemMeta.uoms.map(x=><option key={x} value={x}/>)}</datalist>
   <div className="toolbar section"><button className="btn" onClick={applyDefaults}>Apply Defaults to Selected</button><label className={'choice-pill '+(addToCompanyList?'selected-choice':'')}><input type="checkbox" checked={addToCompanyList} onChange={e=>setAddToCompanyList(e.target.checked)}/>Also add/match selected items to this Company List</label></div>

   <div className="section"><b>Fields to create</b><div className="pillrow section">{Object.entries({item_code:'Item Code',brand:'Brand',main_group:'Main Group',subgroup:'Subgroup',size:'Size',uom:'UOM',movement:'Movement',max_stock:'Max Stock',reorder_level:'Reorder Level'}).map(([k,label])=><label className={'choice-pill '+(importFields[k]?'selected-choice':'')} key={k}><input type="checkbox" checked={importFields[k]} onChange={()=>toggleField(k)}/>{label}</label>)}</div><div className="muted tiny">Item Name and Category are always required. Untick any optional field you do not want populated.</div></div>

   <div className="desktop-table tablewrap section"><table className="table"><thead><tr><th/><th>Item Name</th><th>Brand</th><th>Category</th><th>Main Group</th><th>Subgroup</th><th>Size</th><th>UOM</th><th>Movement</th><th>Max</th><th>Reorder</th><th>Status</th></tr></thead><tbody>{draftRows.map(r=><tr key={r._draftId}><td><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/></td><td><input className="input" value={r.import_name||''} onChange={e=>setDraft(r._draftId,'import_name',e.target.value)}/></td><td><input className="input" value={r.brand||''} onChange={e=>setDraft(r._draftId,'brand',e.target.value)}/></td><td><input className="input" value={r.category||''} onChange={e=>setDraft(r._draftId,'category',e.target.value)}/></td><td><input className="input" value={r.main_group||''} onChange={e=>setDraft(r._draftId,'main_group',e.target.value)}/></td><td><input className="input" value={r.subgroup||''} onChange={e=>setDraft(r._draftId,'subgroup',e.target.value)}/></td><td><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></td><td><input className="input short-entry" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></td><td><select className="select" value={r.movement||'NORMAL'} onChange={e=>setDraft(r._draftId,'movement',e.target.value)}><option>FAST</option><option>NORMAL</option><option>SLOW</option></select></td><td><input className="input stock-entry" inputMode="decimal" value={r.max_stock??'0'} onChange={e=>setDraft(r._draftId,'max_stock',e.target.value)}/></td><td><input className="input stock-entry" inputMode="decimal" value={r.reorder_level??'0'} onChange={e=>setDraft(r._draftId,'reorder_level',e.target.value)}/></td><td>{r._importStatus?<Badge>{r._importStatus}</Badge>:'—'}</td></tr>)}</tbody></table></div>
   <div className="mobile-card-list section">{draftRows.map(r=><div className="mobile-data-card" key={r._draftId}><div className="stock-card-title"><label className={'choice-pill '+(r._selected?'selected-choice':'')}><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/>Create</label>{r._importStatus&&<Badge>{r._importStatus}</Badge>}</div><div className="formgrid section"><div className="field wide"><label>Item Name</label><input className="input" value={r.import_name||''} onChange={e=>setDraft(r._draftId,'import_name',e.target.value)}/></div><div className="field"><label>Brand</label><input className="input" value={r.brand||''} onChange={e=>setDraft(r._draftId,'brand',e.target.value)}/></div><div className="field"><label>Category</label><input className="input" value={r.category||''} onChange={e=>setDraft(r._draftId,'category',e.target.value)}/></div><div className="field"><label>Main Group</label><input className="input" value={r.main_group||''} onChange={e=>setDraft(r._draftId,'main_group',e.target.value)}/></div><div className="field"><label>Subgroup</label><input className="input" value={r.subgroup||''} onChange={e=>setDraft(r._draftId,'subgroup',e.target.value)}/></div><div className="field"><label>Size</label><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></div><div className="field"><label>UOM</label><input className="input" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></div><div className="field"><label>Movement</label><select className="select" value={r.movement||'NORMAL'} onChange={e=>setDraft(r._draftId,'movement',e.target.value)}><option>FAST</option><option>NORMAL</option><option>SLOW</option></select></div><div className="field"><label>Max</label><input className="input" inputMode="decimal" value={r.max_stock??'0'} onChange={e=>setDraft(r._draftId,'max_stock',e.target.value)}/></div><div className="field"><label>Reorder</label><input className="input" inputMode="decimal" value={r.reorder_level??'0'} onChange={e=>setDraft(r._draftId,'reorder_level',e.target.value)}/></div></div></div>)}</div>
  </div>}

  {canUpload&&draftRows.length>0&&<div className="card pad section"><div className="sectionhead"><div><h3>Save Price List Document</h3><p>This is separate from Item Master import. You may create items, save the price list, do both, or only save the price list.</p></div><button className="btn primary" disabled={busy||extracting} onClick={savePriceList}>{busy?'Saving…':'Save Price List'}</button></div></div>}

  {isAdmin&&lists.length>0&&<div className="card pad section"><div className="sectionhead"><div><h3>{currentCompany?.name} · Price-list History</h3><p>Admin-only history. Ordinary staff cannot query older or costing records.</p></div></div><div className="stack">{lists.map(x=><button className={'btn record-button '+(active?.id===x.id?'active-record':'')} key={x.id} onClick={()=>openList(x)}><div><strong>{x.title}</strong><div className="muted tiny">{x.list_type.toUpperCase()} · {x.effective_date||'No effective date'}</div></div><div className="right"><Badge>{x.status}</Badge>{x.is_current&&<Badge>current</Badge>}</div></button>)}</div></div>}

  {!isAdmin&&currentMrp&&(!active||active.id!==currentMrp.id)&&<div className="section"><button className="btn" onClick={()=>openList(currentMrp)}>Open Latest MRP</button></div>}

  <div className="card pad section">{!active?<Empty>{companyId?'No saved/approved price list selected.':'Select a company.'}</Empty>:<>
   <div className="sectionhead"><div><h3>{active.title}</h3><p>{active.effective_date||'No effective date'}{!staffMode?' · '+active.list_type.toUpperCase():''}{!staffMode?' · extraction '+String(active.extraction_status||'not requested').replaceAll('_',' '):''}</p></div><div className="toolbar">{canUpload&&active.list_type==='mrp'&&active.status!=='approved'&&<button className="btn" onClick={rematch}>Re-match Items</button>}{isAdmin&&active.status!=='approved'&&<button className="btn good" onClick={approve}>Approve & Make Current</button>}{isAdmin&&active.status==='approved'&&active.list_type==='mrp'&&<button className="btn" disabled={busy} onClick={populateCompanyList}>Link Matched Items to Company List</button>}</div></div>
   {visibleDocs.length>0&&<div className="toolbar section">{visibleDocs.map(d=><button className="btn" key={d.id} onClick={()=>viewDoc(d)}>{staffMode?'View Latest MRP PDF/Image':d.document_kind.replaceAll('_',' ')}</button>)}</div>}
   {canUpload&&active.status!=='approved'&&<div className="section"><h4>Saved extracted rows</h4><div className="formgrid section"><div className="field"><label>Code</label><input className="input" value={line.external_code} onChange={e=>setLine(x=>({...x,external_code:e.target.value}))}/></div><div className="field"><label>Description</label><input className="input" value={line.description} onChange={e=>setLine(x=>({...x,description:e.target.value}))}/></div><div className="field"><label>Size</label><input className="input" value={line.size} onChange={e=>setLine(x=>({...x,size:e.target.value}))}/></div><div className="field"><label>UOM</label><input className="input" value={line.uom} onChange={e=>setLine(x=>({...x,uom:e.target.value}))}/></div><div className="field"><label>MRP</label><input className="input" inputMode="decimal" value={line.mrp} onChange={e=>setLine(x=>({...x,mrp:e.target.value}))}/></div>{isAdmin&&active.list_type==='cost'&&<><div className="field"><label>Cost</label><input className="input" inputMode="decimal" value={line.cost} onChange={e=>setLine(x=>({...x,cost:e.target.value}))}/></div><div className="field"><label>Discount %</label><input className="input" inputMode="decimal" value={line.discount_percent} onChange={e=>setLine(x=>({...x,discount_percent:e.target.value}))}/></div></>}</div><button className="btn section" onClick={addLine}>Add Review Row</button></div>}
   <DataTable mobileCards columns={[
    {key:'external_code',label:'Code',render:r=>canUpload&&active.status!=='approved'?<input className="input" defaultValue={r.external_code||''} onBlur={e=>updateLine(r,'external_code',e.target.value)}/>:r.external_code||'—'},
    {key:'description',label:fieldLabel(fields,'price_lists','description','Item'),render:r=>canUpload&&active.status!=='approved'?<input className="input" defaultValue={r.description||''} onBlur={e=>updateLine(r,'description',e.target.value)}/>:r.description},
    {key:'size',label:fieldLabel(fields,'price_lists','size','Size'),render:r=>r.size||'—'},
    {key:'uom',label:fieldLabel(fields,'price_lists','uom','UOM'),render:r=>r.uom||'—'},
    {key:'mrp',label:fieldLabel(fields,'price_lists','mrp','MRP'),render:r=>r.mrp===null||r.mrp===undefined?'—':money(r.mrp)},
    ...(!staffMode?[{key:'match_status',label:'Match',render:r=><Badge>{r.match_status}</Badge>}]:[]),
    ...(isAdmin&&active.list_type==='cost'?[{key:'cost',label:'Cost',render:r=>r.cost===null?'—':money(r.cost)},{key:'net_cost',label:'Net Cost',render:r=>r.net_cost===null?'—':money(r.net_cost)}]:[]),
    ...(canUpload&&active.status!=='approved'?[{key:'review_action',label:'Review',render:r=><button className="btn small" onClick={()=>ignoreLine(r)}>{r.match_status==='ignored'?'Restore':'Ignore'}</button>}]:[])
   ]} rows={shown}/>
  </>}</div>
 </>
}

