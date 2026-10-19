'use client'

import {ModernSelect} from './modern-select'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {useDangerConfirmation,useActionConfirmation} from './danger-confirmation'
import {businessDate,qty,money,itemTitle} from '@/lib/helpers'
import {allRows,containsAny} from '@/lib/query-pages'
import {indexStockItems,searchStockItems,stockSearchColumns,stockItemLabel as originalStockItemLabel} from '@/lib/stock-search.mjs'
import {uppercaseItemText,normalizeItemText,uppercaseItemAttributes,ITEM_TEXT_FIELDS} from '@/lib/item-text.mjs'
import {loadStockCatalogue,isTransientStockQueryError,retryStockQuery} from '@/lib/stock-catalogue.mjs'
import {stockCountBatch} from '@/lib/stock-batch.mjs'
import {normalizeQuantityInput,isQuantityInput,normalizeQuantityDraft} from '@/lib/quantity-input.mjs'
import {Badge,DataTable,configuredColumns,Empty} from './ui'
import {InfoButton} from './help-ui'
import {QuickAddItem} from './quick-add-item'
import {StockPrintDialog} from './stock-print-dialog'
import dynamic from 'next/dynamic'
const CompanyLists=dynamic(()=>import('./modules-company').then(m=>m.CompanyLists),{loading:()=> <div className="card pad">Loading Company Items…</div>})
const stockItemLabel=item=>uppercaseItemText(originalStockItemLabel(item))

export function Dashboard({lastWork,resumeWork=()=>{},activeView='dashboard',features=[],fail,navigate=()=>{},canNavigate=()=>false,t=(k,f)=>f||k}){
 const[d,setD]=useState({}),[req,setReq]=useState([]),[pos,setPos]=useState([]),[alerts,setAlerts]=useState({rfq:0,po:0,stockDue:0,receiptVariance:0,urgent:0})
 const[loadState,setLoadState]=useState({})
 const loadSerial=useRef(0)
 const[overdueOpen,setOverdueOpen]=useState(false)
 const destinations={active_items:['items',''],open_requirements:['requirements','all'],still_to_order:['requirements','to_order'],awaiting_receipt:['requirements','delivery'],open_pos:['po','open'],po_value:['po','non_cancelled'],invoice_variances:['invoices','variance'],stock_due:['stock','due'],urgent_actions:['urgent_actions','']}
 const load=useCallback(async()=>{try{
  const serial=++loadSerial.current
  setLoadState({summary:'loading',requirements:'loading',orders:'loading',rfq:'loading',po:'loading',stockDue:'loading',receiptVariance:'loading',urgent:'loading'})
  const today=businessDate()
  const tasks=[
   supabase.from('proc_v_dashboard').select('*').single(),
   supabase.from('proc_v_requirements').select('*').in('status',['open','quoting','partially_ordered','ordered','partially_received']).order('created_at',{ascending:false}).limit(8),
   supabase.from('proc_purchase_orders').select('*,supplier:proc_suppliers(name)').in('status',['pending_approval','approved','sent','partially_received']).order('created_at',{ascending:false}).limit(6),
   supabase.from('proc_rfqs').select('id',{count:'exact',head:true}).lt('due_date',today).in('status',['sent','partially_quoted']),
   supabase.from('proc_purchase_orders').select('id',{count:'exact',head:true}).lt('expected_date',today).in('status',['sent','partially_received']),
   supabase.from('proc_v_stock_check_due').select('item_id',{count:'exact',head:true}).eq('is_due',true),
   supabase.from('proc_v_receipt_reconciliation').select('po_line_id',{count:'exact',head:true}).gt('over_received_qty',0),
   supabase.from('proc_v_urgent_actions').select('action_id',{count:'exact',head:true})
  ]
  const names=['summary','requirements','orders','rfq','po','stockDue','receiptVariance','urgent']
  await Promise.all(tasks.map(async(task,index)=>{const key=names[index];try{const result=await task;if(result.error)throw result.error;if(serial!==loadSerial.current)return;if(index===0)setD(result.data||{});else if(index===1)setReq(result.data||[]);else if(index===2)setPos(result.data||[]);else setAlerts(v=>({...v,[key]:result.count||0}));setLoadState(v=>({...v,[key]:'ready'}))}catch(e){if(serial===loadSerial.current)setLoadState(v=>({...v,[key]:'error'}))}}))
 }catch(e){fail(e)}},[fail])
 useEffect(()=>{if(activeView==='dashboard')load()},[load,activeView])
 const enabled=k=>features.find(x=>x.feature_key===k)?.enabled!==false
 const cards=[
  ['dashboard.active_items','Active items',d.active_items,'Master catalogue'],
  ['dashboard.open_requirements','Open requirements',d.open_requirements,'Need procurement action'],
  ['dashboard.still_to_order','Still to order',d.still_to_order,'Not yet placed'],
  ['dashboard.awaiting_receipt','Awaiting receipt',d.awaiting_receipt,'Ordered, not fully received'],
  ['dashboard.open_pos','Open POs',d.open_pos,'Approval / delivery'],
  ['dashboard.po_value','PO value',money(d.po_value),'Non-cancelled POs'],
  ['dashboard.invoice_variances','Invoice variances',d.invoice_variances,'Mismatch alerts'],
  ['dashboard.stock_due','Stock checks due',alerts.stockDue||0,'Based on cycle-count schedule'],
  ['dashboard.urgent_actions','Urgent actions',alerts.urgent||0,'Zero stock, customer-paid and FAST-mover priority'],
  ['dashboard.overdue_actions','Overdue actions',(alerts.rfq||0)+(alerts.po||0),`${alerts.rfq||0} supplier price request · ${alerts.po||0} PO`]
 ].filter(x=>enabled(x[0]))
 return <>
  {lastWork&&canNavigate(lastWork.view)&&<button className="btn primary section" onClick={resumeWork}>Continue order / task →</button>}
  <div className="card pad section"><h3>Today's work</h3><div className="toolbar section">{canNavigate('requirements')&&<button className="btn primary" onClick={()=>navigate('requirements','pending_review',2)}>Review outstanding items</button>}{canNavigate('rfq')&&<button className="btn" onClick={()=>navigate('rfq')}>Enter / compare prices</button>}{canNavigate('po')&&<button className="btn" onClick={()=>navigate('po','pending_approval')}>Approve orders</button>}{canNavigate('receiving')&&<button className="btn" onClick={()=>navigate('receiving')}>Receive deliveries</button>}<button className="btn small" onClick={load}>Refresh work queues</button></div></div>
  <div className="grid metrics">{cards.map(x=>{
   const key=x[0].slice('dashboard.'.length),target=destinations[key]
   const actionable=key==='overdue_actions'?(canNavigate('rfq')||canNavigate('po')):target&&canNavigate(target[0])
   const source=key==='stock_due'?'stockDue':key==='urgent_actions'?'urgent':key==='overdue_actions'?(loadState.rfq==='error'||loadState.po==='error'?'error':loadState.rfq==='ready'&&loadState.po==='ready'?'overdue':'loading'):'summary'
   const state=source==='overdue'?'ready':source==='error'||source==='loading'?source:loadState[source]
   const content=<><div className="kicker">{t(x[0],x[1])}</div><div className="value num" id={x[0]+'-value'}>{state==='ready'?(x[2]??0):state==='error'?'Unavailable':'…'}</div><div className="sub">{t(x[0]+'.sub',x[3])}</div></>
   return actionable?<button type="button" className="card metric metric-link" key={x[0]} aria-label={t(x[0],x[1])} aria-describedby={x[0]+'-value'} aria-expanded={key==='overdue_actions'?overdueOpen:undefined} aria-controls={key==='overdue_actions'?'dashboard-overdue':undefined} onClick={()=>key==='overdue_actions'?setOverdueOpen(v=>!v):navigate(...target)}>{content}<span className="metric-action">{t('dashboard.view_details','View details')} →</span></button>:<div className="card metric" key={x[0]}>{content}</div>
  })}</div>
  {overdueOpen&&<div className="card pad section" id="dashboard-overdue"><h3>{t('dashboard.overdue_actions','Overdue actions')}</h3><div className="toolbar">{canNavigate('rfq')&&<button className="btn" onClick={()=>navigate('rfq','overdue')}>{t('dashboard.overdue_rfqs','Overdue supplier requests')} · {alerts.rfq||0}</button>}{canNavigate('po')&&<button className="btn" onClick={()=>navigate('po','overdue')}>{t('dashboard.overdue_pos','Overdue purchase orders')} · {alerts.po||0}</button>}</div></div>}
  <div className="split section">
   <div className="card pad"><div className="sectionhead"><div><h3>{t('dashboard.procurement_attention','Procurement attention')}</h3><p>{t('dashboard.procurement_attention_hint','Newest unresolved requirements')}</p></div><button className="btn small" onClick={load}>{t('common.refresh','Refresh')}</button></div>
    {loadState.requirements==='error'?<p role="alert">Requirements unavailable. Tap Refresh to retry.</p>:loadState.requirements!=='ready'?<p role="status">Loading requirements…</p>:<DataTable columns={[
     {key:'requirement_no',label:'Requirement'},
     {key:'description',label:'Item'},
     {key:'adjusted_qty',label:'Required',render:r=>qty(r.adjusted_qty)},
     {key:'remaining_to_order',label:'Still To Order',render:r=><b className="warn-text">{qty(r.remaining_to_order)}</b>},
     {key:'ordered_not_received',label:'Ordered Not Received',render:r=>qty(r.ordered_not_received)},
     {key:'status',label:'Status'}
    ]} rows={req} mobileCards/>}
   </div>
   <div className="card pad"><div className="sectionhead"><div><h3>{t('dashboard.po_pipeline','PO pipeline')}</h3><p>{t('dashboard.po_pipeline_hint','Approval and delivery status')}</p></div></div>
    {loadState.orders==='error'?<p role="alert">Orders unavailable. Tap Refresh to retry.</p>:loadState.orders!=='ready'?<p role="status">Loading orders…</p>:pos.length?pos.map(x=><button className="btn record-button compact-record" key={x.id} disabled={!canNavigate('po')} onClick={()=>navigate('po',x.id)}><div><strong>{x.po_no}</strong><div className="muted tiny">{x.supplier?.name||'Supplier'}</div></div><div className="right"><Badge>{x.status}</Badge><div className="num record-value">{money(x.total)}</div></div></button>):<Empty/>}
   </div>
  </div>
 </>
}

export function StockCheck({initialFilter='',profile,fields,features=[],settings={},company,flash,fail,can=()=>false,navigate=()=>{},canNavigate=()=>false,isActiveView=()=>true,language='en',t=(k,f)=>f||k}){
 const confirmAction=useActionConfirmation()
 const[stockTab,setStockTab]=useState('general')
 const[submission,setSubmission]=useState(null)
 const resultRef=useRef(null)
 useEffect(()=>{if(submission)resultRef.current?.scrollIntoView({block:'start'})},[submission])
 const confirmDanger=useDangerConfirmation()
 const feature=(key,fallback=true)=>features.find(x=>x.feature_key===key)?.enabled??fallback
 const cycleCfg=features.find(x=>x.feature_key==='stock.cycle_counting')?.config||{}
 const mobileCfg=features.find(x=>x.feature_key==='stock.mobile_entry')?.config||{}
 const guidedCountEnabled=settings.stock_guided_count_enabled===true
 const dailyTarget=Math.max(10,Number(cycleCfg.daily_target||75))
 const allowedPageSizes=Array.isArray(mobileCfg.allowed_page_sizes)?mobileCfg.allowed_page_sizes.filter(x=>[20,50,100].includes(Number(x))).map(Number):[20,50,100]
 const defaultPageSize=allowedPageSizes.includes(Number(mobileCfg.default_page_size))?Number(mobileCfg.default_page_size):20
 const isCounter=can('stock.count.enter')&&!can('items.edit')&&!can('procurement.requirements.manage')
 const serverDrafts=feature('stock.server_drafts')

 const[cats,setCats]=useState([]),[cat,setCat]=useState(initialFilter==='due'?'':'GENERAL'),[movement,setMovement]=useState(initialFilter==='due'?'':'FAST'),[mainGroup,setMainGroup]=useState(''),[groups,setGroups]=useState([]),[dueOnly,setDueOnly]=useState(feature('stock.cycle_counting'))
 const[loadedItems,setItems]=useState([]),[entry,setEntry]=useState({}),[sufficient,setSufficient]=useState({}),[skipped,setSkipped]=useState(new Set()),[cursor,setCursor]=useState(0)
 const[viewMode,setViewMode]=useState('browse'),[filtersOpen,setFiltersOpen]=useState(false),[browsePage,setBrowsePage]=useState(0),[browsePageSize,setBrowsePageSize]=useState(defaultPageSize)
 useEffect(()=>{if(!guidedCountEnabled)setViewMode('browse')},[guidedCountEnabled])
 const[activeBrowseId,setActiveBrowseId]=useState(null),[expandedBrowseId,setExpandedBrowseId]=useState(null)
 const[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[stockLoadError,setStockLoadError]=useState(''),[stockLoadRetry,setStockLoadRetry]=useState(0),[dueTotal,setDueTotal]=useState(0),[draftReady,setDraftReady]=useState(false)
 const[draftSave,setDraftSave]=useState({local:false,server:'idle'}),[draftRetry,setDraftRetry]=useState(0)
 const draftWrites=useRef(Promise.resolve())
 const[historyOpen,setHistoryOpen]=useState(false),[historyRows,setHistoryRows]=useState([]),[historyDetail,setHistoryDetail]=useState(null),[historyLoading,setHistoryLoading]=useState(false)
 const[searchOpen,setSearchOpen]=useState(false),[searchTerm,setSearchTerm]=useState(''),[searchResults,setSearchResults]=useState([]),[searchBusy,setSearchBusy]=useState(false),[searchScope,setSearchScope]=useState('all'),[searchViewport,setSearchViewport]=useState(null)
 const[heldSearch,setHeldSearch]=useState(null)
 const[searchCatalogue,setSearchCatalogue]=useState([]),[catalogueReady,setCatalogueReady]=useState(false),[catalogueError,setCatalogueError]=useState(''),[catalogueRetry,setCatalogueRetry]=useState(0),[searchError,setSearchError]=useState('')
 const[quickItem,setQuickItem]=useState(null),[quickValue,setQuickValue]=useState(''),[urgentBusy,setUrgentBusy]=useState(false)
 const startedAt=useRef(null),startPromise=useRef(null),quickInput=useRef(null),guidedInput=useRef(null)
 const draftKey='gh-stock-count-draft:'+profile.id
 const rowField=(key,fallback=false)=>{const x=fields?.find(f=>f.module_key==='stock_entry'&&f.field_key===key);return x?x.enabled:fallback}

 useEffect(()=>{(async()=>{try{
  let local={}
  try{local=JSON.parse(localStorage.getItem(draftKey)||'{}')}catch{}
  let chosen=local
  if(serverDrafts){
   try{
   const r=await supabase.from('proc_stock_count_drafts').select('*').eq('owner_id',profile.id).maybeSingle()
   if(r.error)throw r.error
   if(r.data){
    const localTime=Date.parse(local.savedAt||0)||0
    const serverTime=Date.parse(r.data.updated_at||0)||0
    if(serverTime>=localTime)chosen={
     entry:r.data.entry||{},
     skipped:Array.isArray(r.data.skipped)?r.data.skipped:[],
     cursor:r.data.cursor||0,
     startedAt:r.data.count_started_at||null,
     filters:r.data.filters||{},
     savedAt:r.data.updated_at
    }
   }
   }catch(e){fail(new Error('Account draft could not be loaded. Restored the draft saved on this device. '+(e.message||'')))}
  }
  setEntry(normalizeQuantityDraft(chosen.entry||{}));setSufficient(Object.fromEntries(Object.entries(chosen.filters?.sufficient||{}).filter(([,v])=>v===true)));setCursor(Number(chosen.cursor||0));setSkipped(new Set(chosen.skipped||[]));startedAt.current=Number.isFinite(Date.parse(chosen.startedAt||''))?chosen.startedAt:null
  if(chosen.filters){
   if(chosen.filters.heldSearch?.query?.trim()){setHeldSearch(chosen.filters.heldSearch);setSearchTerm(chosen.filters.heldSearch.query)}
   if(chosen.filters.cat!==undefined)setCat(chosen.filters.cat)
   if(chosen.filters.movement!==undefined)setMovement(chosen.filters.movement)
   if(chosen.filters.mainGroup!==undefined)setMainGroup(chosen.filters.mainGroup)
   if(chosen.filters.dueOnly!==undefined)setDueOnly(!!chosen.filters.dueOnly)
  }
 }catch(e){fail(e)}finally{if(initialFilter==='due'){setCat('');setMovement('');setMainGroup('');setDueOnly(true)}setDraftReady(true)}})()},[profile.id,serverDrafts,fail])

 useEffect(()=>{
  if(!draftReady)return
  const savedAt=new Date().toISOString()
  const filters={cat,movement,mainGroup,dueOnly,heldSearch,sufficient}
  const payload={entry,cursor,skipped:[...skipped],startedAt:startedAt.current,filters,savedAt}
  // Save locally immediately so leaving the screen cannot cancel the last keystroke.
  let localSaved=false,cancelled=false
  try{localStorage.setItem(draftKey,JSON.stringify(payload));localSaved=true}catch{console.warn('Local stock draft could not be saved')}
  setDraftSave({local:localSaved,server:serverDrafts?'saving':'disabled'})
  const timer=setTimeout(()=>{
   if(serverDrafts){
    // Serialize writes so an older, slower request cannot overwrite newer input.
    draftWrites.current=draftWrites.current.catch(()=>{}).then(async()=>{
     if(cancelled)return
     try{
      const r=await supabase.from('proc_stock_count_drafts').upsert({
       owner_id:profile.id,entry,skipped:[...skipped],cursor,filters,
       count_started_at:payload.startedAt,updated_at:savedAt
      },{onConflict:'owner_id'})
      if(r.error)throw r.error
      if(!cancelled)setDraftSave({local:localSaved,server:'saved'})
     }catch{
      if(!cancelled)setDraftSave({local:localSaved,server:'failed'})
     }
    })
   }
  },650)
  return()=>{cancelled=true;clearTimeout(timer)}
 },[entry,sufficient,cursor,skipped,cat,movement,mainGroup,dueOnly,heldSearch,draftReady,serverDrafts,profile.id,draftKey,draftRetry])

 useEffect(()=>{(async()=>{try{
  const r=await retryStockQuery(async()=>{const result=await supabase.rpc('proc_item_filter_options_v1');if(result.error)throw result.error;return result})
  const data=r.data||{}
  const list=Array.isArray(data.categories)?data.categories:[]
  setCats(list);setGroups(Array.isArray(data.main_groups)?data.main_groups:[])
  if(initialFilter!=='due'&&cat&&list.length&&!list.includes(cat))setCat(list.includes('GENERAL')?'GENERAL':list[0])
 }catch(e){fail(e)}})()},[fail])

 const stockLoadRevision=useRef(0),stockLoadController=useRef(null)
 const load=useCallback(async()=>{
  stockLoadController.current?.abort()
  const controller=new AbortController()
  stockLoadController.current=controller
  const revision=++stockLoadRevision.current
  setLoading(true);setStockLoadError('')
  try{
  const pageChunk=500
  const cap=dueOnly?dailyTarget:Infinity
  let all=[],total=0,offset=0
  while(all.length<cap){
   const r=await retryStockQuery(async()=>{
    let q=supabase.from('proc_v_stock_check_due').select('*',{count:offset===0&&dueOnly?'exact':undefined}).order('next_check_date',{ascending:true}).order('description').order('item_id').range(offset,Math.min(offset+pageChunk-1,cap-1))
    if(cat)q=q.eq('category',cat)
    if(movement)q=q.eq('movement',movement)
    if(mainGroup)q=q.eq('main_group',mainGroup)
    if(dueOnly)q=q.eq('is_due',true)
    const response=await q.abortSignal(controller.signal)
    if(response.error)throw response.error
    return response
   },{signal:controller.signal})
   if(controller.signal.aborted||revision!==stockLoadRevision.current)return
   if(offset===0)total=r.count??0
   const batch=r.data||[]
   all=all.concat(batch)
   if(batch.length<pageChunk||all.length>=cap)break
   offset+=pageChunk
  }
  setDueTotal(total||all.length)
  setItems(all)
  setCursor(0);setBrowsePage(0)
 }catch(e){if(!controller.signal.aborted&&revision===stockLoadRevision.current)setStockLoadError(isTransientStockQueryError(e)?'Stock items timed out. Retry to continue.':e.message||'Stock items could not be loaded.')}finally{if(!controller.signal.aborted&&revision===stockLoadRevision.current)setLoading(false)}},[cat,movement,mainGroup,dueOnly,dailyTarget,stockLoadRetry])
 useEffect(()=>{load();return()=>{stockLoadRevision.current++;stockLoadController.current?.abort()}},[load])

 useEffect(()=>{
  if(!searchOpen||typeof window==='undefined'||!window.visualViewport){setSearchViewport(null);return}
  const vv=window.visualViewport
  const update=()=>setSearchViewport({height:Math.round(vv.height),top:Math.round(vv.offsetTop)})
  update()
  vv.addEventListener('resize',update);vv.addEventListener('scroll',update)
  return()=>{vv.removeEventListener('resize',update);vv.removeEventListener('scroll',update)}
 },[searchOpen])

 // Load once per visit, not on every open/close of search.
 // Retry small pages on transient Postgres timeout; never mark a partial list ready.
 useEffect(()=>{
  const controller=new AbortController()
  setCatalogueReady(false);setCatalogueError('');setSearchCatalogue([])
  ;(async()=>{try{
   const result=await loadStockCatalogue({
    signal:controller.signal,
    fetchPage:async(start,end,signal)=>{
     const r=await supabase.from('proc_items').select(stockSearchColumns).eq('active',true)
      .order('description').order('id').range(start,end).abortSignal(signal)
     if(r.error)throw r.error
     return r.data||[]
    },
    onPage:rows=>setSearchCatalogue(indexStockItems(rows))
   })
   if(result&&!controller.signal.aborted)setCatalogueReady(true)
  }catch(e){
   if(!controller.signal.aborted)setCatalogueError(isTransientStockQueryError(e)
    ?'Stock catalogue timed out. Tap Retry to load all items.'
    :'Stock catalogue could not be loaded. Tap Retry.')
  }})()
  return()=>controller.abort()
 },[profile.id,catalogueRetry])
 const localSearchIndex=useMemo(()=>{
  const rows=new Map(loadedItems.map(row=>[row.item_id,row]))
  for(const row of searchCatalogue)rows.set(row.item_id,row)
  return indexStockItems([...rows.values()].sort((a,b)=>(a.description||'').localeCompare(b.description||'')))
 },[loadedItems,searchCatalogue])
 const items=useMemo(()=>heldSearch?searchStockItems(localSearchIndex,heldSearch.query,heldSearch.filters||{},Infinity):loadedItems,[heldSearch,localSearchIndex,loadedItems])
 function releaseHeldSearch(){
  // Clear only the held search, never the unsubmitted stock quantities.
  setHeldSearch(null)
  setSearchTerm('')
  setSearchResults([])
  setSearchError('')
  setSearchBusy(false)
  setSearchScope('all')
  setSearchOpen(false)
  setCursor(0)
  setBrowsePage(0)
 }
 function holdSearchResults(){
  if(!searchTerm.trim()||!catalogueReady)return
  setHeldSearch({query:searchTerm.trim(),filters:searchScope==='current'?{category:cat,main_group:mainGroup,movement}:{}})
  setCursor(0);setBrowsePage(0);setViewMode('browse');setSearchOpen(false)
 }
 const visibleSearchResults=useMemo(()=>{
  const filters=searchScope==='current'?{category:cat,main_group:mainGroup,movement}:{}
  const local=searchStockItems(localSearchIndex,searchTerm,filters)
  const seen=new Set(local.map(row=>row.item_id))
  return [...local,...searchStockItems(searchResults,searchTerm,filters).filter(row=>!seen.has(row.item_id))].slice(0,30)
 },[localSearchIndex,searchTerm,searchScope,cat,mainGroup,movement,searchResults])
 useEffect(()=>{
  setSearchResults([]);setSearchError('');setSearchBusy(false)
  const term=searchTerm.trim()
  if(!searchOpen||term.length<2||catalogueReady){setSearchBusy(false);return}
  const controller=new AbortController()
  // Local results appear immediately; defer database search until typing pauses.
  const timer=setTimeout(()=>{
   if(controller.signal.aborted)return
   setSearchBusy(true)
   ;(async()=>{try{
    let q=supabase.from('proc_items').select(stockSearchColumns).eq('active',true)
     .or(containsAny(['item_code','description','brand','category','main_group','subgroup','size','uom'],term))
     .order('description').order('id').limit(30).abortSignal(controller.signal)
    if(searchScope==='current'){
     if(cat)q=q.eq('category',cat)
     if(mainGroup)q=q.eq('main_group',mainGroup)
     if(movement)q=q.eq('movement',movement)
    }
    const r=await q
    if(controller.signal.aborted)return
    if(r.error)throw r.error
    setSearchResults(indexStockItems(r.data||[]))
   }catch(e){
    if(!controller.signal.aborted)setSearchError(isTransientStockQueryError(e)
     ?'Search is taking longer than expected. Local matches remain available.'
     :'Search request failed. Try again.')
   }finally{if(!controller.signal.aborted)setSearchBusy(false)}})()
  },180)
  return()=>{clearTimeout(timer);controller.abort()}
 },[searchOpen,searchTerm,searchScope,cat,mainGroup,movement,catalogueReady])

 async function ensureServerCountStart(){
  if(startedAt.current)return startedAt.current
  if(!startPromise.current){
   startPromise.current=supabase.rpc('proc_begin_stock_count_session_v1').then(({data,error})=>{
    if(error)throw error
    startedAt.current=data
    return data
   }).finally(()=>{startPromise.current=null})
  }
  return startPromise.current
 }
 function beginCount(){
  if(startedAt.current||startPromise.current)return
  ensureServerCountStart().catch(error=>console.warn('Stock count session start failed',error))
 }
 function setCount(id,v){
  const raw=normalizeQuantityInput(v)
  if(raw===null)return
  if(raw!==''&&!/^\d*(?:\.\d{0,3})?$/.test(raw))return
  beginCount();setEntry(x=>({...x,[id]:raw}));setSufficient(s=>{if(!s[id])return s;const n={...s};delete n[id];return n});setSkipped(s=>{if(!s.has(id))return s;const n=new Set(s);n.delete(id);return n})
 }
 function setEnough(id,checked){
  beginCount()
  setSufficient(previous=>{const next={...previous};if(checked)next[id]=true;else delete next[id];return next})
  if(checked)setSkipped(previous=>{if(!previous.has(id))return previous;const next=new Set(previous);next.delete(id);return next})
 }
 const suggested=i=>{
  const v=entry[i.item_id]
  if(sufficient[i.item_id])return 0
  if(v===''||v===undefined)return null
  const n=Number(v)
  return Number.isFinite(n)&&n<=Number(i.reorder_level)?Math.max(Number(i.max_stock)-n,0):0
 }
 const completedCount=useMemo(()=>items.filter(i=>sufficient[i.item_id]||(entry[i.item_id]!==undefined&&entry[i.item_id]!=='')).length,[items,entry,sufficient])
 const skippedCurrent=useMemo(()=>items.filter(i=>skipped.has(i.item_id)).length,[items,skipped])
 const remainingCount=Math.max(items.length-completedCount-skippedCurrent,0)
 const current=items[Math.min(cursor,Math.max(items.length-1,0))]||null

 function nextUnfinished(from=cursor+1){
  if(!items.length)return
  for(let step=0;step<items.length;step++){
   const idx=(from+step)%items.length,id=items[idx].item_id
   if(!sufficient[id]&&(entry[id]===undefined||entry[id]==='')&&!skipped.has(id)){setCursor(idx);setTimeout(()=>guidedInput.current?.focus(),40);return}
  }
  setCursor(Math.min(from,items.length-1))
 }
 function previous(){if(items.length)setCursor(x=>(x-1+items.length)%items.length)}
 async function markUrgentNow(i,currentStock=null,reasonOverride=null){
  if(!i)return false
  const reason=reasonOverride||(Number(currentStock)===0?'zero_stock':i.movement==='FAST'?'fast_mover':'manual_urgent')
  setUrgentBusy(true)
  try{
   const r=await supabase.rpc('proc_mark_item_urgent_v1',{
    p_item_id:i.item_id,p_required_qty:null,p_reason:reason,
    p_current_stock:currentStock===null?null:Number(currentStock),
    p_customer_paid:false,p_customer_reference:null,p_notes:null,p_image_path:null
   })
   if(r.error)throw r.error
   flash(i.description+' added to Urgent Actions as '+String(r.data?.priority||'high').toUpperCase()+'.')
   return true
  }catch(e){fail(e);return false}finally{setUrgentBusy(false)}
 }
 async function saveNext(){
  if(!current)return
  const v=entry[current.item_id]
  if(!sufficient[current.item_id]&&!isQuantityInput(v))return fail(new Error(t('stock.quantity_continue_error','Enter a valid physical stock quantity before continuing.')))
  if(!sufficient[current.item_id]&&Number(v)===0&&feature('urgent.zero_stock_prompt',true))await markUrgentNow(current,0,'zero_stock')
  nextUnfinished(cursor+1)
 }
 function skipCurrent(){
  if(!current)return
  setSkipped(s=>new Set([...s,current.item_id]))
  nextUnfinished(cursor+1)
 }
 function openQuick(i){
  setQuickItem(i);setQuickValue(entry[i.item_id]??'');setSearchOpen(false)
  setTimeout(()=>quickInput.current?.focus(),80)
 }
 async function saveQuick(markUrgent=false){
  if(!quickItem)return
  if(!isQuantityInput(quickValue))return fail(new Error(t('stock.quantity_error','Enter a valid physical stock quantity.')))
  setCount(quickItem.item_id,quickValue)
  const idx=items.findIndex(x=>x.item_id===quickItem.item_id)
  if(idx>=0)setCursor(idx)
  if(markUrgent)await markUrgentNow(quickItem,Number(quickValue),Number(quickValue)===0?'zero_stock':null)
  else flash(quickItem.description+' stock saved to this count.')
  setQuickItem(null);setQuickValue('')
 }

 function focusBrowseNext(index){
  if(index<browseItems.length-1){
   const next=browseItems[index+1]
   setTimeout(()=>document.getElementById('browse-stock-'+next.item_id)?.focus(),25)
   return
  }
  if(browsePage<browsePages-1){
   const nextPage=browsePage+1
   const nextItem=items[nextPage*browsePageSize]
   setBrowsePage(nextPage)
   if(nextItem)setTimeout(()=>document.getElementById('browse-stock-'+nextItem.item_id)?.focus(),80)
  }
 }
 function focusDenseInput(i){
  setActiveBrowseId(i.item_id)
  setTimeout(()=>document.getElementById('browse-row-'+i.item_id)?.scrollIntoView({block:'center',behavior:'smooth'}),90)
 }
 useEffect(()=>{
  if(typeof window==='undefined'||!window.visualViewport)return
  const vv=window.visualViewport
  const keepVisible=()=>{if(activeBrowseId)setTimeout(()=>document.getElementById('browse-row-'+activeBrowseId)?.scrollIntoView({block:'center',behavior:'smooth'}),60)}
  vv.addEventListener('resize',keepVisible)
  return()=>vv.removeEventListener('resize',keepVisible)
 },[activeBrowseId])

 async function submit(){
  if(busy)return
  const {counted,checked,remaining}=stockCountBatch(entry,sufficient)
  if(!checked.length)return fail(new Error(t('stock.at_least_one','Enter at least one stock quantity or mark an item sufficient.')))
  if(counted.some(([,v])=>!isQuantityInput(v)))return fail(new Error(t('stock.negative_error','Stock quantities must be zero or positive numbers.')))
  const submitSuffix=t('stock.submit_confirm_suffix_manual','item(s)? Shortages will go to Procurement Review.')
  const batchNote=remaining?' '+remaining+' additional counted item(s) will stay in your draft for the next submission.':''
  if(!await confirmAction(t('stock.submit_confirm_prefix','Submit')+' '+checked.length+' '+submitSuffix+batchNote,{title:t('stock.confirm_title','Submit stock count'),confirmLabel:t('stock.confirm_submit','Submit stock'),details:t('stock.confirm_next','Next: review shortages, approve quantities and choose suppliers.')}))return

  setBusy(true)
  try{
   await draftWrites.current
   await ensureServerCountStart()
   const lines=checked.map(([item_id,v])=>sufficient[item_id]?{item_id,current_stock:null,sufficient_stock:true}:{item_id,current_stock:Number(v)})
   const r=await supabase.rpc('proc_submit_stock_and_continue_v3',{p_category:cat||'',p_lines:lines,p_notes:null,p_attachment_path:null})
   if(r.error)throw r.error
   const automation=r.data?.automation||null
   const next={...entry},nextSufficient={...sufficient};checked.forEach(([id])=>{delete next[id];delete nextSufficient[id]})
   setEntry(next);setSufficient(nextSufficient);setSkipped(new Set());setCursor(0)
   if(!Object.keys(next).length&&!Object.keys(nextSufficient).length){try{localStorage.removeItem(draftKey)}catch{}startedAt.current=null;if(serverDrafts){await draftWrites.current;await supabase.from('proc_stock_count_drafts').delete().eq('owner_id',profile.id)}}
   let message='Stock submitted. '
   if(automation?.status==='review_required')message+=(automation.submitted_items||checked.length)+' item(s) saved · '+(automation.requirements||0)+' shortage(s) are waiting in Procurement Review.'
   else if(automation?.status==='no_requirements')message+=(automation.submitted_items||checked.length)+' item(s) saved · no purchase is needed.'
   else message+=checked.length+' item(s) saved for procurement review.'
   setSubmission({message,remaining,needsReview:automation?.status!=='no_requirements'})
   await load()
   if(historyOpen)await loadStockHistory()
   if(!remaining&&automation?.status!=='no_requirements'&&canNavigate('requirements')&&isActiveView('stock'))navigate('requirements','pending_review',2)
  }catch(e){
   fail(e)
  }finally{setBusy(false)}
 }

 async function discardDraft(){
  if(!Object.keys(entry).length&&!Object.keys(sufficient).length&&!skipped.size)return
  await confirmDanger({title:'Discard stock draft',message:'Discard all unsent stock entries on this device/account? Submitted stock records will remain.',warning:'Unsubmitted entries will be lost. Check that you do not need them before confirming.',confirmLabel:'Confirm discard',onConfirm:async()=>{
   if(serverDrafts){await draftWrites.current;const r=await supabase.from('proc_stock_count_drafts').delete().eq('owner_id',profile.id);if(r.error)throw r.error}
   setEntry({});setSufficient({});setSkipped(new Set());setCursor(0);startedAt.current=null
   try{localStorage.removeItem(draftKey)}catch{}
   flash('Stock draft discarded.')
  }})
 }

 function submissionTime(v){
  if(!v)return '—'
  try{return new Date(v).toLocaleString(undefined,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Colombo'})}catch{return String(v)}
 }
 async function loadStockHistory(){
  setHistoryLoading(true)
  try{
   const r=await supabase.rpc('proc_stock_submission_history_v1',{p_limit:30})
   if(r.error)throw r.error
   setHistoryRows(r.data||[])
  }catch(e){fail(e)}finally{setHistoryLoading(false)}
 }
 async function openHistoryRow(row){
  if(historyDetail?.count_id===row.count_id){setHistoryDetail(null);return}
  setHistoryLoading(true)
  try{
   const r=await supabase.rpc('proc_stock_submission_detail_v1',{p_count_id:row.count_id})
   if(r.error)throw r.error
   setHistoryDetail({count_id:row.count_id,lines:r.data||[]})
  }catch(e){fail(e)}finally{setHistoryLoading(false)}
 }

 const browsePages=Math.max(1,Math.ceil(items.length/browsePageSize))
 const browseItems=items.slice(browsePage*browsePageSize,(browsePage+1)*browsePageSize)
 useEffect(()=>{if(browsePage>=browsePages)setBrowsePage(Math.max(0,browsePages-1))},[browsePage,browsePages])
 const cols=[
  {key:'description',label:'Item',render:i=><strong>{stockItemLabel(i)}</strong>},
  {key:'uom',label:'UOM',render:i=>uppercaseItemText(i.uom)},
  {key:'movement',label:'Movement',render:i=><Badge>{i.movement}</Badge>},
  ...(rowField('reorder_level',true)?[{key:'reorder_level',label:'Reorder',render:i=><strong className="stock-reorder-value">{qty(i.reorder_level)}</strong>}]:[]),
  ...(rowField('brand')?[{key:'brand',label:'Brand',render:i=>uppercaseItemText(i.brand)}]:[]),
  ...(rowField('item_code')?[{key:'item_code',label:'Code'}]:[]),
  ...(rowField('category')?[{key:'category',label:'Category',render:i=>uppercaseItemText(i.category)}]:[]),
  ...(rowField('main_group')?[{key:'main_group',label:'Main Group',render:i=>uppercaseItemText(i.main_group)}]:[]),
  ...(rowField('subgroup')?[{key:'subgroup',label:'Sub Group',render:i=>uppercaseItemText(i.subgroup)}]:[]),
  ...(rowField('max_stock')?[{key:'max_stock',label:'Max',render:i=>qty(i.max_stock)}]:[]),
  {key:'current_stock',label:'Stock',render:i=><input aria-label={'Current stock: '+stockItemLabel(i)} className="input stock-entry" inputMode="decimal" enterKeyHint="next" disabled={!!sufficient[i.item_id]} value={sufficient[i.item_id]?'':entry[i.item_id]??''} onChange={e=>setCount(i.item_id,e.target.value)}/>},
  {key:'sufficient_stock',label:'Sufficient',render:i=><input aria-label={'Sufficient stock: '+stockItemLabel(i)} title="Stock is above the reorder level; exact count not required" type="checkbox" className="stock-sufficient-checkbox" checked={!!sufficient[i.item_id]} onChange={e=>setEnough(i.item_id,e.target.checked)}/>}
 ]

 const stockTabs=<div className="stock-list-tabs" role="tablist" aria-label="Stock lists"><button role="tab" aria-selected={stockTab==='general'} className={'btn '+(stockTab==='general'?'primary':'')} onClick={()=>setStockTab('general')}>General / Bathroom Items</button>{can('company_lists.view')&&<button role="tab" aria-selected={stockTab==='company'} className={'btn '+(stockTab==='company'?'primary':'')} onClick={()=>setStockTab('company')}>Company Items</button>}</div>
 if(stockTab==='company')return <>{stockTabs}<CompanyLists profile={profile} fields={fields} company={company} flash={flash} fail={fail} can={can} navigate={navigate} active={isActiveView('stock')} t={t}/></>
 return <>
  {stockTabs}
  {submission&&<div ref={resultRef} className="card pad workflow-result section" role="status"><div className="sectionhead"><div><h3>{t('stock.saved','Stock count saved.')}</h3><p>{submission.message}</p>{submission.remaining>0&&<p>{submission.remaining} counted item(s) remain in your draft. Submit the next batch when ready.</p>}{submission.needsReview&&!canNavigate('requirements')&&<p>{t('stock.waiting_review','Your procurement team will review the shortages. You can continue counting stock.')}</p>}</div><button className="btn small" aria-label="Dismiss stock result" onClick={()=>setSubmission(null)}>×</button></div><div className="toolbar">{submission.needsReview&&canNavigate('requirements')&&<button className="btn primary" onClick={()=>navigate('requirements','to_order')}>{t('stock.continue_review','Continue to Procurement Review')} →</button>}<button className="btn" onClick={()=>setSubmission(null)}>{t('stock.keep_counting','Continue stock entry')}</button></div></div>}
  <div className="card pad stock-work-header">
   <div className="sectionhead"><div><h3>{t('stock.title','Stock Entry')}</h3><p>{t('stock.subtitle','Enter or update the physical quantity, then tap Submit Stock. Each submission is kept in history.')}</p></div><div className="toolbar"><button className={'btn '+(historyOpen?'primary':'')} onClick={()=>{const next=!historyOpen;setHistoryOpen(next);if(next&&!historyRows.length)loadStockHistory()}}>{t('stock.history','History')}</button><button className="btn primary" disabled={busy} onClick={submit}>{busy?t('stock.submitting','Submitting…'):t('stock.submit','Submit Stock')+' · '+Object.values(entry).filter(v=>v!==''&&v!==undefined).length}</button></div></div>
   {heldSearch&&<div className="stock-held-summary" role="status">
    <div className="stock-held-summary-info"><strong>Held: {heldSearch.query}</strong><p>{items.length} matching items · Entered quantities stay saved.</p></div>
    <button type="button" className="btn small stock-clear-unhold" aria-label="Clear & Unhold" onClick={releaseHeldSearch}>✕ Clear &amp; Unhold</button>
   </div>}
   {historyOpen&&<div className="stock-history-panel section">
    <div className="stock-history-head"><div><strong>{t('stock.history_title','Stock Submission History')}</strong><span>{t('stock.history_hint','Recount anytime. The latest count updates current stock; older submissions stay unchanged.')}</span></div><button className="btn small" disabled={historyLoading} onClick={loadStockHistory}>{t('common.refresh','Refresh')}</button></div>
    {historyLoading&&!historyRows.length?<div className="muted tiny section">{t('stock.history_loading','Loading stock history…')}</div>:historyRows.length?<><div className="stock-history-summary"><div><span>{t('stock.latest_submission','Latest submission')}</span><b>{historyRows[0].item_count||0} {t('stock.items_label','items')}</b></div><div><span>{t('stock.need_review','Need review')}</span><b>{historyRows[0].shortage_count||0}</b></div><div><span>{t('stock.zero_stock','Zero stock')}</span><b>{historyRows[0].zero_count||0}</b></div><div><span>{t('stock.submitted','Submitted')}</span><b>{submissionTime(historyRows[0].submitted_at)}</b></div></div>
     <div className="stock-history-list">{historyRows.map(h=><div className="stock-history-record" key={h.count_id}><button className="stock-history-row" onClick={()=>openHistoryRow(h)}><div><strong>{h.count_no}</strong><span>{submissionTime(h.submitted_at)} · {h.counted_by_name||'Staff'}{h.category?' · '+h.category:''}</span></div><div className="stock-history-numbers"><b>{h.item_count||0} {t('stock.items_label','items')}</b><span>{h.shortage_count||0} {t('stock.need_order','need order')}</span></div><span className="stock-history-chevron">{historyDetail?.count_id===h.count_id?'⌃':'⌄'}</span></button>
      {historyDetail?.count_id===h.count_id&&<div className="stock-history-detail"><div className="stock-history-detail-head"><span>{t('stock.item','ITEM')}</span><span>{t('stock.submitted_stock','SUBMITTED STOCK')}</span><span>{t('stock.order','ORDER')}</span></div>{historyDetail.lines.map(line=><div className="stock-history-detail-row" key={line.line_id}><div><strong>{[line.description,line.size].filter(Boolean).join(' · ')}</strong><small>{[line.item_code,line.uom].filter(Boolean).join(' · ')}</small></div><b>{qty(line.current_stock)}</b><b className={Number(line.required_qty)>0?'warn-text':''}>{Number(line.required_qty)>0?qty(line.required_qty):'—'}</b></div>)}</div>}
     </div>)}</div></>:<div className="muted tiny section">{t('stock.history_empty','No submitted stock counts yet.')}</div>}
   </div>}

   <button className="stock-search-launch" onClick={()=>{setSearchOpen(true);setTimeout(()=>document.getElementById('stock-global-search')?.focus(),60)}}>
    <span className="stock-search-icon">⌕</span><span><strong>{t('stock.search_any','Search any item')}</strong><small>{t('stock.search_hint','Name, size, code, brand or group')}</small></span><span>›</span>
   </button>

  <QuickAddItem can={can} fail={fail} flash={flash} onCreated={async item=>{setSearchTerm(item.item_code);setSearchOpen(true);await load()}}/>
   <StockPrintDialog profile={profile} company={company} can={can} fail={fail}/>
   {guidedCountEnabled&&<div className="stock-mode-tabs section">
    <button className={'btn '+(viewMode==='guided'?'primary':'')} onClick={()=>setViewMode('guided')}>{t('stock.guided','Guided Count')}</button>
    <button className={'btn '+(viewMode==='browse'?'primary':'')} onClick={()=>setViewMode('browse')}>{t('stock.browse','Fast Entry')}</button>
   </div>}

   {!isCounter&&feature('stock.cycle_counting')&&<div className="toolbar section"><button className={'btn '+(dueOnly?'primary':'')} onClick={()=>setDueOnly(true)}>{t('stock.due_today','Due Today')}</button><button className={'btn '+(!dueOnly?'primary':'')} onClick={()=>setDueOnly(false)}>{t('stock.browse_all','Browse All')}</button><span className="muted tiny">{dueOnly?items.length+' '+t('stock.assigned_now','assigned now')+' · '+dueTotal+' '+t('stock.due','due')+' · '+t('stock.daily_target','daily target')+' '+dailyTarget:items.length+' '+t('stock.items_current','item(s) in current browse set')}</span></div>}

   <div className="movement-tabs no-print section"><span className="muted tiny stock-inline-help">{t('stock.movement','Movement')} <InfoButton topic="movement" language={language}/></span>{['FAST','NORMAL','SLOW'].map(m=><button key={m} className={'btn '+(movement===m?'primary':'')} onClick={()=>setMovement(m)}>{m}</button>)}{!isCounter&&<button className={'btn '+(movement===''?'primary':'')} onClick={()=>setMovement('')}>ALL</button>}</div>

   <div className="stock-filter-summary section">
    <div><span className="muted tiny">{t('stock.current_filter','Current filter')}</span><strong>{[cat||t('stock.all_categories','All categories'),mainGroup||t('stock.all_groups','All groups'),movement||t('stock.all_movement','All movement')].join(' · ')}</strong></div>
    <button className="btn" onClick={()=>setFiltersOpen(x=>!x)}>{filtersOpen?t('stock.hide_filters','Hide Filters'):t('stock.filters','Filters')}</button>
   </div>

   {filtersOpen&&<div className="filters two section stock-filter-panel">
    <ModernSelect className="select" value={cat} onChange={e=>setCat(e.target.value)}><option value="">{t('stock.all_categories','All categories')}</option>{cats.map(x=><option key={x}>{x}</option>)}</ModernSelect>
    {!isCounter&&<ModernSelect className="select" value={mainGroup} onChange={e=>setMainGroup(e.target.value)}><option value="">{t('stock.all_groups','All groups')}</option>{groups.map(x=><option key={x}>{x}</option>)}</ModernSelect>}
   </div>}

  </div>

  {stockLoadError&&<div className="card pad section" role="alert"><strong>{stockLoadError}</strong> <button type="button" className="btn small" onClick={()=>setStockLoadRetry(n=>n+1)}>Retry stock list</button></div>}
  {catalogueError&&<div className="card pad section" role="alert"><strong>{catalogueError}</strong> <button type="button" className="btn small" onClick={()=>setCatalogueRetry(n=>n+1)}>Retry stock catalogue</button></div>}
  {guidedCountEnabled&&viewMode==='guided'&&<div className="card pad section guided-count-shell">{(heldSearch?!catalogueReady:loading)?<Empty>{t('stock.preparing','Preparing your count queue…')}</Empty>:!current?<Empty>{t('stock.none_due','No items are due in this selection.')}</Empty>:<>
   <div className="guided-progress-head"><div><strong>{completedCount} counted</strong><span>{skippedCurrent} {t('stock.skipped','skipped')} · {remainingCount} {t('stock.remaining','remaining')}</span></div><b>{cursor+1} / {items.length}</b></div>
   <div className="guided-progress"><i style={{width:(items.length?Math.min(100,(completedCount/items.length)*100):0)+'%'}}/></div>

   <div className="guided-item">
    <div className="stock-card-title"><div><h2 title={stockItemLabel(current)}>{stockItemLabel(current)}</h2></div><Badge>{current.movement}</Badge></div>
    <div className="guided-meta">{[current.brand,current.uom].filter(Boolean).map(x=><span key={x}>{x}</span>)}{rowField('reorder_level',true)&&<span className="stock-reorder-value">Reorder: {qty(current.reorder_level)}</span>}</div>
    <div className="guided-entry"><label>{t('stock.physical','Physical Stock')}</label><input ref={guidedInput} className="input" inputMode="decimal" enterKeyHint="next" disabled={!!sufficient[current.item_id]} value={sufficient[current.item_id]?'':entry[current.item_id]??''} onChange={e=>setCount(current.item_id,e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveNext()}}} placeholder="Enter quantity"/></div>
    <label className="stock-guided-sufficient"><input className="stock-sufficient-checkbox" type="checkbox" checked={!!sufficient[current.item_id]} onChange={e=>setEnough(current.item_id,e.target.checked)}/> Sufficient — above reorder level</label>
    {!isCounter&&<div className="guided-stats"><div><span>{t('stock.max','Maximum Stock')} <InfoButton topic="maximum_stock" language={language}/></span><b>{qty(current.max_stock)}</b></div><div><span>{t('stock.reorder','Reorder Level')} <InfoButton topic="reorder_level" language={language}/></span><b>{qty(current.reorder_level)}</b></div><div><span>{t('stock.suggested','Suggested')}</span><b className="warn-text">{suggested(current)===null?'—':qty(suggested(current))}</b></div></div>}
    {!sufficient[current.item_id]&&Number(entry[current.item_id])===0&&entry[current.item_id]!==''&&entry[current.item_id]!==undefined&&<div className="urgent-zero-notice"><b>{t('stock.zero_detected','Zero stock detected')}</b><span>{t('stock.zero_push_urgent','This item will be pushed to Urgent Actions when you continue.')}</span></div>}
    <div className="guided-actions"><button className="btn" onClick={previous}>{t('common.previous','Previous')}</button><button className="btn" onClick={skipCurrent}>{t('stock.skip','Skip')}</button><button className="btn primary" onClick={saveNext}>{t('stock.save_next','Save & Next')}</button></div>
   </div>
  </>}</div>}

  {(!guidedCountEnabled||viewMode==='browse')&&<div className="card pad section stock-fast-panel">{(heldSearch?!catalogueReady:loading)?<Empty>{t('common.loading','Loading…')}</Empty>:browseItems.length===0?<Empty>{t('stock.no_items','No items in this queue.')}</Empty>:<>
   <div className="stock-fast-head">
    <div>{guidedCountEnabled&&<h3>{t('stock.browse','Fast Entry')}</h3>}<p><b>{completedCount}</b> {t('stock.counted','entered')} · <b>{Math.max(items.length-completedCount,0)}</b> {t('stock.pending','not entered')}</p></div>
    <div className="stock-page-tools">
     <label><span>{t('stock.page_size','Rows per page')}</span><ModernSelect className="select dense-page-select" value={browsePageSize} onChange={e=>{setBrowsePageSize(Number(e.target.value));setBrowsePage(0)}}>{allowedPageSizes.map(n=><option key={n} value={n}>{n}</option>)}</ModernSelect></label>
     <label><span>{t('stock.jump','Jump to page')}</span><ModernSelect className="select dense-page-select" value={browsePage} onChange={e=>setBrowsePage(Number(e.target.value))}>{Array.from({length:browsePages},(_,n)=><option key={n} value={n}>{n+1}</option>)}</ModernSelect></label>
    </div>
   </div>
   <div className="stock-pagination dense-pagination"><button className="btn small" disabled={browsePage<=0} onClick={()=>setBrowsePage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><strong>{t('common.page','Page')} {browsePage+1} {t('common.of','of')} {browsePages}</strong><button className="btn small" disabled={browsePage>=browsePages-1} onClick={()=>setBrowsePage(x=>Math.min(browsePages-1,x+1))}>{t('common.next','Next')}</button></div>
   <div className="desktop-table tablewrap"><table className="table"><thead><tr>{cols.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{browseItems.map(i=><tr key={i.item_id} className={sufficient[i.item_id]||(entry[i.item_id]!==undefined&&entry[i.item_id]!=='')?'selected':''}>{cols.map(c=><td key={c.key}>{c.render?c.render(i):String(i[c.key]??'—')}</td>)}</tr>)}</tbody></table></div>
   <div className="mobile-card-list browse-entry-list stock-dense-list">
    <div className="stock-dense-columns"><span>{t('stock.item','ITEM')}</span><span>{t('stock.stock','STOCK')}</span><span>Sufficient</span></div>
    {browseItems.map((i,index)=>{
     const enough=!!sufficient[i.item_id]
     const entered=enough||(entry[i.item_id]!==undefined&&entry[i.item_id]!=='')
     const expanded=expandedBrowseId===i.item_id
     const optional=[

      rowField('brand')?i.brand:null,
      rowField('item_code')?i.item_code:null,
      rowField('category')?i.category:null,
      rowField('main_group')?i.main_group:null,
      rowField('subgroup')?i.subgroup:null,
      rowField('max_stock')?'MAX:'+qty(i.max_stock):null
     ].filter(Boolean)
     return <div id={'browse-row-'+i.item_id} className={'stock-dense-row '+(entered?'entered ':'pending ')+(activeBrowseId===i.item_id?'active ':'')+(expanded?'expanded':'')+(enough?' sufficient':'')} key={i.item_id}>
      <button type="button" className="stock-dense-info" title={stockItemLabel(i)} onClick={()=>setExpandedBrowseId(x=>x===i.item_id?null:i.item_id)}>
       <span className="stock-dense-title">{stockItemLabel(i)}</span>
       <span className="stock-dense-meta"><span className={'mini-movement '+String(i.movement||'').toLowerCase()}>{i.movement}</span><span>{i.uom}</span>{rowField('reorder_level',true)&&<strong className="stock-reorder-value">Reorder: {qty(i.reorder_level)}</strong>}{optional.map((x,n)=><span key={n}>{x}</span>)}</span>
      </button>
      <div className="stock-dense-input-wrap">{entered&&<span className="entry-check">✓</span>}<input id={'browse-stock-'+i.item_id} aria-label={stockItemLabel(i)+' '+t('stock.stock','Stock')} className="input browse-stock-input dense-stock-input" inputMode="decimal" enterKeyHint="next" autoComplete="off" disabled={enough} value={enough?'':entry[i.item_id]??''} onFocus={e=>{e.currentTarget.select();focusDenseInput(i)}} onBlur={()=>setActiveBrowseId(x=>x===i.item_id?null:x)} onChange={e=>setCount(i.item_id,e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();focusBrowseNext(index)}}} placeholder="0"/></div>
      <label className="stock-dense-sufficient" title="Stock is above the reorder level; exact count not required"><input type="checkbox" className="stock-sufficient-checkbox" aria-label={'Sufficient stock: '+stockItemLabel(i)} checked={enough} onChange={e=>setEnough(i.item_id,e.target.checked)}/></label>
     </div>
    })}
   </div>
   <div className="stock-pagination dense-pagination bottom"><button className="btn small" disabled={browsePage<=0} onClick={()=>setBrowsePage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><strong>{t('common.page','Page')} {browsePage+1} {t('common.of','of')} {browsePages}</strong><button className="btn small" disabled={browsePage>=browsePages-1} onClick={()=>setBrowsePage(x=>Math.min(browsePages-1,x+1))}>{t('common.next','Next')}</button></div>
   <div className="stock-draft-note" role="status" aria-live="polite"><span>{draftSave.server==='saved'||(draftSave.local&&draftSave.server==='disabled')?'✓':'•'}</span><span>{!draftReady?'Loading saved draft…':draftSave.server==='saving'?(draftSave.local?'Saved on this device · syncing…':'Saving draft…'):draftSave.server==='saved'?'Draft saved to your account.':draftSave.server==='failed'?(draftSave.local?'Saved on this device · account sync failed.':'Draft could not be saved. Keep this screen open and retry.'):draftSave.local?'Draft saved on this device.':'Draft could not be saved on this device. Keep this screen open and retry.'}</span>{draftReady&&(draftSave.server==='failed'||!draftSave.local)&&draftSave.server!=='saving'&&<button type="button" className="btn small" onClick={()=>setDraftRetry(v=>v+1)}>Retry draft save</button>}{(Object.keys(entry).length>0||Object.keys(sufficient).length>0||skipped.size>0)&&<button type="button" className="btn small bad" onClick={discardDraft}>Discard Draft</button>}</div>
  </>}</div>}

  {searchOpen&&<div className="stock-search-overlay" style={searchViewport?{height:searchViewport.height+'px',top:searchViewport.top+'px'}:undefined}>
   <div className="stock-search-panel">
    <div className="stock-search-top">
     <button className="btn small" onClick={()=>setSearchOpen(false)}>←</button>
     <input id="stock-global-search" className="input stock-search-input" autoComplete="off" inputMode="search" enterKeyHint="search" placeholder={t('stock.search_placeholder','Search e.g. 6mm, GI elbow, item code…')} value={uppercaseItemText(searchTerm)} onChange={e=>setSearchTerm(uppercaseItemText(e.target.value))}/>
     {searchTerm&&<button className="btn small" onClick={()=>setSearchTerm('')}>{t('common.clear','Clear')}</button>}
    </div>
    <div className="stock-search-scope"><button className={'choice-pill '+(searchScope==='all'?'selected-choice':'')} onClick={()=>setSearchScope('all')}>{t('stock.all_items','All Items')}</button><button className={'choice-pill '+(searchScope==='current'?'selected-choice':'')} onClick={()=>setSearchScope('current')}>{t('stock.current_filters','Current Filters')}</button></div>
    <label className="stock-search-hold"><input type="checkbox" checked={!!heldSearch&&heldSearch.query===searchTerm.trim()} disabled={!searchTerm.trim()||!catalogueReady} onChange={e=>e.target.checked?holdSearchResults():releaseHeldSearch()}/><span><strong>Hold all matching results for stock entry</strong><small>{catalogueReady?'Keep all matching items in Stock Entry until released.':'Preparing all matching items…'}</small></span></label>
    {searchError&&<div className="muted tiny" role="status">{searchError}</div>}
    <div className="stock-search-results">{!searchTerm.trim()?<Empty>{t('stock.search_start','Start typing. Results appear here immediately above the keyboard.')}</Empty>:searchBusy&&visibleSearchResults.length===0?<Empty>{t('stock.searching','Searching all items…')}</Empty>:visibleSearchResults.length===0?<Empty>{t('stock.no_match','No matching items. Try item code, brand, size or part of the name.')}</Empty>:visibleSearchResults.map(i=><button className="stock-search-result" key={i.item_id} onClick={()=>openQuick(i)}>
      <div><strong>{stockItemLabel(i)}</strong><span>{uppercaseItemText([i.brand,i.uom].filter(Boolean).join(' · '))}</span><small>{uppercaseItemText([i.subgroup,i.category].filter(Boolean).join(' › '))}</small></div>
      <div className="right"><Badge>{i.movement}</Badge>{rowField('reorder_level',true)&&<strong className="stock-reorder-value">Reorder: {qty(i.reorder_level)}</strong>}</div>
     </button>)}</div>
   </div>
  </div>}

  {quickItem&&<div className="modal-backdrop stock-quick-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setQuickItem(null)}}>
   <div className="modal stock-quick-modal card">
    <div className="modal-head"><div><h3>{stockItemLabel(quickItem)}</h3></div><button className="btn small" onClick={()=>setQuickItem(null)}>✕</button></div>
    <div className="guided-meta">{[quickItem.brand,quickItem.uom,quickItem.category].filter(Boolean).map(x=><span key={x}>{x}</span>)}</div>
    {!isCounter&&<div className="guided-stats section"><div><span>{t('stock.max','Maximum Stock')} <InfoButton topic="maximum_stock" language={language}/></span><b>{qty(quickItem.max_stock)}</b></div><div><span>{t('stock.reorder','Reorder Level')} <InfoButton topic="reorder_level" language={language}/></span><b>{qty(quickItem.reorder_level)}</b></div></div>}
    <div className="guided-entry section"><label>{t('stock.physical','Physical Stock')}</label><input ref={quickInput} className="input" inputMode="decimal" enterKeyHint="done" value={quickValue} onChange={e=>{const value=normalizeQuantityInput(e.target.value);if(value!==null)setQuickValue(value)}} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveQuick(Number(quickValue)===0)}}} placeholder="Enter quantity"/></div>
    {Number(quickValue)===0&&quickValue!==''&&<div className="urgent-zero-notice section"><b>{t('stock.zero','Zero stock')}</b><span>{t('stock.zero_hint','Zero is valid and can be marked urgent.')}</span></div>}
    <div className="toolbar section">{Number(quickValue)===0&&quickValue!==''?<><button className="btn primary" disabled={urgentBusy} onClick={()=>saveQuick(true)}>{urgentBusy?t('stock.marking','Marking…'):t('stock.save_mark_urgent','Save + Mark Urgent')}</button><button className="btn" onClick={()=>saveQuick(false)}>{t('stock.save_only','Save Only')}</button></>:<><button className="btn primary" onClick={()=>saveQuick(false)}>{t('stock.save_stock','Save Stock')}</button><button className="btn warn" disabled={urgentBusy} onClick={async()=>{if(await markUrgentNow(quickItem,quickValue===''?null:Number(quickValue)))setQuickItem(null)}}>{t('stock.mark_urgent','Mark Urgent')}</button></>}<button className="btn" onClick={()=>setQuickItem(null)}>{t('common.cancel','Cancel')}</button></div>
   </div>
  </div>}
 </>
}

export function Items({profile,fields,flash,fail,can=()=>false,t=(k,f)=>f||k}){
 const confirmDanger=useDangerConfirmation()
 const[rows,setRows]=useState([]),[q,setQ]=useState(''),[cat,setCat]=useState(''),[cats,setCats]=useState([]),[status,setStatus]=useState('active'),[loading,setLoading]=useState(true),[page,setPage]=useState(0),[total,setTotal]=useState(0)
 const pageSize=100
 const canEdit=can('items.edit')

 const load=useCallback(async()=>{setLoading(true);try{
  const active=status==='all'?null:status==='active'
  const r=await supabase.rpc('proc_search_item_master_v2',{
   p_query:q.trim(),p_category:cat||null,p_active:active,p_offset:page*pageSize,p_limit:pageSize
  })
  if(r.error)throw r.error
  setRows(r.data||[]);setTotal(Number(r.data?.[0]?.total_count||0))
 }catch(e){fail(e)}finally{setLoading(false)}},[cat,status,q,page,fail])
 useEffect(()=>{const t=setTimeout(load,180);return()=>clearTimeout(t)},[load])
 useEffect(()=>{setPage(0)},[q,cat,status])
 useEffect(()=>{(async()=>{const r=await supabase.rpc('proc_item_filter_options_v1');if(!r.error)setCats(r.data?.categories||[])})()},[])

 const filtered=rows

 async function save(r,k,v){
  if(!canEdit)return
  let value=typeof v==='string'&&ITEM_TEXT_FIELDS.includes(k)?uppercaseItemAttributes({[k]:v})[k]:v
  if(k==='max_stock'){
   value=Number(v)
   if(!Number.isFinite(value)||value<0)return fail(new Error(t('items.max_error','Max Stock must be zero or positive.')))
  }
  if(k==='description'&&!String(v||'').trim())return fail(new Error(t('items.description_error','Description cannot be blank.')))
  const x=await supabase.rpc('proc_update_item_master_v1',{p_item_id:r.id,p_patch:{[k]:value}})
  if(x.error)return fail(x.error)
  flash(k==='active'?(value?t('items.enabled_msg','Item enabled.'):t('items.disabled_msg','Item disabled.')):t('items.updated_msg','Item updated successfully.'))
  await load()
 }

 const canDelete=(profile.role_key||profile.role)==='admin'&&can('admin.configure_app')
 async function deleteItem(r){
  if(!canDelete)return
  await confirmDanger({title:'Delete item',message:'Permanently delete '+itemTitle(r)+' from the Item Master? Items used in records or with stock cannot be deleted.',confirmation:r.item_code,confirmLabel:'Confirm delete item',onConfirm:async({confirmation})=>{
   const result=await supabase.rpc('proc_admin_delete_item_v1',{p_item_id:r.id,p_confirmation:confirmation});if(result.error)throw result.error;flash('Item deleted.');await load()
  }})
 }
 const editableText=(r,key,wide=false)=>
  canEdit?<input className={'input item-inline-edit item-uppercase '+(wide?'wide':'')} defaultValue={uppercaseItemText(r[key]||'')} list={key==='category'?'item-master-categories':undefined} onBlur={e=>{if(normalizeItemText(e.target.value)!==normalizeItemText(r[key]))save(r,key,e.target.value)}}/>:uppercaseItemText(r[key]||'—')

 const defaults=[
  {key:'active',label:'Enabled',render:r=>canEdit?<button className={'btn small '+(r.active?'good':'')} onClick={()=>save(r,'active',!r.active)}>{r.active?'Enabled':'Disabled'}</button>:<Badge>{r.active?'enabled':'disabled'}</Badge>},
  {key:'item_code',label:'Code',render:r=><span className="mono">{r.item_code}</span>},
  {key:'category',label:'Category',render:r=>editableText(r,'category')},
  {key:'brand',label:'Brand',render:r=>editableText(r,'brand')},
  {key:'description',label:'Description',render:r=><div className="item-master-title"><strong>{itemTitle(r)}</strong>{canEdit&&<input className="input item-inline-edit item-uppercase" defaultValue={uppercaseItemText(r.description||'')} onBlur={e=>{if(normalizeItemText(e.target.value)!==normalizeItemText(r.description))save(r,'description',e.target.value)}}/>}</div>},
  {key:'main_group',label:'Main Group',render:r=>editableText(r,'main_group')},
  {key:'subgroup',label:'Subgroup',render:r=>editableText(r,'subgroup')},
  {key:'size',label:'Size',render:r=>editableText(r,'size')},
  {key:'uom',label:'UOM',render:r=>editableText(r,'uom')},
  {key:'movement',label:'Movement',render:r=>canEdit?<ModernSelect className="select compact-select" value={r.movement} onChange={e=>save(r,'movement',e.target.value)}><option>FAST</option><option>NORMAL</option><option>SLOW</option></ModernSelect>:<Badge>{r.movement}</Badge>},
  {key:'max_stock',label:'Max Stock',render:r=>canEdit?<input className="input stock-entry" defaultValue={r.max_stock} inputMode="decimal" onBlur={e=>save(r,'max_stock',e.target.value)}/>:qty(r.max_stock)},
  {key:'reorder_level',label:'Reorder At',render:r=>qty(r.reorder_level)},
  {key:'remarks',label:'Remarks',render:r=>editableText(r,'remarks',true)}
 ]
 const cols=[...configuredColumns(fields,'items',defaults),...(canDelete?[{key:'delete_item',label:'Admin',render:r=><button className="btn small bad" onClick={()=>deleteItem(r)}>Delete item</button>}]:[])]

 return <div className="card pad">
  <datalist id="item-master-categories">{cats.map(c=><option key={c} value={c}/>)}</datalist>
  <div className="sectionhead"><div><h3>{t('items.title','Item Master')}</h3><p>{t('items.subtitle','Edit approved item details, move items between categories or FAST/NORMAL/SLOW, and enable/disable products without deleting their history.')}</p></div><div className="toolbar"><input className="input toolbar-input" placeholder={t('items.search','Search item, size, brand or group')} value={q} onChange={e=>setQ(uppercaseItemText(e.target.value))}/><ModernSelect className="select toolbar-select" value={cat} onChange={e=>setCat(e.target.value)}><option value="">{t('stock.all_categories','All categories')}</option>{cats.map(c=><option key={c}>{c}</option>)}</ModernSelect><ModernSelect className="select toolbar-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="active">{t('items.enabled_items','Enabled items')}</option><option value="inactive">{t('items.disabled_items','Disabled items')}</option><option value="all">{t('items.all_items','All items')}</option></ModernSelect></div></div>
  <QuickAddItem can={can} fail={fail} flash={flash} onCreated={async()=>{setQ('');setCat('');setPage(0);await load()}}/>
  {canEdit&&<div className="notice"><b>{t('items.quick_edit','Quick edit is on.')}</b> {t('items.quick_edit_hint','Change Description, Size, Category, Movement or Max Stock directly. Reorder level remains formula-controlled by movement.')}</div>}
  {loading?<Empty>{t('items.loading','Loading item master…')}</Empty>:<><div className="section"><DataTable columns={cols} rows={filtered} mobileCards/></div><div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{total?((page*pageSize)+1):0}–{Math.min((page+1)*pageSize,total)} {t('common.of','of')} {total}</span><button className="btn" disabled={(page+1)*pageSize>=total} onClick={()=>setPage(x=>x+1)}>{t('common.next','Next')}</button></div></>}
 </div>
}

