'use client'

import {ModernSelect} from './modern-select'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useDangerConfirmation,useActionConfirmation} from './danger-confirmation'
import {normalizeQuantityInput,isQuantityInput,normalizeQuantityDraft} from '@/lib/quantity-input.mjs'
import {allRows,containsAny} from '@/lib/query-pages'
import {indexStockItems,searchStockItems,isApproximateItemMatch} from '@/lib/stock-search.mjs'
import {searchWords} from '@/lib/fuzzy-item-search.mjs'
import {businessDate,money,qty} from '@/lib/helpers'
import {Badge,DataTable,Empty,fieldEnabled,fieldLabel,StockSubmitAction} from './ui'
import {extractPriceListFile} from '@/lib/price-list-extract'
import {QuickAddItem} from './quick-add-item'
import {CompanyListOcr} from './company-list-ocr'
import {hasFilterChoices} from '@/lib/select-options.mjs'
import {StockPrintDialog} from './stock-print-dialog'
import {CompanyControls,companyApi} from './company-controls'
import {CompanyContactDirectory} from './company-contact-directory'
import {CompanyWorkflowDirectory} from './company-workflow-directory'
import {WhatsAppAuditGroups} from './whatsapp-audit-groups'
import {reorderFor} from '@/lib/company-items.mjs'
import {CompanyItemDetails,CompanyRowLayoutControls} from './company-row-layout'
import {CompanySectionManager} from './company-section-manager'
import {CompanySectionRouteManager} from './company-section-route-manager'
import {CompanySubmissionResult} from './company-submission-result'
import {companySubmissionMessage} from '@/lib/company-submission-result.mjs'
import {sufficientStockOverrides,sufficientOverrideNotes} from '@/lib/stock-submission-outcome.mjs'
import {normalizeCompanyDisplay} from '@/lib/company-display.mjs'
import {companyLotRows,companyLotGroups} from '@/lib/company-stock-lot.mjs'
import {companySectionRows,sectionPaths} from '@/lib/company-section-tree.mjs'
import {companyRowStyle} from '@/lib/company-row-layout.mjs'
import {uppercaseItemText,normalizeItemText,uppercaseItemAttributes} from '@/lib/item-text.mjs'
import {loadCompanyStockCatalogue,loadCompanyStockMarkers} from '@/lib/company-stock-loading.mjs'
import {StockItemSubmissionHistory,StockHistoryLink} from './stock-item-submission-history'

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

export function CompanyLists({profile,company,fields,settings={},onConfigChanged=()=>{},flash,fail,can=()=>false,navigate=()=>{},active=true,countingOnly=false,canNavigate=()=>true,t=(k,f)=>f||k}){
 const confirmDanger=useDangerConfirmation()
 const confirmAction=useActionConfirmation()
 const canManage=can('company_lists.manage'),canCount=can('stock.count.enter')
 const[companies,setCompanies]=useState([]),[companyId,setCompanyId]=useState(''),[rows,setRows]=useState([]),[balances,setBalances]=useState({}),[entry,setEntry]=useState({}),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[search,setSearch]=useState('')
 const[itemSearch,setItemSearch]=useState(''),[itemResults,setItemResults]=useState([]),[target,setTarget]=useState(''),[reorder,setReorder]=useState('')
 const[category,setCategory]=useState(''),[subgroup,setSubgroup]=useState(''),[brand,setBrand]=useState(''),[sectionFilter,setSectionFilter]=useState(''),[collapsedSections,setCollapsedSections]=useState({}),[sufficient,setSufficient]=useState({}),[sections,setSections]=useState([])
 const[submissionResult,setSubmissionResult]=useState(null),[setupOpen,setSetupOpen]=useState(!countingOnly)
 const[companyReviewOpen,setCompanyReviewOpen]=useState(false),[companyHistoryOpen,setCompanyHistoryOpen]=useState(false)
 const[companyHistory,setCompanyHistory]=useState([]),[companyHistoryDetails,setCompanyHistoryDetails]=useState({}),[expandedHistoryId,setExpandedHistoryId]=useState(null)
 const[companyHistoryLoading,setCompanyHistoryLoading]=useState(false),[companyHistoryReady,setCompanyHistoryReady]=useState(false),[companyHistoryError,setCompanyHistoryError]=useState('')
 const[recentFinalized,setRecentFinalized]=useState({}),[companyRecounts,setCompanyRecounts]=useState(new Set())
 const[itemHistory,setItemHistory]=useState(null)
 const submitLock=useRef(false),historyRequest=useRef(0)
 const [directoryRevision,setDirectoryRevision]=useState(0)
 const [workflowReviewRequest,setWorkflowReviewRequest]=useState({companyId:null,sequence:0})
 const workflowPanelRef=useRef(null)
 const reviewedCompanyLot=useMemo(()=>companyLotRows(rows,entry,sufficient,recentFinalized,companyRecounts),[rows,entry,sufficient,recentFinalized,companyRecounts])
 const countedRows=reviewedCompanyLot.map(x=>x.row)
 const countTotal=reviewedCompanyLot.length
 const lotGroups=useMemo(()=>companyLotGroups(reviewedCompanyLot),[reviewedCompanyLot])
 const companyLotBlocked=reviewedCompanyLot.filter(x=>x.blocked)
 const oversizedCompanyLot=lotGroups.some(g=>g.count>1000)
 const resultRef=useRef(null)
 useEffect(()=>{if(submissionResult&&active)resultRef.current?.scrollIntoView({block:'start'})},[submissionResult,active])
 const startedAt=useRef(null),draftReady=useRef(''),loadSequence=useRef(0)
 const rowLoadController=useRef(null),loadedScope=useRef('')
 const[rowsError,setRowsError]=useState('')
 const allCompanies=companyId==='all'
 const selectedCompanyIds=useMemo(()=>companies.map(c=>c.id),[companies])
 const companyNames=useMemo(()=>new Map(companies.map(c=>[c.id,c.name])),[companies])
 const draftKey='gh-company-count-v2:'+profile.id+':'+companyId

 const loadCompanies=useCallback(async()=>{
  const r=await supabase.from('proc_companies').select('*').eq('active',true).eq('company_list_enabled',true).order('name')
  if(r.error)return fail(r.error)
  const data=r.data||[]
  // A refresh returning the same directory must not restart all catalogue/history requests.
  setCompanies(previous=>JSON.stringify(previous)===JSON.stringify(data)?previous:data)
  if(data.length){let saved='';try{saved=localStorage.getItem('gh-company-selection-v1:'+profile.id)||''}catch{}
   setCompanyId(previous=>previous||(saved==='all'||data.some(c=>c.id===saved)?saved:'all'))
  }
 },[profile.id,fail])
 const syncCompanySupplierPanels=useCallback(async()=>{await loadCompanies();setDirectoryRevision(v=>v+1)},[loadCompanies])
 useEffect(()=>{loadCompanies()},[loadCompanies])

 const loadRows=useCallback(async()=>{
  rowLoadController.current?.abort()
  const controller=new AbortController()
  rowLoadController.current=controller
  const timeout=setTimeout(()=>controller.abort(),20000)
  const request=++loadSequence.current
  if(!companyId){clearTimeout(timeout);setRows([]);setSections([]);setLoading(false);return}
  if(loadedScope.current!==companyId){setRows([]);setSections([])}
  setLoading(true);setRowsError('')
  try{
   const catalogue=await loadCompanyStockCatalogue(supabase,allCompanies?selectedCompanyIds:[companyId],controller.signal)
   if(request!==loadSequence.current||controller.signal.aborted)return
   setSections(catalogue.sections)
   setRows(catalogue.rows)
   loadedScope.current=companyId
   setBalances({})
   if(draftReady.current!==companyId){
    const saved=localStorage.getItem(draftKey)
    setEntry({});setSufficient({});startedAt.current=null
    if(saved)try{const p=JSON.parse(saved);setEntry(normalizeQuantityDraft(p.entry||{}));setSufficient(p.sufficient||{});startedAt.current=p.startedAt||null}catch{}
   }
   draftReady.current=companyId
  }catch(e){if(request===loadSequence.current)setRowsError(controller.signal.aborted?'Company list took too long to load. Please retry.':(e.message||'Company list could not be loaded.'))}
  finally{clearTimeout(timeout);if(request===loadSequence.current)setLoading(false)}
 },[companyId,draftKey,fail,allCompanies,selectedCompanyIds])
 useEffect(()=>{if(active)loadRows();return()=>{loadSequence.current++;rowLoadController.current?.abort()}},[active,loadRows])
 useEffect(()=>{
  if(!active)return
  let refreshedAt=0
  const refreshOnReturn=()=>{if(document.visibilityState==='visible'&&Date.now()-refreshedAt>1500){refreshedAt=Date.now();void loadRows()}}
  window.addEventListener('focus',refreshOnReturn)
  document.addEventListener('visibilitychange',refreshOnReturn)
  return()=>{window.removeEventListener('focus',refreshOnReturn);document.removeEventListener('visibilitychange',refreshOnReturn)}
 },[active,loadRows])

 useEffect(()=>{
  if(!companyId||draftReady.current!==companyId)return
  try{localStorage.setItem(draftKey,JSON.stringify({entry,sufficient,startedAt:startedAt.current}))}
  catch{fail(new Error('Draft could not be saved on this device. Keep this screen open and retry.'))}
 },[entry,sufficient,companyId])

 useEffect(()=>{
  if(!canManage||itemSearch.trim().length<2){setItemResults([]);return}
  const t=setTimeout(async()=>{const term=itemSearch.trim();const r=await supabase.from('proc_items').select('id,item_code,description,size,uom,category').eq('active',true).or(containsAny(['description','item_code','size'],term)).order('description').limit(20);if(r.error)fail(r.error);else setItemResults(r.data||[])},180)
  return()=>clearTimeout(t)
 },[itemSearch,canManage,fail])

 function setCount(id,v){
  const linked=rows.find(r=>r.id===id)
  if(linked&&recentFinalized[linked.company_id+'|'+linked.item_id]&&!companyRecounts.has(id))return
  const value=normalizeQuantityInput(v);if(value===null)return
  if(!startedAt.current)startedAt.current=new Date().toISOString()
  setEntry(x=>({...x,[id]:value}))
 }
 const categories=[...new Set(rows.map(r=>r.item?.category).filter(Boolean))].sort()
 const subcategories=[...new Set(rows.filter(r=>!category||r.item?.category===category).map(r=>r.item?.subgroup).filter(Boolean))].sort()
 const companySearchIndex=useMemo(()=>indexStockItems(rows.map(r=>({...r.item,item_id:r.id}))).map((indexed,i)=>{
  const name=String(companyNames.get(rows[i].company_id)||'')
  return {...indexed,searchText:indexed.searchText+' '+name.toLowerCase(),searchTokens:[...indexed.searchTokens,...searchWords(name)]}
 }),[rows,companyNames])
 const companyMatches=useMemo(()=>search.trim()?searchStockItems(companySearchIndex,search,{},Infinity):null,[companySearchIndex,search])
 const companyMatchIds=useMemo(()=>companyMatches?new Set(companyMatches.map(r=>r.item_id)):null,[companyMatches])
 const companyHasSuggestions=useMemo(()=>companyMatches?.some(r=>isApproximateItemMatch(r,search))||false,[companyMatches,search])
 const shown=useMemo(()=>rows.filter(r=>(!category||r.item?.category===category)&&(!subgroup||r.item?.subgroup===subgroup)&&(!brand||r.item?.brand===brand)&&(!companyMatchIds||companyMatchIds.has(r.id))),[rows,companyMatchIds,category,subgroup,brand])
 const currentCompany=companies.find(c=>c.id===companyId)
 const filterChoices={category:hasFilterChoices(rows,r=>r.item?.category,category),subgroup:hasFilterChoices(rows.filter(r=>!category||r.item?.category===category),r=>r.item?.subgroup,subgroup),brand:hasFilterChoices(rows,r=>r.item?.brand,brand),section:hasFilterChoices(rows,r=>r.section_id,sectionFilter)}
 const hasFilters=Object.values(filterChoices).some(Boolean)
 const display=useMemo(()=>normalizeCompanyDisplay(settings?.company_lists_display),[settings?.company_lists_display])
 const visibleFields=display.fields,rowLayout=display.row_layout
 const sectionLabels=useMemo(()=>sectionPaths(sections),[sections])
 const scoped=useMemo(()=>shown.filter(r=>!sectionFilter||r.section_id===sectionFilter||sectionLabels.get(r.section_id)?.startsWith((sectionLabels.get(sectionFilter)||'\u0000')+' /')),[shown,sectionFilter,sectionLabels])
 const tableEntries=useMemo(()=>allCompanies?companies.flatMap(c=>{const items=scoped.filter(r=>r.company_id===c.id);return items.length?[{type:'section',key:'company:'+c.id,title:c.name,depth:0,count:items.length,legacy:true},...companySectionRows(items,sections.filter(s=>s.company_id===c.id),collapsedSections,!!search.trim()).map(line=>({...line,key:c.id+':'+line.key}))]:[]}):companySectionRows(scoped,sections,collapsedSections,!!search.trim()),[scoped,sections,collapsedSections,search,allCompanies,companies])
 function setEnough(id,checked){const linked=rows.find(r=>r.id===id);if(linked&&recentFinalized[linked.company_id+'|'+linked.item_id]&&!companyRecounts.has(id))return;if(!startedAt.current)startedAt.current=new Date().toISOString();setSufficient(v=>({...v,[id]:checked}))}
 async function editItem(r,key,value){try{const x=await supabase.rpc('proc_company_edit_item',{p_list_id:r.id,p_patch:uppercaseItemAttributes({[key]:value})});if(x.error)throw x.error;await loadRows();flash('Company item updated.')}catch(e){fail(e)}}
 async function refreshCompany(){
  if(refreshing)return
  setRefreshing(true)
  try{
   if(canManage&&(profile.role_key||profile.role)==='admin'){
    try{const result=await companyApi('sheets',{action:'import'});if(result.errors?.length)flash('Some Google Sheet tabs need review in Company settings.')}
    catch(e){flash('Company database refreshed. Google Sheets sync unavailable; check Company settings.')}
   }
   await loadCompanies()
   await loadRows()
  }catch(e){fail(e)}finally{setRefreshing(false)}
 }

 async function archiveCompanyList(){
  if(!canManage||!companyId)return
  const company=companies.find(c=>c.id===companyId);if(!company)return
  await confirmDanger({title:'Remove company list',message:'Remove '+company.name+' from active Company Lists?',warning:'Existing count history and price lists remain available. This removes the list from stock-entry selection.',confirmation:company.company_code,confirmLabel:'Confirm remove list',onConfirm:async()=>{
   const r=await supabase.from('proc_companies').update({company_list_enabled:false,updated_at:new Date().toISOString()}).eq('id',companyId);if(r.error)throw r.error
   setCompanies(v=>v.filter(c=>c.id!==companyId));setCompanyId('');setRows([]);setEntry({});flash('Company list removed from active selection.')
  }})
 }
 async function createCompanyForQuickAdd({name,code}){
  if(!canManage)throw new Error('Company management permission required.')
  const nameValue=String(name||'').trim().replace(/\s+/g,' ')
  if(!nameValue)throw new Error('Company name is required.')
  const existing=companies.find(c=>c.name.trim().toLowerCase()===nameValue.toLowerCase())
  if(existing)return existing
  const generatedCode=nameValue.toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'')
  const r=await supabase.from('proc_companies').insert({company_code:String(code||'').trim()||generatedCode,name:nameValue,created_by:profile.id,company_list_enabled:true}).select('id,name,company_code').single()
  if(r.error)throw r.error
  setCompanies(v=>[...v,r.data].sort((a,b)=>a.name.localeCompare(b.name)))
  // Preserve the previous new-company Google Sheets publishing behavior without delaying item creation.
  void companyApi('sheets',{action:'publish',companyId:r.data.id}).catch(()=>flash('Company saved. Google Sheets tab awaits connection setup.'))
  return r.data
 }
 async function saveQuickCompanyItem(item,{companyId:targetCompanyId,maxStock}){
  if(!targetCompanyId||targetCompanyId==='all')throw new Error('Select a company to save this item.')
  const found=await supabase.from('proc_company_list_items').select('id,active').eq('company_id',targetCompanyId).eq('item_id',item.id).maybeSingle()
  if(found.error)throw found.error
  if(!found.data?.active){
   const record={company_id:targetCompanyId,item_id:item.id,target_stock:maxStock,reorder_level:reorderFor(maxStock),max_stock_review:false,active:true,updated_at:new Date().toISOString()}
   const result=found.data
    ?await supabase.from('proc_company_list_items').update(record).eq('id',found.data.id)
    :await supabase.from('proc_company_list_items').insert({...record,created_by:profile.id})
   if(result.error)throw result.error
  }
  setCompanyId(targetCompanyId);setCategory('');setSubgroup('');setSearch('')
  await loadCompanies()
  if(companyId===targetCompanyId)await loadRows()
  return found.data?.active?'Item already exists in this company list; no duplicate created.':'Item saved to the selected company list.'
 }
 async function addItem(item){
  if(!companyId)return
  const targetQty=target===''?0:Number(target),rr=reorderFor(target===''?null:targetQty)
  if(!Number.isFinite(targetQty)||targetQty<0)return fail(new Error(t('company_lists.target_error','Enter a valid target stock.')))
  if(rr!==null&&(!Number.isFinite(rr)||rr<0))return fail(new Error(t('company_lists.reorder_error','Enter a valid reorder level.')))
  const r=await supabase.from('proc_company_list_items').upsert({company_id:companyId,item_id:item.id,target_stock:targetQty,reorder_level:rr,max_stock_review:target==='',active:true,created_by:profile.id,updated_at:new Date().toISOString()},{onConflict:'company_id,item_id'})
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
  if(!canManage)return
  await confirmDanger({title:'Remove company-list item',message:'Remove '+(r.item?.description||'this item')+' from the active company list?',warning:'The item will leave this company list. Its Item Master record is retained.',confirmLabel:'Confirm remove item',onConfirm:async()=>{
   const x=await supabase.from('proc_company_list_items').update({active:false,updated_at:new Date().toISOString()}).eq('id',r.id)
   if(x.error)throw x.error;flash('Company-list item removed.');await loadRows()
  }})
 }

 const companyDateTime=v=>v?new Date(v).toLocaleString(undefined,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Colombo'}):'—'
 const companyMarker=r=>recentFinalized[r.company_id+'|'+r.item_id]
 async function allowCompanyRecount(r){
  const marker=companyMarker(r)
  if(!marker||companyRecounts.has(r.id))return true
  const accepted=await confirmAction((r.item?.description||'This item')+' was finalized under '+marker.count_no+' on '+companyDateTime(marker.submitted_at)+'. Recount it as part of a NEW company stock lot? The earlier count will remain in history.',{title:'Previously submitted · recount?',confirmLabel:'Allow recount'})
  if(accepted)setCompanyRecounts(previous=>new Set([...previous,r.id]))
  return accepted
 }
 function removeFromCompanyLot(id){
  setEntry(previous=>{const next={...previous};delete next[id];return next})
  setSufficient(previous=>{const next={...previous};delete next[id];return next})
 }
 function saveCompanyDraftNow(){
  try{
   localStorage.setItem(draftKey,JSON.stringify({entry,sufficient,startedAt:startedAt.current}))
   setCompanyReviewOpen(false)
   flash('Company stock draft saved. Continue counting later.')
  }catch(e){fail(new Error('Unable to save stock draft on this device. Keep this screen open.'))}
 }
 const loadCompanyHistory=useCallback(async()=>{
  const revision=++historyRequest.current
  setCompanyHistoryLoading(true);setCompanyHistoryReady(false);setCompanyHistoryError('')
  try{
   const [result,latest]=await Promise.all([
    supabase.rpc('proc_stock_submission_history_v1',{p_limit:100}),
    loadCompanyStockMarkers(supabase,rows)
   ])
   if(result.error)throw result.error
   const records=(result.data||[]).filter(h=>h.counted_by===profile.id&&String(h.category||'').startsWith('COMPANY: '))
   const owned=records.map(h=>({...h,company:companies.find(c=>c.name.trim().toLowerCase()===String(h.category).slice(9).trim().toLowerCase())})).filter(h=>h.company)
   if(revision!==historyRequest.current)return
   setCompanyHistory(owned)
   setCompanyHistoryDetails({})
   setRecentFinalized(latest)
   setCompanyHistoryReady(true)
  }catch(e){if(revision===historyRequest.current){setCompanyHistoryError('Could not verify previous company counts. Retry History before finalizing.');setCompanyHistoryReady(false);console.warn('Company count history unavailable',e)}}
  finally{if(revision===historyRequest.current)setCompanyHistoryLoading(false)}
 },[companies,profile.id,rows])
 useEffect(()=>{if(active&&companies.length)void loadCompanyHistory();return()=>{historyRequest.current++}},[active,loadCompanyHistory,companies.length])

 async function openCompanyHistoryRecord(id){
  if(expandedHistoryId===id){setExpandedHistoryId(null);return}
  setExpandedHistoryId(id)
  if(companyHistoryDetails[id])return
  try{const result=await supabase.rpc('proc_stock_submission_detail_v1',{p_count_id:id});if(result.error)throw result.error;setCompanyHistoryDetails(previous=>({...previous,[id]:result.data||[]}))}catch(e){fail(e)}
 }
 async function submit(){
  if(!canCount||busy||submitLock.current)return
  if(!companyHistoryReady)return fail(new Error('Recent company stock submissions have not been verified. Retry History before finalizing.'))
  if(companyLotBlocked.length)return fail(new Error('Previously submitted item(s) are included. Remove them or explicitly allow recount before finalizing.'))
  if(oversizedCompanyLot)return fail(new Error('A company has more than 1000 counted items. Each company lot must stay within the server limit.'))
  const counted=rows.filter(r=>sufficient[r.id]||(entry[r.id]!==undefined&&entry[r.id]!==''))
  if(!counted.length)return fail(new Error(t('company_lists.enter_one','Enter at least one stock quantity.')))
  if(counted.some(r=>!sufficient[r.id]&&!isQuantityInput(entry[r.id])))return fail(new Error(t('company_lists.stock_error','Stock quantities must be zero or positive.')))
  if(counted.some(r=>r.max_stock_review&&!sufficient[r.id]))return fail(new Error('An admin must enter the maximum stock for items marked Review before procurement.'))
  // The editable review is the only confirmation; retain all server-side route guards.
  if(!companyReviewOpen||companyHistoryOpen)return
  if(submitLock.current)return
  submitLock.current=true
  setBusy(true)
  try{
   const overrides=sufficientStockOverrides(entry,sufficient,counted.map(r=>({...r,item_id:r.id,reorder_level:r.reorder_level??reorderFor(r.target_stock)})))
   let overrideReason=''
   if(overrides.length&&!await confirmDanger({tone:'action',title:'Explain sufficient-stock override',message:overrides.length+' item(s) have an exact count at or below reorder but are marked sufficient.',requireReason:true,confirmLabel:'Record reason & submit',onConfirm:({reason})=>{overrideReason=reason}}))return
   const groups=allCompanies?companies.map(c=>({id:c.id,rows:counted.filter(r=>r.company_id===c.id)})).filter(g=>g.rows.length):[{id:companyId,rows:counted}]
   const results=[]
   let remainingEntry={...entry},remainingSufficient={...sufficient}
   for(const group of groups){
    const p=group.rows.map(r=>({company_list_item_id:r.id,current_stock:sufficient[r.id]?null:Number(entry[r.id]),sufficient_stock:!!sufficient[r.id]}))
    const submissionKey=draftKey+'-submission'+(allCompanies?':'+group.id:'')
    let submissionId=localStorage.getItem(submissionKey)
    if(!submissionId){submissionId=crypto.randomUUID();localStorage.setItem(submissionKey,submissionId)}
    const saved=await companyApi('submit',{submissionId,companyId:group.id,lines:p,notes:sufficientOverrideNotes(overrides.filter(item=>group.rows.some(row=>row.id===item.id)),overrideReason),startedAt:startedAt.current||new Date().toISOString()})
    results.push({...saved,company_id:group.id})
    localStorage.removeItem(submissionKey)
    for(const r of group.rows){delete remainingEntry[r.id];delete remainingSufficient[r.id]}
    setRecentFinalized(previous=>{const next={...previous};for(const row of group.rows)next[row.company_id+'|'+row.item_id]={count_id:saved.count_id,count_no:saved.count_no,submitted_at:new Date().toISOString(),quantity:sufficient[row.id]?null:Number(entry[row.id])};return next})
    localStorage.setItem(draftKey,JSON.stringify({entry:remainingEntry,sufficient:remainingSufficient,startedAt:startedAt.current}))
    setEntry({...remainingEntry});setSufficient({...remainingSufficient})
    setSubmissionResult({company_id:companyId,results:[...results]})
    flash(companySubmissionMessage(saved))
    if(saved.dispatch&&!saved.dispatch.ok)fail(new Error(saved.dispatch.error+' Stock saved. Review the order sending status before retrying.'))
    if(saved.rfqDispatch&&!saved.rfqDispatch.ok)fail(new Error(saved.rfqDispatch.error+' Stock saved. Review RFQ sending status before retrying.'))
    if(saved.automation_errors?.length)fail(new Error('Stock saved. Automatic requests need attention: '+saved.automation_errors.map(e=>e.error).join('; ')))
   }
   localStorage.removeItem(draftKey);startedAt.current=null
   setCompanyReviewOpen(false);setCompanyRecounts(new Set())
   await loadRows()
   void loadCompanyHistory()
  }catch(e){fail(e)}finally{setBusy(false);submitLock.current=false}
 }

 return <>

  {itemHistory&&<StockItemSubmissionHistory itemId={itemHistory.id} itemName={itemHistory.name} companyId={itemHistory.companyId} onClose={()=>setItemHistory(null)}/>}
  {companyReviewOpen&&<div className="modal-backdrop stock-lot-backdrop" role="presentation">
   <div className="modal card stock-lot-modal company-lot-modal" role="dialog" aria-modal="true" aria-label="Review company stock lot">
    <div className="modal-head"><div><h3>{companyHistoryOpen?'Company stock history':'Review company lot · '+countTotal+' items'}</h3><p className="muted tiny">Review once, then submit · drafts save automatically</p></div><button type="button" className="btn small" aria-label="Close review" onClick={()=>setCompanyReviewOpen(false)}>✕</button></div>
    <div className="stock-lot-actions" role="group" aria-label="Company stock lot actions">
     <button type="button" className="btn" onClick={saveCompanyDraftNow}>Save draft</button>
     <button type="button" className="btn" onClick={()=>{setCompanyHistoryOpen(x=>!x);if(!companyHistoryReady)void loadCompanyHistory()}}>{companyHistoryOpen?'Review':'History'}</button>
     <button type="button" className="btn primary" disabled={busy||loading||companyHistoryOpen||!companyHistoryReady||!countTotal||!!companyLotBlocked.length||oversizedCompanyLot} onClick={submit}>{busy?'Submitting…':'Submit · '+countTotal}</button>
    </div>
    {!companyHistoryReady&&<p className="notice" role="alert">{companyHistoryError||'Checking previous company counts…'} <button type="button" className="btn small" disabled={companyHistoryLoading} onClick={()=>void loadCompanyHistory()}>Retry</button></p>}
    {!companyHistoryOpen&&!!companyLotBlocked.length&&<p className="notice" role="alert">{companyLotBlocked.length} previously submitted item(s). Remove or explicitly choose Recount before final confirmation.</p>}
    {!companyHistoryOpen&&oversizedCompanyLot&&<p className="notice" role="alert">More than 1,000 items in one company. Final submission is blocked until the lot is safely split.</p>}
    {!companyHistoryOpen&&lotGroups.length>1&&<p className="muted tiny company-lot-group-hint">{lotGroups.length} company-specific lots will be processed separately. Successfully submitted company lots cannot be rolled back by later failures.</p>}
    {companyHistoryOpen?<div className="stock-lot-rows company-lot-history" aria-label="Past company stock submissions">
      {companyHistoryLoading?<p className="muted tiny">Loading submitted counts…</p>:!companyHistory.filter(h=>allCompanies||h.company.id===companyId).length?<p className="muted tiny">No recent submitted company counts found.</p>:companyHistory.filter(h=>allCompanies||h.company.id===companyId).map(h=><div key={h.count_id} className="company-lot-history-entry">
       <button type="button" className="company-history-trigger" onClick={()=>void openCompanyHistoryRecord(h.count_id)} aria-expanded={expandedHistoryId===h.count_id}><strong>{h.company.name} · {h.count_no}</strong><small>{companyDateTime(h.submitted_at)} · {h.item_count} items</small><span aria-hidden="true">{expandedHistoryId===h.count_id?'▴':'▾'}</span></button>
       {expandedHistoryId===h.count_id&&<div className="company-lot-history-lines">{!companyHistoryDetails[h.count_id]?<p className="muted tiny">Loading item details…</p>:companyHistoryDetails[h.count_id].map(line=><div key={line.line_id}><span>{line.description}{line.size?' · '+line.size:''}</span><b>{line.current_stock===null?'Enough':qty(line.current_stock)} {line.current_stock===null?'':line.uom||''}</b></div>)}</div>}
      </div>)}
     </div>:<div className="stock-lot-rows company-lot-review-rows" aria-label="Company stock items for review">
      {!countTotal?<p className="muted tiny">No company items counted yet. Save draft and return to counting.</p>:lotGroups.map(g=><div key={g.companyId}>
       <div className="company-lot-group-heading">{companyNames.get(g.companyId)||'Company'} <small>({g.count} items)</small></div>
       {g.lines.map(line=><div className="stock-lot-row" key={line.id}>
        <div className="stock-lot-item"><strong>{line.row.item?.description||line.row.item?.item_code||'Item'}{line.row.item?.size?' · '+line.row.item.size:''}</strong><small>{line.row.item?.uom||''}{line.previous?' · Submitted '+line.previous.count_no:''}</small></div>
        {line.blocked?<button className="btn small" onClick={()=>void allowCompanyRecount(line.row)}>Recount</button>:<><input aria-label={'Stock quantity for '+(line.row.item?.description||'company item')} className="input stock-lot-qty" inputMode="decimal" disabled={line.sufficient} value={line.sufficient?'':line.quantity??''} onChange={e=>setCount(line.id,e.target.value)}/><label className="stock-lot-enough"><input type="checkbox" checked={line.sufficient} onChange={e=>setEnough(line.id,e.target.checked)}/>Enough</label></>}
        <button type="button" className="btn small stock-lot-remove" onClick={()=>removeFromCompanyLot(line.id)}>Remove</button>
       </div>)}
      </div>)}
     </div>}
    <p className="muted tiny company-lot-footnote">Draft only until final confirmation. Company automatic RFQ/PO rules apply after finalization.</p>
   </div>
  </div>}
  <div className="company-stock-header">
   <div className="company-stock-title"><h3>{t('company_lists.title','Company Lists')}</h3><div className="company-title-actions"><button type="button" className="btn small" disabled={refreshing||loading} onClick={refreshCompany} aria-label="Refresh company items">{refreshing?'…':'↻'}</button>{canManage&&<button className="btn small" aria-label={setupOpen?'Back to stock':'Company setup'} onClick={()=>setSetupOpen(v=>!v)}>{setupOpen?'Back to stock':'Setup'}</button>}</div></div>
   <div className="company-stock-search"><ModernSelect aria-label="Company list" className="select" value={companyId} disabled={busy} onChange={e=>{setCompanyId(e.target.value);try{localStorage.setItem('gh-company-selection-v1:'+profile.id,e.target.value)}catch{};setCategory('');setSubgroup('');setBrand('');setSectionFilter('');setCollapsedSections({});setSearch('');setEntry({});startedAt.current=null}}><option value="all">All Companies</option>{companies.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</ModernSelect><input aria-label="Search company items" className="input" placeholder={allCompanies?'Search all companies and items (typos OK)':t('company_lists.search','Search company items (typos OK)')} value={search} onChange={e=>setSearch(uppercaseItemText(e.target.value))}/></div>
   {companyId&&hasFilters&&<details className="company-stock-filters"><summary>Filters{[category,subgroup,brand,sectionFilter].filter(Boolean).length>0?' · '+[category,subgroup,brand,sectionFilter].filter(Boolean).length+' active':''}</summary><div className="company-filter-grid">
    {filterChoices.category&&<label className="field">Category<select aria-label="Company list category" className="select" value={category} onChange={e=>{setCategory(e.target.value);setSubgroup('')}}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>}
    {filterChoices.subgroup&&<label className="field">Subcategory<select aria-label="Company list subcategory" className="select" value={subgroup} onChange={e=>setSubgroup(e.target.value)}><option value="">All subcategories</option>{subcategories.map(c=><option key={c}>{c}</option>)}</select></label>}
    {filterChoices.section&&<label className="field">Section<select aria-label="Company list section" className="select" value={sectionFilter} onChange={e=>setSectionFilter(e.target.value)}><option value="">All sections</option>{sections.map(s=><option key={s.id} value={s.id}>{sectionLabels.get(s.id)}</option>)}</select></label>}
    {filterChoices.brand&&<label className="field">Brand<select aria-label="Company brand" className="select" value={brand} onChange={e=>setBrand(e.target.value)}><option value="">All brands</option>{[...new Set(rows.map(r=>r.item?.brand).filter(Boolean))].map(b=><option key={b}>{b}</option>)}</select></label>}
   </div><button className="btn small" onClick={()=>{setCategory('');setSubgroup('');setBrand('');setSectionFilter('')}}>Clear filters</button></details>}
  </div>
  <div ref={resultRef}>{submissionResult?.company_id===companyId&&(submissionResult.results||[submissionResult]).map(result=><div key={result.company_id}>{allCompanies&&<strong>{companyNames.get(result.company_id)}</strong>}<CompanySubmissionResult result={result} navigate={navigate} canNavigate={canNavigate} onContinueCounting={()=>setSubmissionResult(null)}/></div>)}</div>
  {setupOpen&&<div className="company-setup-panel" aria-label="Company setup">
  {canManage&&<CompanyContactDirectory companies={companies} can={can} active={active} flash={flash} fail={fail} onDirectoryChanged={()=>setDirectoryRevision(v=>v+1)} onReviewRouting={id=>{setWorkflowReviewRequest(v=>({companyId:id,sequence:v.sequence+1}));const panel=workflowPanelRef.current;if(panel){panel.open=true;panel.scrollIntoView({behavior:'smooth',block:'start'})}}}/>}
  {canManage&&<details ref={workflowPanelRef} className="card pad section company-workflow-hub" aria-label="RFQ and PO workflow settings">
    <summary><strong>RFQ &amp; PO Workflow Settings</strong></summary>
    <CompanyWorkflowDirectory companies={companies} can={can} active={active} flash={flash} fail={fail} embedded directoryRevision={directoryRevision} reviewRequest={workflowReviewRequest} onRoutesChanged={syncCompanySupplierPanels}/>
    {companyId&&!allCompanies&&<details className="section" aria-label="Advanced group sending and templates">
      <summary>Advanced document templates &amp; approved sending</summary>
      <p className="muted tiny">Edit outgoing RFQ/PO images and captions, or prepare and send documents for approved outstanding shortages. Supplier assignments, recipients and automatic-send rules are managed only in the checklist above.</p>
      <CompanySectionRouteManager company={currentCompany} sections={sections} rows={rows} profile={profile} can={can} flash={flash} fail={fail} navigate={navigate} onChanged={syncCompanySupplierPanels} directoryRevision={directoryRevision} toolsOnly/>
    </details>}
  </details>}
  {canManage&&<WhatsAppAuditGroups/>}
  {(profile.role_key||profile.role)==='admin'&&can('admin.configure_app')&&<CompanyRowLayoutControls value={settings?.company_lists_display} flash={flash} fail={fail} onSaved={()=>onConfigChanged()}/>}
  {allCompanies&&<p className="muted">Select an individual company to manage its suppliers, automation and items.</p>}
  </div>}
  {!setupOpen&&rowsError&&<div className="card pad section" role="alert">{rowsError} <button type="button" className="btn small" onClick={()=>void loadRows()}>Retry company list</button></div>}
  {!setupOpen&&loading&&rows.length>0&&<p className="muted tiny" role="status">Refreshing company list…</p>}
  {!setupOpen&&<div className="card pad section company-count-workspace" aria-busy={loading}>{loading&&!rows.length?<Empty>{t('company_lists.loading','Loading company list…')}</Empty>:!companyId?<Empty>{t('company_lists.select_prompt','Select a company.')}</Empty>:scoped.length===0?<Empty>{search.trim()?'No matching items. Try another spelling or size.':t('company_lists.empty','No items in this company list.')}</Empty>:<>
   <div className="muted tiny">{scoped.length} item(s) · {countTotal} in saved draft · review before final submission.{companyHasSuggestions?' Possible spelling matches included — confirm item and size.':''}</div>
   <div className="tablewrap section company-items-grid" style={companyRowStyle(rowLayout)}><table className="table">
    <colgroup><col/><col className="company-current-col"/><col className="company-sufficient-col"/></colgroup>
    <thead><tr><th>Item / description</th><th>Stock</th><th>Enough</th></tr></thead>
    <tbody>{tableEntries.map(line=>line.type==='section'
      ?<tr key={'section:'+line.key} className={'company-category-row company-nested-section '+(line.legacy?'company-legacy-section':'')} style={{'--company-section-color':line.color||display.sectionColors[Math.min(line.depth,display.sectionColors.length-1)],'--company-section-depth':Math.min(line.depth,12)}}><th colSpan={3}>{line.legacy?<span>{line.title} <small>({line.count})</small></span>:<button type="button" className="company-section-toggle" aria-label={'Toggle '+line.title} aria-expanded={!collapsedSections[line.id]} onClick={()=>setCollapsedSections(v=>({...v,[line.id]:!v[line.id]}))}><span aria-hidden="true">{collapsedSections[line.id]?'▸':'▾'}</span> {line.title} <small>({line.count})</small></button>}</th></tr>
      :(()=>{const r=line.row;const last=companyMarker(r);const alreadyFinalized=!!last&&!companyRecounts.has(r.id);return <tr key={line.key} className={'company-stock-item-row '+(r.max_stock_review?'company-review-row ':'')+(alreadyFinalized?'company-stock-finalized':'')}>
     <td>{allCompanies&&<small className="muted">{companyNames.get(r.company_id)}</small>}<CompanyItemDetails row={r} visibleFields={visibleFields} layout={rowLayout}/>
      {last&&<StockHistoryLink itemName={r.item?.description||r.item?.item_code||'Company item'} recounting={!alreadyFinalized} onClick={()=>setItemHistory({id:r.item_id,companyId:r.company_id,name:r.item?.description||r.item?.item_code||'Company item'})}/>}
      {r.max_stock_review&&<small>Maximum stock needs admin review</small>}
      {canManage&&<details className="company-item-edit"><summary>Edit</summary><div className="company-item-edit-fields">
       <label>Item / description<input aria-label="Company item description" className="input item-uppercase" defaultValue={uppercaseItemText(r.item?.description)} onBlur={e=>{if(normalizeItemText(e.target.value)!==normalizeItemText(r.item?.description))editItem(r,'description',e.target.value)}}/></label>
       <label>Maximum stock<input key={String(r.target_stock)+r.max_stock_review} aria-label="Company maximum stock" className="input" inputMode="decimal" placeholder="Review" defaultValue={r.max_stock_review?'':r.target_stock} onBlur={e=>{if(e.target.value!==String(r.max_stock_review?'':r.target_stock))editItem(r,'target_stock',e.target.value)}}/></label>
       {['size','colour','variation','brand','category','subgroup','uom','remarks'].filter(k=>visibleFields[k]!==false).map(k=><label key={k}>{k}<input aria-label={'Company item '+k} className="input item-uppercase" defaultValue={uppercaseItemText(r.item?.[k]||'')} onBlur={e=>{if(normalizeItemText(e.target.value)!==normalizeItemText(r.item?.[k]))editItem(r,k,e.target.value)}}/></label>)}
       <button className="btn small" onClick={()=>removeItem(r)}>Remove</button>
      </div></details>}
     </td>
     <td>{!canCount?'—':alreadyFinalized?<button className="btn small company-recount-btn" type="button" onClick={()=>void allowCompanyRecount(r)}>Recount</button>:<input aria-label={'Current stock: '+r.item?.description} className="input stock-entry" inputMode="decimal" disabled={!!sufficient[r.id]} value={sufficient[r.id]?'':entry[r.id]??''} onChange={e=>setCount(r.id,e.target.value)}/>}</td>
     <td><input aria-label={'Sufficient stock: '+r.item?.description} type="checkbox" disabled={!canCount||alreadyFinalized} checked={!!sufficient[r.id]} onChange={e=>setEnough(r.id,e.target.checked)}/></td>
    </tr>})())}</tbody>
   </table></div>
  </>}</div>}
  {setupOpen&&<>
  {companyId&&!allCompanies&&<details className="company-stock-tools section"><summary>Print &amp; list tools</summary><div className="company-tools-content">
  {companyId&&<StockPrintDialog profile={profile} company={company} companyName={companies.find(c=>c.id===companyId)?.name||''} companySections={sections} companyItems={rows.map(r=>({...r.item,section_id:r.section_id,description:[r.item?.description,r.item?.brand,r.item?.colour,r.item?.variation].filter(Boolean).join(' · '),id:r.item_id,max_stock:r.max_stock_review?'':r.target_stock,reorder_level:r.max_stock_review?'':r.reorder_level??reorderFor(r.target_stock)}))} can={can} fail={fail}/>}
  <button className="btn small" onClick={()=>navigate('requirements','to_order')}>Review company shortages →</button>
  <CompanyListOcr companyId={companyId} companyName={currentCompany?.name||''} can={can} profile={profile} fail={fail} flash={flash} onImported={loadRows}/>
  {canManage&&<button className="btn small bad" onClick={archiveCompanyList}>Remove company list</button>}
  </div></details>}
  {canManage&&companyId&&!allCompanies&&<CompanySectionManager company={currentCompany} sections={sections} rows={rows} flash={flash} fail={fail} onChanged={loadRows} superAdmin={(profile.role_key||profile.role)==='admin'}/>}
  {companyId&&!allCompanies&&<CompanyControls company={currentCompany} rows={rows} can={can} flash={flash} fail={fail} onChanged={()=>{loadCompanies();loadRows()}}/>}
  {canManage&&<div className="card pad section" aria-label="Company item quick create">
   <h3>Company item management</h3>
   <QuickAddItem mode="company" can={can} fail={fail} flash={flash} companies={companies} selectedCompanyId={allCompanies?'':companyId} onCreateCompany={createCompanyForQuickAdd} onCreated={saveQuickCompanyItem}/>
   {!allCompanies&&<details className="section"><summary>Add an existing item to this company</summary>
    <div className="formgrid section"><label className="field">Find item<input className="input" value={itemSearch} onChange={e=>setItemSearch(uppercaseItemText(e.target.value))} placeholder="Item, code or size"/></label>
     <label className="field">Maximum stock<input className="input" inputMode="decimal" value={target} onChange={e=>setTarget(e.target.value)}/></label>
     <label className="field">Reorder · 50%<input className="input" readOnly value={target===''?'':reorderFor(target)}/></label>
    </div>
    {itemResults.length>0&&<div className="stack section">{itemResults.map(i=><button type="button" className="btn record-button" key={i.id} onClick={()=>addItem(i)}><div><strong>{uppercaseItemText(i.description)}</strong><div className="muted tiny">{uppercaseItemText([i.item_code,i.size,i.uom,i.category].filter(Boolean).join(' · '))}</div></div><span>+ Add</span></button>)}</div>}
   </details>}
  </div>}
  </>}
  {!setupOpen&&canCount&&companyId&&active&&<StockSubmitAction active={active}><div className="task-dock company-count-dock" role="region" aria-label="Company count actions">
   <div className="count-dock-summary" role="status"><strong>{countTotal} of {rows.length} counted</strong><small>{search||category||subgroup||brand||sectionFilter?'Includes counted items outside filters':'Zero counts as entered · blank items are skipped'}</small></div>
   <button className="btn primary" aria-label={'Review company stock lot with '+countTotal+' items'} disabled={busy||loading} onClick={()=>{setCompanyHistoryOpen(false);setCompanyReviewOpen(true)}}><span className="stock-submit-full">Review &amp; submit · {countTotal}</span><span className="stock-submit-compact" aria-hidden="true">Submit · {countTotal}</span></button>
  </div></StockSubmitAction>}
 </>
}

export function CompanyPriceLists({profile,fields,flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const confirmAction=useActionConfirmation()
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
   price_description:uppercaseItemText(r.description||''),
   import_name:uppercaseItemText(r.description||''),
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
 function setDraft(id,key,value){const next=['price_description','import_name','brand','category','main_group','subgroup','size','uom'].includes(key)?uppercaseItemText(value):value;setDraftRows(rows=>rows.map(r=>r._draftId===id?{...r,[key]:next}:r))}
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
  return uppercaseItemText(namingTemplate.replace(/\{(brand|description|size|code|category)\}/gi,(_,k)=>tokens[k.toLowerCase()]||'').replace(/\s+/g,' ').trim())
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
  return selectedRows().map(r=>uppercaseItemAttributes({
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
  if(!await confirmAction(t('confirm.import_prefix','Create/check')+' '+payload.length+' '+t('confirm.import_suffix','selected Item Master record(s)? Existing matches will be skipped automatically.')))return
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
  const payload={price_list_id:active.id,external_code:line.external_code||null,description:normalizeItemText(line.description),size:line.size?normalizeItemText(line.size):null,uom:line.uom?normalizeItemText(line.uom):null,mrp:line.mrp===''?null:Number(line.mrp),cost:isAdmin&&active.list_type==='cost'&&line.cost!==''?Number(line.cost):null,discount_percent:isAdmin?Number(line.discount_percent||0):0,extra_discount_percent:isAdmin?Number(line.extra_discount_percent||0):0,tax_percent:isAdmin?Number(line.tax_percent||0):0,match_status:'unmatched'}
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
  }else v=value===''?null:['description','size','uom'].includes(key)?normalizeItemText(value):value
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
  if(!await confirmAction(t('confirm.populate_company','Populate the Company List from all reviewed non-ignored rows in this approved price list?')))return
  setBusy(true)
  const r=await supabase.rpc('proc_populate_company_list_from_price_list',{p_price_list_id:active.id})
  setBusy(false)
  if(r.error)return fail(r.error)
  flash('Company List updated: '+(r.data?.company_list_rows_processed||0)+' existing/matched item(s) linked.'+((r.data?.skipped_missing_items||0)?' '+r.data.skipped_missing_items+' missing item(s) were skipped — create them first through Item Master Import.':''))
  openList(active)
 }
 async function approve(){
  if(!isAdmin||!active)return
  if(!await confirmAction(t('confirm.approve_price_prefix','Approve this price list and make it the current')+' '+active.list_type.toUpperCase()+' '+t('confirm.approve_price_suffix','list?')))return
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
   <div className="filters two"><ModernSelect className="select" value={companyId} onChange={e=>{setCompanyId(e.target.value);setActive(null);resetDraft()}}><option value="">{t('company_lists.select_company','Select company…')}</option>{companies.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</ModernSelect><input className="input" placeholder={t('price_lists.search','Search saved price-list items')} value={search} onChange={e=>setSearch(uppercaseItemText(e.target.value))}/></div>
  </div>

  {canUpload&&<div className="card pad section">
   <div className="sectionhead"><div><h3>Add Company Price List</h3><p>OCR runs before anything is saved. Review the extracted rows first.</p></div></div>
   <div className="formgrid">
    <div className="field"><label>Title (optional)</label><input className="input" value={form.title} onChange={e=>setForm(x=>({...x,title:e.target.value}))} placeholder="Auto-generated if blank"/></div>
    <div className="field"><label>Effective date</label><input className="input" type="date" value={form.effective_date} onChange={e=>setForm(x=>({...x,effective_date:e.target.value}))}/></div>
    {isAdmin&&<div className="field"><label>List type</label><ModernSelect className="select" value={form.list_type} onChange={e=>{setForm(x=>({...x,list_type:e.target.value}));setCropped(null);setCropMeta(null);resetDraft()}}><option value="mrp">MRP / staff price list</option><option value="cost">Costing / discount list · Admin only</option></ModernSelect></div>}
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
   <div className="mobile-card-list section">{draftRows.map(r=><div className="procurement-data-row" key={r._draftId}><div className="stock-card-title"><label className={'choice-pill '+(r._selected?'selected-choice':'')}><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/>Use</label><button className="btn small bad" onClick={()=>deleteDraft(r._draftId)}>Delete</button></div><div className="formgrid section"><div className="field"><label>Code</label><input className="input" value={r.external_code||''} onChange={e=>setDraft(r._draftId,'external_code',e.target.value)}/></div><div className="field"><label>Supplier Item</label><input className="input" value={r.price_description||''} onChange={e=>setDraft(r._draftId,'price_description',e.target.value)}/></div><div className="field"><label>Size</label><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></div><div className="field"><label>UOM</label><input className="input" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></div><div className="field"><label>MRP</label><input className="input" inputMode="decimal" value={r.mrp??''} onChange={e=>setDraft(r._draftId,'mrp',e.target.value)}/></div>{listType==='cost'&&<div className="field"><label>Cost</label><input className="input" inputMode="decimal" value={r.cost??''} onChange={e=>setDraft(r._draftId,'cost',e.target.value)}/></div>}</div></div>)}</div>
  </div>}

  {canImportItems&&draftRows.length>0&&<div className="card pad section">
   <div className="sectionhead"><div><h3>Item Master Import <span className="muted">(Optional)</span></h3><p>Use the extracted price list only as a source for missing company items. Existing items are detected and not duplicated.</p></div><button className="btn primary" disabled={busy||!selectedCount} onClick={createSelectedItems}>{busy?'Creating…':'Create Selected Items'}</button></div>

   <div className="notice"><b>Item Name Format</b><div className="muted tiny">Available placeholders: {'{brand}'} {'{description}'} {'{size}'} {'{code}'} {'{category}'}</div><div className="toolbar section"><input className="input" style={{minWidth:260}} value={namingTemplate} onChange={e=>setNamingTemplate(e.target.value)}/><button className="btn" onClick={applyNameFormat}>Apply Format to Selected</button></div></div>

   <div className="formgrid section">
    <div className="field"><label>Default Category</label><input className="input" list="proc-import-categories" value={importDefaults.category} onChange={e=>setImportDefaults(x=>({...x,category:uppercaseItemText(e.target.value)}))}/></div>
    <div className="field"><label>Default Brand</label><input className="input" list="proc-import-brands" value={importDefaults.brand} onChange={e=>setImportDefaults(x=>({...x,brand:uppercaseItemText(e.target.value)}))}/></div>
    <div className="field"><label>Main Group</label><input className="input" list="proc-import-main-groups" value={importDefaults.main_group} onChange={e=>setImportDefaults(x=>({...x,main_group:uppercaseItemText(e.target.value)}))}/></div>
    <div className="field"><label>Subgroup</label><input className="input" list="proc-import-subgroups" value={importDefaults.subgroup} onChange={e=>setImportDefaults(x=>({...x,subgroup:uppercaseItemText(e.target.value)}))}/></div>
    <div className="field"><label>Default UOM</label><input className="input" list="proc-import-uoms" value={importDefaults.uom} onChange={e=>setImportDefaults(x=>({...x,uom:uppercaseItemText(e.target.value)}))}/></div>
    <div className="field"><label>Movement</label><ModernSelect className="select" value={importDefaults.movement} onChange={e=>setImportDefaults(x=>({...x,movement:e.target.value}))}><option>FAST</option><option>NORMAL</option><option>SLOW</option></ModernSelect></div>
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

   <div className="desktop-table tablewrap section"><table className="table"><thead><tr><th/><th>Item Name</th><th>Brand</th><th>Category</th><th>Main Group</th><th>Subgroup</th><th>Size</th><th>UOM</th><th>Movement</th><th>Max</th><th>Reorder</th><th>Status</th></tr></thead><tbody>{draftRows.map(r=><tr key={r._draftId}><td><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/></td><td><input className="input" value={r.import_name||''} onChange={e=>setDraft(r._draftId,'import_name',e.target.value)}/></td><td><input className="input" value={r.brand||''} onChange={e=>setDraft(r._draftId,'brand',e.target.value)}/></td><td><input className="input" value={r.category||''} onChange={e=>setDraft(r._draftId,'category',e.target.value)}/></td><td><input className="input" value={r.main_group||''} onChange={e=>setDraft(r._draftId,'main_group',e.target.value)}/></td><td><input className="input" value={r.subgroup||''} onChange={e=>setDraft(r._draftId,'subgroup',e.target.value)}/></td><td><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></td><td><input className="input short-entry" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></td><td><ModernSelect className="select" value={r.movement||'NORMAL'} onChange={e=>setDraft(r._draftId,'movement',e.target.value)}><option>FAST</option><option>NORMAL</option><option>SLOW</option></ModernSelect></td><td><input className="input stock-entry" inputMode="decimal" value={r.max_stock??'0'} onChange={e=>setDraft(r._draftId,'max_stock',e.target.value)}/></td><td><input className="input stock-entry" inputMode="decimal" value={r.reorder_level??'0'} onChange={e=>setDraft(r._draftId,'reorder_level',e.target.value)}/></td><td>{r._importStatus?<Badge>{r._importStatus}</Badge>:'—'}</td></tr>)}</tbody></table></div>
   <div className="mobile-card-list section">{draftRows.map(r=><div className="procurement-data-row" key={r._draftId}><div className="stock-card-title"><label className={'choice-pill '+(r._selected?'selected-choice':'')}><input type="checkbox" checked={r._selected} onChange={e=>setDraft(r._draftId,'_selected',e.target.checked)}/>Create</label>{r._importStatus&&<Badge>{r._importStatus}</Badge>}</div><div className="formgrid section"><div className="field wide"><label>Item Name</label><input className="input" value={r.import_name||''} onChange={e=>setDraft(r._draftId,'import_name',e.target.value)}/></div><div className="field"><label>Brand</label><input className="input" value={r.brand||''} onChange={e=>setDraft(r._draftId,'brand',e.target.value)}/></div><div className="field"><label>Category</label><input className="input" value={r.category||''} onChange={e=>setDraft(r._draftId,'category',e.target.value)}/></div><div className="field"><label>Main Group</label><input className="input" value={r.main_group||''} onChange={e=>setDraft(r._draftId,'main_group',e.target.value)}/></div><div className="field"><label>Subgroup</label><input className="input" value={r.subgroup||''} onChange={e=>setDraft(r._draftId,'subgroup',e.target.value)}/></div><div className="field"><label>Size</label><input className="input" value={r.size||''} onChange={e=>setDraft(r._draftId,'size',e.target.value)}/></div><div className="field"><label>UOM</label><input className="input" value={r.uom||''} onChange={e=>setDraft(r._draftId,'uom',e.target.value)}/></div><div className="field"><label>Movement</label><ModernSelect className="select" value={r.movement||'NORMAL'} onChange={e=>setDraft(r._draftId,'movement',e.target.value)}><option>FAST</option><option>NORMAL</option><option>SLOW</option></ModernSelect></div><div className="field"><label>Max</label><input className="input" inputMode="decimal" value={r.max_stock??'0'} onChange={e=>setDraft(r._draftId,'max_stock',e.target.value)}/></div><div className="field"><label>Reorder</label><input className="input" inputMode="decimal" value={r.reorder_level??'0'} onChange={e=>setDraft(r._draftId,'reorder_level',e.target.value)}/></div></div></div>)}</div>
  </div>}

  {canUpload&&draftRows.length>0&&<div className="card pad section"><div className="sectionhead"><div><h3>Save Price List Document</h3><p>This is separate from Item Master import. You may create items, save the price list, do both, or only save the price list.</p></div><button className="btn primary" disabled={busy||extracting} onClick={savePriceList}>{busy?'Saving…':'Save Price List'}</button></div></div>}

  {isAdmin&&lists.length>0&&<div className="card pad section"><div className="sectionhead"><div><h3>{currentCompany?.name} · Price-list History</h3><p>Admin-only history. Ordinary staff cannot query older or costing records.</p></div></div><div className="stack">{lists.map(x=><button className={'btn record-button '+(active?.id===x.id?'active-record':'')} key={x.id} onClick={()=>openList(x)}><div><strong>{x.title}</strong><div className="muted tiny">{x.list_type.toUpperCase()} · {x.effective_date||'No effective date'}</div></div><div className="right"><Badge>{x.status}</Badge>{x.is_current&&<Badge>current</Badge>}</div></button>)}</div></div>}

  {!isAdmin&&currentMrp&&(!active||active.id!==currentMrp.id)&&<div className="section"><button className="btn" onClick={()=>openList(currentMrp)}>Open Latest MRP</button></div>}

  <div className="card pad section">{!active?<Empty>{companyId?'No saved/approved price list selected.':'Select a company.'}</Empty>:<>
   <div className="sectionhead"><div><h3>{active.title}</h3><p>{active.effective_date||'No effective date'}{!staffMode?' · '+active.list_type.toUpperCase():''}{!staffMode?' · extraction '+String(active.extraction_status||'not requested').replaceAll('_',' '):''}</p></div><div className="toolbar">{canUpload&&active.list_type==='mrp'&&active.status!=='approved'&&<button className="btn" onClick={rematch}>Re-match Items</button>}{isAdmin&&active.status!=='approved'&&<button className="btn good" onClick={approve}>Approve & Make Current</button>}{isAdmin&&active.status==='approved'&&active.list_type==='mrp'&&<button className="btn" disabled={busy} onClick={populateCompanyList}>Link Matched Items to Company List</button>}</div></div>
   {visibleDocs.length>0&&<div className="toolbar section">{visibleDocs.map(d=><button className="btn" key={d.id} onClick={()=>viewDoc(d)}>{staffMode?'View Latest MRP PDF/Image':d.document_kind.replaceAll('_',' ')}</button>)}</div>}
   {canUpload&&active.status!=='approved'&&<div className="section"><h4>Saved extracted rows</h4><div className="formgrid section"><div className="field"><label>Code</label><input className="input" value={line.external_code} onChange={e=>setLine(x=>({...x,external_code:e.target.value}))}/></div><div className="field"><label>Description</label><input className="input" value={line.description} onChange={e=>setLine(x=>({...x,description:uppercaseItemText(e.target.value)}))}/></div><div className="field"><label>Size</label><input className="input" value={line.size} onChange={e=>setLine(x=>({...x,size:uppercaseItemText(e.target.value)}))}/></div><div className="field"><label>UOM</label><input className="input" value={line.uom} onChange={e=>setLine(x=>({...x,uom:uppercaseItemText(e.target.value)}))}/></div><div className="field"><label>MRP</label><input className="input" inputMode="decimal" value={line.mrp} onChange={e=>setLine(x=>({...x,mrp:e.target.value}))}/></div>{isAdmin&&active.list_type==='cost'&&<><div className="field"><label>Cost</label><input className="input" inputMode="decimal" value={line.cost} onChange={e=>setLine(x=>({...x,cost:e.target.value}))}/></div><div className="field"><label>Discount %</label><input className="input" inputMode="decimal" value={line.discount_percent} onChange={e=>setLine(x=>({...x,discount_percent:e.target.value}))}/></div></>}</div><button className="btn section" onClick={addLine}>Add Review Row</button></div>}
   <DataTable mobileCards columns={[
    {key:'external_code',label:'Code',render:r=>canUpload&&active.status!=='approved'?<input className="input" defaultValue={r.external_code||''} onBlur={e=>updateLine(r,'external_code',e.target.value)}/>:r.external_code||'—'},
    {key:'description',label:fieldLabel(fields,'price_lists','description','Item'),render:r=>canUpload&&active.status!=='approved'?<input className="input item-uppercase" defaultValue={uppercaseItemText(r.description||'')} onBlur={e=>updateLine(r,'description',e.target.value)}/>:uppercaseItemText(r.description)},
    {key:'size',label:fieldLabel(fields,'price_lists','size','Size'),render:r=>uppercaseItemText(r.size||'—')},
    {key:'uom',label:fieldLabel(fields,'price_lists','uom','UOM'),render:r=>uppercaseItemText(r.uom||'—')},
    {key:'mrp',label:fieldLabel(fields,'price_lists','mrp','MRP'),render:r=>r.mrp===null||r.mrp===undefined?'—':money(r.mrp)},
    ...(!staffMode?[{key:'match_status',label:'Match',render:r=><Badge>{r.match_status}</Badge>}]:[]),
    ...(isAdmin&&active.list_type==='cost'?[{key:'cost',label:'Cost',render:r=>r.cost===null?'—':money(r.cost)},{key:'net_cost',label:'Net Cost',render:r=>r.net_cost===null?'—':money(r.net_cost)}]:[]),
    ...(canUpload&&active.status!=='approved'?[{key:'review_action',label:'Review',render:r=><button className="btn small" onClick={()=>ignoreLine(r)}>{r.match_status==='ignored'?'Restore':'Ignore'}</button>}]:[])
   ]} rows={shown}/>
  </>}</div>
 </>
}

