'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {businessDate,qty,money,itemTitle} from '@/lib/helpers'
import {exportMovementChecklistPdf,exportStockSheetPdf} from '@/lib/pdf'
import {extractDocumentTextFile} from '@/lib/price-list-extract'
import {allRows} from '@/lib/query-pages'
import {Badge,DataTable,configuredColumns,fieldEnabled,fieldLabel,Empty} from './ui'
import {InfoButton} from './help-ui'

export function Dashboard({features=[],fail,navigate=()=>{},canNavigate=()=>false,t=(k,f)=>f||k}){
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
 useEffect(()=>{load()},[load])
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
  <div className="card pad section"><h3>Today's work</h3><div className="toolbar section">{canNavigate('requirements')&&<button className="btn primary" onClick={()=>navigate('requirements','to_order')}>Review outstanding items</button>}{canNavigate('rfq')&&<button className="btn" onClick={()=>navigate('rfq')}>Enter / compare prices</button>}{canNavigate('po')&&<button className="btn" onClick={()=>navigate('po','pending_approval')}>Approve orders</button>}{canNavigate('receiving')&&<button className="btn" onClick={()=>navigate('receiving')}>Receive deliveries</button>}<button className="btn small" onClick={load}>Refresh work queues</button></div></div>
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

export function StockCheck({initialFilter='',profile,fields,features=[],company,footer,flash,fail,can=()=>false,language='en',t=(k,f)=>f||k}){
 const feature=(key,fallback=true)=>features.find(x=>x.feature_key===key)?.enabled??fallback
 const cycleCfg=features.find(x=>x.feature_key==='stock.cycle_counting')?.config||{}
 const mobileCfg=features.find(x=>x.feature_key==='stock.mobile_entry')?.config||{}
 const dailyTarget=Math.max(10,Number(cycleCfg.daily_target||75))
 const allowedPageSizes=Array.isArray(mobileCfg.allowed_page_sizes)?mobileCfg.allowed_page_sizes.filter(x=>[20,50,100].includes(Number(x))).map(Number):[20,50,100]
 const defaultPageSize=allowedPageSizes.includes(Number(mobileCfg.default_page_size))?Number(mobileCfg.default_page_size):20
 const isCounter=can('stock.count.enter')&&!can('items.edit')&&!can('procurement.requirements.manage')
 const canManage=can('items.edit')||can('procurement.requirements.manage')
 const canAttach=canManage&&feature('stock.paper_attachment')
 const serverDrafts=feature('stock.server_drafts')
 const paperOcr=feature('stock.paper_ocr')

 const[cats,setCats]=useState([]),[cat,setCat]=useState(initialFilter==='due'?'':'GENERAL'),[movement,setMovement]=useState(initialFilter==='due'?'':'FAST'),[mainGroup,setMainGroup]=useState(''),[groups,setGroups]=useState([]),[dueOnly,setDueOnly]=useState(feature('stock.cycle_counting'))
 const[items,setItems]=useState([]),[entry,setEntry]=useState({}),[skipped,setSkipped]=useState(new Set()),[cursor,setCursor]=useState(0)
 const[viewMode,setViewMode]=useState('browse'),[filtersOpen,setFiltersOpen]=useState(false),[browsePage,setBrowsePage]=useState(0),[browsePageSize,setBrowsePageSize]=useState(defaultPageSize)
 const[activeBrowseId,setActiveBrowseId]=useState(null),[expandedBrowseId,setExpandedBrowseId]=useState(null)
 const[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[sheetFile,setSheetFile]=useState(null),[dueTotal,setDueTotal]=useState(0),[draftReady,setDraftReady]=useState(false)
 const[ocrBusy,setOcrBusy]=useState(false),[ocrProgress,setOcrProgress]=useState(null),[ocrRows,setOcrRows]=useState([])
 const[historyOpen,setHistoryOpen]=useState(false),[historyRows,setHistoryRows]=useState([]),[historyDetail,setHistoryDetail]=useState(null),[historyLoading,setHistoryLoading]=useState(false)
 const[searchOpen,setSearchOpen]=useState(false),[searchTerm,setSearchTerm]=useState(''),[searchResults,setSearchResults]=useState([]),[searchBusy,setSearchBusy]=useState(false),[searchScope,setSearchScope]=useState('all'),[searchViewport,setSearchViewport]=useState(null)
 const[quickItem,setQuickItem]=useState(null),[quickValue,setQuickValue]=useState(''),[urgentBusy,setUrgentBusy]=useState(false)
 const startedAt=useRef(null),startPromise=useRef(null),quickInput=useRef(null),guidedInput=useRef(null)
 const draftKey='gh-stock-count-draft:'+profile.id
 const rowField=(key,fallback=false)=>{const x=fields?.find(f=>f.module_key==='stock_entry'&&f.field_key===key);return x?x.enabled:fallback}

 useEffect(()=>{(async()=>{try{
  let local={}
  try{local=JSON.parse(localStorage.getItem(draftKey)||'{}')}catch{}
  let chosen=local
  if(serverDrafts){
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
  }
  setEntry(chosen.entry||{});setCursor(Number(chosen.cursor||0));setSkipped(new Set(chosen.skipped||[]));startedAt.current=Number.isFinite(Date.parse(chosen.startedAt||''))?chosen.startedAt:null
  if(chosen.filters){
   if(chosen.filters.cat!==undefined)setCat(chosen.filters.cat)
   if(chosen.filters.movement!==undefined)setMovement(chosen.filters.movement)
   if(chosen.filters.mainGroup!==undefined)setMainGroup(chosen.filters.mainGroup)
   if(chosen.filters.dueOnly!==undefined)setDueOnly(!!chosen.filters.dueOnly)
  }
 }catch(e){fail(e)}finally{if(initialFilter==='due'){setCat('');setMovement('');setMainGroup('');setDueOnly(true)}setDraftReady(true)}})()},[profile.id,serverDrafts,fail])

 useEffect(()=>{
  if(!draftReady)return
  const savedAt=new Date().toISOString()
  const filters={cat,movement,mainGroup,dueOnly}
  const payload={entry,cursor,skipped:[...skipped],startedAt:startedAt.current,filters,savedAt}
  // Save locally immediately so leaving the screen cannot cancel the last keystroke.
  try{localStorage.setItem(draftKey,JSON.stringify(payload))}catch{console.warn('Local stock draft could not be saved')}
  const t=setTimeout(async()=>{
   if(serverDrafts){
    const r=await supabase.from('proc_stock_count_drafts').upsert({
     owner_id:profile.id,entry,skipped:[...skipped],cursor,filters,
     count_started_at:startedAt.current,updated_at:savedAt
    },{onConflict:'owner_id'})
    if(r.error)console.warn('Stock draft autosave failed',r.error)
   }
  },650)
  return()=>clearTimeout(t)
 },[entry,cursor,skipped,cat,movement,mainGroup,dueOnly,draftReady,serverDrafts,profile.id,draftKey])

 useEffect(()=>{(async()=>{try{
  const r=await supabase.rpc('proc_item_filter_options_v1')
  if(r.error)throw r.error
  const data=r.data||{}
  const list=Array.isArray(data.categories)?data.categories:[]
  setCats(list);setGroups(Array.isArray(data.main_groups)?data.main_groups:[])
  if(initialFilter!=='due'&&cat&&list.length&&!list.includes(cat))setCat(list.includes('GENERAL')?'GENERAL':list[0])
 }catch(e){fail(e)}})()},[fail])

 const load=useCallback(async()=>{setLoading(true);try{
  const pageChunk=500
  const cap=dueOnly?dailyTarget:5000
  let all=[],total=0,offset=0
  while(all.length<cap){
   let q=supabase.from('proc_v_stock_check_due').select('*',{count:offset===0?'exact':undefined}).order('next_check_date',{ascending:true}).order('description').range(offset,Math.min(offset+pageChunk-1,cap-1))
   if(cat)q=q.eq('category',cat)
   if(movement)q=q.eq('movement',movement)
   if(mainGroup)q=q.eq('main_group',mainGroup)
   if(dueOnly)q=q.eq('is_due',true)
   const r=await q;if(r.error)throw r.error
   if(offset===0)total=r.count??0
   const batch=r.data||[]
   all=all.concat(batch)
   if(batch.length<pageChunk||all.length>=cap)break
   offset+=pageChunk
  }
  setDueTotal(total||all.length)
  setItems(all)
  setCursor(0);setBrowsePage(0)
 }catch(e){fail(e)}finally{setLoading(false)}},[cat,movement,mainGroup,dueOnly,dailyTarget,fail])
 useEffect(()=>{load()},[load])

 useEffect(()=>{
  if(!searchOpen||typeof window==='undefined'||!window.visualViewport){setSearchViewport(null);return}
  const vv=window.visualViewport
  const update=()=>setSearchViewport({height:Math.round(vv.height),top:Math.round(vv.offsetTop)})
  update()
  vv.addEventListener('resize',update);vv.addEventListener('scroll',update)
  return()=>{vv.removeEventListener('resize',update);vv.removeEventListener('scroll',update)}
 },[searchOpen])

 useEffect(()=>{
  if(!searchOpen){setSearchResults([]);setSearchBusy(false);return}
  const term=searchTerm.trim()
  if(!term){setSearchResults([]);setSearchBusy(false);return}
  const t=setTimeout(async()=>{
   setSearchBusy(true)
   const scoped=searchScope==='current'
   try{
    const r=await supabase.rpc('proc_search_stock_items_v1',{
     p_query:term,
     p_category:scoped?(cat||null):null,
     p_main_group:scoped?(mainGroup||null):null,
     p_movement:scoped?(movement||null):null,
     p_limit:30
    })
    if(!r.error){setSearchResults(r.data||[]);return}

    const safe=term.replace(/[,%()]/g,' ').trim()
    if(!safe){setSearchResults([]);return}
    const pattern='%'+safe+'%'
    let q=supabase.from('proc_items').select('id,item_code,category,brand,description,main_group,subgroup,size,uom,movement,max_stock,reorder_level').eq('active',true)
      .or('item_code.ilike.'+pattern+',description.ilike.'+pattern+',brand.ilike.'+pattern+',category.ilike.'+pattern+',main_group.ilike.'+pattern+',subgroup.ilike.'+pattern+',size.ilike.'+pattern+',uom.ilike.'+pattern)
      .order('description').limit(30)
    if(scoped&&cat)q=q.eq('category',cat)
    if(scoped&&mainGroup)q=q.eq('main_group',mainGroup)
    if(scoped&&movement)q=q.eq('movement',movement)
    const f=await q
    if(f.error)throw f.error
    setSearchResults((f.data||[]).map(x=>({...x,item_id:x.id,book_stock:null,is_due:null})))
   }catch(e){fail(e)}finally{setSearchBusy(false)}
  },160)
  return()=>clearTimeout(t)
 },[searchOpen,searchTerm,searchScope,cat,mainGroup,movement,fail])

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
  const raw=String(v??'')
  if(raw!==''&&!/^\d*(?:\.\d{0,3})?$/.test(raw))return
  beginCount();setEntry(x=>({...x,[id]:raw}));setSkipped(s=>{if(!s.has(id))return s;const n=new Set(s);n.delete(id);return n})
 }
 const suggested=i=>{
  const v=entry[i.item_id]
  if(v===''||v===undefined)return null
  const n=Number(v)
  return Number.isFinite(n)&&n<=Number(i.reorder_level)?Math.max(Number(i.max_stock)-n,0):0
 }
 const completedCount=useMemo(()=>items.filter(i=>entry[i.item_id]!==undefined&&entry[i.item_id]!=='').length,[items,entry])
 const skippedCurrent=useMemo(()=>items.filter(i=>skipped.has(i.item_id)).length,[items,skipped])
 const remainingCount=Math.max(items.length-completedCount-skippedCurrent,0)
 const current=items[Math.min(cursor,Math.max(items.length-1,0))]||null

 function nextUnfinished(from=cursor+1){
  if(!items.length)return
  for(let step=0;step<items.length;step++){
   const idx=(from+step)%items.length,id=items[idx].item_id
   if((entry[id]===undefined||entry[id]==='')&&!skipped.has(id)){setCursor(idx);setTimeout(()=>guidedInput.current?.focus(),40);return}
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
  if(v===undefined||v===''||!Number.isFinite(Number(v))||Number(v)<0)return fail(new Error(t('stock.quantity_continue_error','Enter a valid physical stock quantity before continuing.')))
  if(Number(v)===0&&feature('urgent.zero_stock_prompt',true))await markUrgentNow(current,0,'zero_stock')
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
  if(quickValue===''||!Number.isFinite(Number(quickValue))||Number(quickValue)<0)return fail(new Error(t('stock.quantity_error','Enter a valid physical stock quantity.')))
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

 async function runPaperOcr(){
  if(!sheetFile)return fail(new Error(t('stock.choose_sheet','Choose the completed stock-count sheet first.')))
  setOcrBusy(true);setOcrRows([]);setOcrProgress({stage:'Starting OCR',progress:0})
  try{
   const result=await extractDocumentTextFile(sheetFile,setOcrProgress)
   const candidates=[]
   for(const raw of String(result.rawText||'').split(/\r?\n/)){
    let line=raw.replace(/^\s*\d+[.)-]?\s+/,'').replace(/\s+/g,' ').trim()
    if(line.length<4||/^--- page/i.test(line))continue
    const nums=[...line.matchAll(/(?:^|\s)(\d+(?:\.\d+)?)\s*(?=$|\s)/g)]
    if(!nums.length)continue
    const qtyGuess=Number(nums[0][1])
    const searchText=line.slice(0,nums[0].index).replace(/[|:;-]+$/,'').trim()
    if(searchText.length<3||!Number.isFinite(qtyGuess)||qtyGuess<0)continue
    candidates.push({raw:line,searchText,qty:String(qtyGuess)})
    if(candidates.length>=80)break
   }
   const reviewed=[]
   for(const row of candidates){
    const s=await supabase.rpc('proc_search_stock_items_v1',{p_query:row.searchText,p_category:null,p_main_group:null,p_movement:null,p_limit:3})
    const matches=s.error?[]:(s.data||[])
    reviewed.push({...row,id:globalThis.crypto?.randomUUID?.()||Math.random().toString(36),selected:!!matches[0],match:matches[0]||null,alternatives:matches})
   }
   setOcrRows(reviewed)
   if(!reviewed.length)fail(new Error(t('validation.stock_ocr_none','OCR completed, but no count-like rows were detected. Use a clearer crop/photo or enter the counts manually.')))
   else flash(reviewed.length+' OCR row(s) detected. Review the matches and quantities before applying them.')
  }catch(e){fail(e)}finally{setOcrBusy(false);setOcrProgress(null)}
 }
 function updateOcrRow(id,patch){setOcrRows(v=>v.map(x=>x.id===id?{...x,...patch}:x))}
 function applyOcrCounts(){
  const accepted=ocrRows.filter(x=>x.selected&&x.match&&x.qty!==''&&Number.isFinite(Number(x.qty))&&Number(x.qty)>=0)
  if(!accepted.length)return fail(new Error(t('validation.stock_ocr_select','Select at least one reviewed OCR row.')))
  beginCount()
  setEntry(v=>{const n={...v};accepted.forEach(x=>{n[x.match.item_id]=String(Number(x.qty))});return n})
  flash(accepted.length+' reviewed OCR count(s) applied to the stock-count draft.')
 }

 async function submit(){
  const checked=Object.entries(entry).filter(([,v])=>v!==undefined&&v!=='')
  if(!checked.length)return fail(new Error(t('stock.at_least_one','Enter at least one current-stock quantity.')))
  if(checked.some(([,v])=>!Number.isFinite(Number(v))||Number(v)<0))return fail(new Error(t('stock.negative_error','Stock quantities must be zero or positive numbers.')))
  const submitSuffix=t('stock.submit_confirm_suffix_manual','item(s)? Shortages will go to Procurement Review.')
  if(!confirm(t('stock.submit_confirm_prefix','Submit')+' '+checked.length+' '+submitSuffix))return

  setBusy(true);let path=null
  try{
   if(sheetFile){
    path='stock-counts/'+Date.now()+'-'+sheetFile.name.replace(/[^a-zA-Z0-9._-]/g,'_')
    const u=await supabase.storage.from('gh-procurement').upload(path,sheetFile);if(u.error)throw u.error
   }
   await ensureServerCountStart()
   const lines=checked.map(([item_id,v])=>({item_id,current_stock:Number(v)}))
   const r=await supabase.rpc('proc_submit_stock_and_continue_v3',{p_category:cat||'',p_lines:lines,p_notes:null,p_attachment_path:path})
   if(r.error)throw r.error
   const automation=r.data?.automation||null
   const next={...entry};checked.forEach(([id])=>delete next[id])
   setEntry(next);setSkipped(new Set());setCursor(0)
   if(!Object.keys(next).length){localStorage.removeItem(draftKey);startedAt.current=null;if(serverDrafts)await supabase.from('proc_stock_count_drafts').delete().eq('owner_id',profile.id)}
   setSheetFile(null);setOcrRows([])
   let message='Stock submitted. '
   if(automation?.status==='review_required')message+=(automation.submitted_items||checked.length)+' item(s) saved · '+(automation.requirements||0)+' shortage(s) are waiting in Procurement Review.'
   else if(automation?.status==='no_requirements')message+=(automation.submitted_items||checked.length)+' item(s) saved · no purchase is needed.'
   else message+=checked.length+' item(s) saved for procurement review.'
   flash(message)
   await load()
   if(historyOpen)await loadStockHistory()
  }catch(e){
   if(path)await supabase.storage.from('gh-procurement').remove([path])
   fail(e)
  }finally{setBusy(false)}
 }

 async function discardDraft(){
  if(!Object.keys(entry).length&&!skipped.size)return
  if(!confirm('Discard all unsent stock entries on this device/account?'))return
  setEntry({});setSkipped(new Set());setCursor(0);setSheetFile(null);setOcrRows([]);startedAt.current=null
  localStorage.removeItem(draftKey)
  if(serverDrafts){
   const r=await supabase.from('proc_stock_count_drafts').delete().eq('owner_id',profile.id)
   if(r.error)return fail(r.error)
  }
  flash('Stock draft discarded.')
 }

 async function movementPdf(m){
  try{
   const r=await allRows(()=>{let q=supabase.from('proc_items').select('item_code,category,description,size,max_stock,reorder_level,movement').eq('active',true).eq('movement',m).order('description').order('id');if(cat)q=q.eq('category',cat);if(mainGroup)q=q.eq('main_group',mainGroup);return q});if(r.error)throw r.error
   exportMovementChecklistPdf({items:r.data||[],company,movement:m,category:cat||''})
  }catch(e){fail(e)}
 }
 function stockPdf(){
  exportStockSheetPdf({items:items.map(i=>({...i,id:i.item_id,book_stock:i.book_stock??''})),company,footer,fields,stockTaking:true,title:'STOCK TAKING SHEET',subtitle:[cat||'All Categories',movement||'All Movement',mainGroup||''].filter(Boolean).join(' · ')})
 }

 function submissionTime(v){
  if(!v)return '—'
  try{return new Date(v).toLocaleString(undefined,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return String(v)}
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
  {key:'description',label:'Item',render:i=><strong>{itemTitle(i)}</strong>},
  {key:'uom',label:'UOM'},
  {key:'movement',label:'Movement',render:i=><Badge>{i.movement}</Badge>},
  ...(rowField('reorder_level',true)?[{key:'reorder_level',label:'Reorder',render:i=>qty(i.reorder_level)}]:[]),
  ...(rowField('brand')?[{key:'brand',label:'Brand'}]:[]),
  ...(rowField('item_code')?[{key:'item_code',label:'Code'}]:[]),
  ...(rowField('category')?[{key:'category',label:'Category'}]:[]),
  ...(rowField('main_group')?[{key:'main_group',label:'Main Group'}]:[]),
  ...(rowField('subgroup')?[{key:'subgroup',label:'Sub Group'}]:[]),
  ...(rowField('max_stock')?[{key:'max_stock',label:'Max',render:i=>qty(i.max_stock)}]:[]),
  {key:'current_stock',label:'Stock',render:i=><input className="input stock-entry" inputMode="decimal" enterKeyHint="next" value={entry[i.item_id]??''} onChange={e=>setCount(i.item_id,e.target.value)}/>}
 ]

 return <>
  <div className="card pad stock-work-header">
   <div className="sectionhead"><div><h3>{t('stock.title','Stock Entry')}</h3><p>{t('stock.subtitle','Enter or update the physical quantity, then tap Submit Stock. Each submission is kept in history.')}</p></div><div className="toolbar"><button className={'btn '+(historyOpen?'primary':'')} onClick={()=>{const next=!historyOpen;setHistoryOpen(next);if(next&&!historyRows.length)loadStockHistory()}}>{t('stock.history','History')}</button><button className="btn primary" disabled={busy} onClick={submit}>{busy?t('stock.submitting','Submitting…'):t('stock.submit','Submit Stock')+' · '+Object.values(entry).filter(v=>v!==''&&v!==undefined).length}</button></div></div>
   <div className="stock-simple-flow" aria-label="Stock entry steps"><b>1 · Enter stock</b><span>→</span><b>2 · Submit Stock</b><span>→</span><b>3 · Done</b></div>
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

   <div className="stock-mode-tabs section">
    <button className={'btn '+(viewMode==='guided'?'primary':'')} onClick={()=>setViewMode('guided')}>{t('stock.guided','Guided Count')}</button>
    <button className={'btn '+(viewMode==='browse'?'primary':'')} onClick={()=>setViewMode('browse')}>{t('stock.browse','Fast Entry')}</button>
   </div>

   {!isCounter&&feature('stock.cycle_counting')&&<div className="toolbar section"><button className={'btn '+(dueOnly?'primary':'')} onClick={()=>setDueOnly(true)}>{t('stock.due_today','Due Today')}</button><button className={'btn '+(!dueOnly?'primary':'')} onClick={()=>setDueOnly(false)}>{t('stock.browse_all','Browse All')}</button><span className="muted tiny">{dueOnly?items.length+' '+t('stock.assigned_now','assigned now')+' · '+dueTotal+' '+t('stock.due','due')+' · '+t('stock.daily_target','daily target')+' '+dailyTarget:items.length+' '+t('stock.items_current','item(s) in current browse set')}</span></div>}

   <div className="movement-tabs no-print section"><span className="muted tiny stock-inline-help">{t('stock.movement','Movement')} <InfoButton topic="movement" language={language}/></span>{['FAST','NORMAL','SLOW'].map(m=><button key={m} className={'btn '+(movement===m?'primary':'')} onClick={()=>setMovement(m)}>{m}</button>)}{!isCounter&&<button className={'btn '+(movement===''?'primary':'')} onClick={()=>setMovement('')}>ALL</button>}</div>

   <div className="stock-filter-summary section">
    <div><span className="muted tiny">{t('stock.current_filter','Current filter')}</span><strong>{[cat||t('stock.all_categories','All categories'),mainGroup||t('stock.all_groups','All groups'),movement||t('stock.all_movement','All movement')].join(' · ')}</strong></div>
    <button className="btn" onClick={()=>setFiltersOpen(x=>!x)}>{filtersOpen?t('stock.hide_filters','Hide Filters'):t('stock.filters','Filters')}</button>
   </div>

   {filtersOpen&&<div className="filters three section stock-filter-panel">
    <select className="select" value={cat} onChange={e=>setCat(e.target.value)}><option value="">{t('stock.all_categories','All categories')}</option>{cats.map(x=><option key={x}>{x}</option>)}</select>
    {!isCounter&&<select className="select" value={mainGroup} onChange={e=>setMainGroup(e.target.value)}><option value="">{t('stock.all_groups','All groups')}</option>{groups.map(x=><option key={x}>{x}</option>)}</select>}
    {canAttach&&fieldEnabled(fields,'stock','attachment')&&<label className="file-field"><span>{fieldLabel(fields,'stock','attachment','Completed paper sheet')} (optional)</span><input className="input" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e=>{setSheetFile(e.target.files?.[0]||null);setOcrRows([])}}/></label>}
   </div>}
   {canAttach&&paperOcr&&sheetFile&&<div className="section"><button className="btn" disabled={ocrBusy} onClick={runPaperOcr}>{ocrBusy?t('stock.reading_sheet','Reading sheet…'):t('stock.ocr_completed','OCR Completed Sheet')}</button>{ocrProgress&&<span className="muted tiny"> {ocrProgress.stage} · {Math.round(Number(ocrProgress.progress||0)*100)}%</span>}</div>}
   {ocrRows.length>0&&<div className="card pad section"><div className="sectionhead"><div><h4>{t('stock.paper_review','Paper Count OCR Review')}</h4><p>{t('stock.paper_review_hint','OCR is only a suggestion. Confirm the item and physical quantity before applying.')}</p></div><button className="btn good" onClick={applyOcrCounts}>{t('stock.apply_reviewed','Apply Reviewed Counts')}</button></div><div className="stack">{ocrRows.map(row=><div className="ocr-review-row" key={row.id}><label className={'choice-pill '+(row.selected?'selected-choice':'')}><input type="checkbox" checked={row.selected} onChange={e=>updateOcrRow(row.id,{selected:e.target.checked})}/>{t('stock.use','Use')}</label><div><strong>{row.match?itemTitle(row.match):'No confident match'}</strong><div className="muted tiny">{row.raw}</div></div><select className="select" value={row.match?.item_id||''} onChange={e=>{const m=row.alternatives.find(x=>x.item_id===e.target.value)||null;updateOcrRow(row.id,{match:m,selected:!!m})}}><option value="">{t('stock.choose_item','Choose item…')}</option>{row.alternatives.map(m=><option key={m.item_id} value={m.item_id}>{itemTitle(m)} · {m.item_code}</option>)}</select><input className="input stock-entry" inputMode="decimal" value={row.qty} onChange={e=>updateOcrRow(row.id,{qty:e.target.value})}/></div>)}</div></div>}

   {canManage&&feature('stock.paper_checklists')&&filtersOpen&&<div className="toolbar section no-print"><button className="btn" onClick={()=>movementPdf('FAST')}>FAST Checklist PDF</button><button className="btn" onClick={()=>movementPdf('NORMAL')}>NORMAL Checklist PDF</button><button className="btn" onClick={()=>movementPdf('SLOW')}>SLOW Checklist PDF</button><button className="btn" onClick={stockPdf}>Stock Taking PDF</button></div>}
  </div>

  {viewMode==='guided'&&<div className="card pad section guided-count-shell">{loading?<Empty>{t('stock.preparing','Preparing your count queue…')}</Empty>:!current?<Empty>{t('stock.none_due','No items are due in this selection.')}</Empty>:<>
   <div className="guided-progress-head"><div><strong>{completedCount} counted</strong><span>{skippedCurrent} {t('stock.skipped','skipped')} · {remainingCount} {t('stock.remaining','remaining')}</span></div><b>{cursor+1} / {items.length}</b></div>
   <div className="guided-progress"><i style={{width:(items.length?Math.min(100,(completedCount/items.length)*100):0)+'%'}}/></div>

   <div className="guided-item">
    <div className="stock-card-title"><div><h2 title={itemTitle(current)}>{itemTitle(current)}</h2></div><Badge>{current.movement}</Badge></div>
    <div className="guided-meta">{[current.brand,current.uom].filter(Boolean).map(x=><span key={x}>{x}</span>)}{rowField('reorder_level',true)&&<span>R: {qty(current.reorder_level)}</span>}</div>
    <div className="guided-entry"><label>{t('stock.physical','Physical Stock')}</label><input ref={guidedInput} className="input" inputMode="decimal" enterKeyHint="next" value={entry[current.item_id]??''} onChange={e=>setCount(current.item_id,e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveNext()}}} placeholder="Enter quantity"/></div>
    {!isCounter&&<div className="guided-stats"><div><span>{t('stock.max','Maximum Stock')} <InfoButton topic="maximum_stock" language={language}/></span><b>{qty(current.max_stock)}</b></div><div><span>{t('stock.reorder','Reorder Level')} <InfoButton topic="reorder_level" language={language}/></span><b>{qty(current.reorder_level)}</b></div><div><span>{t('stock.suggested','Suggested')}</span><b className="warn-text">{suggested(current)===null?'—':qty(suggested(current))}</b></div></div>}
    {Number(entry[current.item_id])===0&&entry[current.item_id]!==''&&entry[current.item_id]!==undefined&&<div className="urgent-zero-notice"><b>{t('stock.zero_detected','Zero stock detected')}</b><span>{t('stock.zero_push_urgent','This item will be pushed to Urgent Actions when you continue.')}</span></div>}
    <div className="guided-actions"><button className="btn" onClick={previous}>{t('common.previous','Previous')}</button><button className="btn" onClick={skipCurrent}>{t('stock.skip','Skip')}</button><button className="btn primary" onClick={saveNext}>{t('stock.save_next','Save & Next')}</button></div>
   </div>
  </>}</div>}

  {viewMode==='browse'&&<div className="card pad section stock-fast-panel">{loading?<Empty>{t('common.loading','Loading…')}</Empty>:browseItems.length===0?<Empty>{t('stock.no_items','No items in this queue.')}</Empty>:<>
   <div className="stock-fast-head">
    <div><h3>{t('stock.browse','Fast Entry')}</h3><p><b>{completedCount}</b> {t('stock.counted','entered')} · <b>{Math.max(items.length-completedCount,0)}</b> {t('stock.pending','not entered')}</p></div>
    <div className="stock-page-tools">
     <label><span>{t('stock.page_size','Rows per page')}</span><select className="select dense-page-select" value={browsePageSize} onChange={e=>{setBrowsePageSize(Number(e.target.value));setBrowsePage(0)}}>{allowedPageSizes.map(n=><option key={n} value={n}>{n}</option>)}</select></label>
     <label><span>{t('stock.jump','Jump to page')}</span><select className="select dense-page-select" value={browsePage} onChange={e=>setBrowsePage(Number(e.target.value))}>{Array.from({length:browsePages},(_,n)=><option key={n} value={n}>{n+1}</option>)}</select></label>
    </div>
   </div>
   <div className="stock-pagination dense-pagination"><button className="btn small" disabled={browsePage<=0} onClick={()=>setBrowsePage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><strong>{t('common.page','Page')} {browsePage+1} {t('common.of','of')} {browsePages}</strong><button className="btn small" disabled={browsePage>=browsePages-1} onClick={()=>setBrowsePage(x=>Math.min(browsePages-1,x+1))}>{t('common.next','Next')}</button></div>
   <div className="desktop-table tablewrap"><table className="table"><thead><tr>{cols.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{browseItems.map(i=><tr key={i.item_id} className={entry[i.item_id]!==undefined&&entry[i.item_id]!==''?'selected':''}>{cols.map(c=><td key={c.key}>{c.render?c.render(i):String(i[c.key]??'—')}</td>)}</tr>)}</tbody></table></div>
   <div className="mobile-card-list browse-entry-list stock-dense-list">
    <div className="stock-dense-columns"><span>{t('stock.item','ITEM')}</span><span>{t('stock.stock','STOCK')}</span></div>
    {browseItems.map((i,index)=>{
     const entered=entry[i.item_id]!==undefined&&entry[i.item_id]!==''
     const expanded=expandedBrowseId===i.item_id
     const optional=[
      rowField('reorder_level',true)?'R:'+qty(i.reorder_level):null,
      rowField('brand')?i.brand:null,
      rowField('item_code')?i.item_code:null,
      rowField('category')?i.category:null,
      rowField('main_group')?i.main_group:null,
      rowField('subgroup')?i.subgroup:null,
      rowField('max_stock')?'MAX:'+qty(i.max_stock):null
     ].filter(Boolean)
     return <div id={'browse-row-'+i.item_id} className={'stock-dense-row '+(entered?'entered ':'pending ')+(activeBrowseId===i.item_id?'active ':'')+(expanded?'expanded':'')} key={i.item_id}>
      <button type="button" className="stock-dense-info" title={itemTitle(i)} onClick={()=>setExpandedBrowseId(x=>x===i.item_id?null:i.item_id)}>
       <span className="stock-dense-title">{itemTitle(i)}</span>
       <span className="stock-dense-meta"><span className={'mini-movement '+String(i.movement||'').toLowerCase()}>{i.movement}</span><span>{i.uom}</span>{optional.map((x,n)=><span key={n}>{x}</span>)}</span>
      </button>
      <div className="stock-dense-input-wrap">{entered&&<span className="entry-check">✓</span>}<input id={'browse-stock-'+i.item_id} aria-label={itemTitle(i)+' '+t('stock.stock','Stock')} className="input browse-stock-input dense-stock-input" inputMode="decimal" enterKeyHint="next" autoComplete="off" value={entry[i.item_id]??''} onFocus={e=>{e.currentTarget.select();focusDenseInput(i)}} onBlur={()=>setActiveBrowseId(x=>x===i.item_id?null:x)} onChange={e=>setCount(i.item_id,e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();focusBrowseNext(index)}}} placeholder="0"/></div>
     </div>
    })}
   </div>
   <div className="stock-pagination dense-pagination bottom"><button className="btn small" disabled={browsePage<=0} onClick={()=>setBrowsePage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><strong>{t('common.page','Page')} {browsePage+1} {t('common.of','of')} {browsePages}</strong><button className="btn small" disabled={browsePage>=browsePages-1} onClick={()=>setBrowsePage(x=>Math.min(browsePages-1,x+1))}>{t('common.next','Next')}</button></div>
   <div className="stock-draft-note"><span>✓</span><span>{t('stock.saved_draft','Your entered values are saved automatically while you work.')}</span>{(Object.keys(entry).length>0||skipped.size>0)&&<button type="button" className="btn small bad" onClick={discardDraft}>Discard Draft</button>}</div>
  </>}</div>}

  {searchOpen&&<div className="stock-search-overlay" style={searchViewport?{height:searchViewport.height+'px',top:searchViewport.top+'px'}:undefined}>
   <div className="stock-search-panel">
    <div className="stock-search-top">
     <button className="btn small" onClick={()=>setSearchOpen(false)}>←</button>
     <input id="stock-global-search" className="input stock-search-input" autoComplete="off" inputMode="search" enterKeyHint="search" placeholder={t('stock.search_placeholder','Search e.g. 6mm, GI elbow, item code…')} value={searchTerm} onChange={e=>setSearchTerm(e.target.value)}/>
     {searchTerm&&<button className="btn small" onClick={()=>setSearchTerm('')}>{t('common.clear','Clear')}</button>}
    </div>
    <div className="stock-search-scope"><button className={'choice-pill '+(searchScope==='all'?'selected-choice':'')} onClick={()=>setSearchScope('all')}>{t('stock.all_items','All Items')}</button><button className={'choice-pill '+(searchScope==='current'?'selected-choice':'')} onClick={()=>setSearchScope('current')}>{t('stock.current_filters','Current Filters')}</button></div>
    <div className="stock-search-results">{!searchTerm.trim()?<Empty>{t('stock.search_start','Start typing. Results appear here immediately above the keyboard.')}</Empty>:searchBusy?<Empty>{t('stock.searching','Searching all items…')}</Empty>:searchResults.length===0?<Empty>{t('stock.no_match','No matching items. Try item code, brand, size or part of the name.')}</Empty>:searchResults.map(i=><button className="stock-search-result" key={i.item_id} onClick={()=>openQuick(i)}>
      <div><strong>{itemTitle(i)}</strong><span>{[i.brand,i.uom].filter(Boolean).join(' · ')}</span><small>{[i.category].filter(Boolean).join(' › ')}</small></div>
      <div className="right"><Badge>{i.movement}</Badge>{rowField('reorder_level',true)&&<small>R: {qty(i.reorder_level)}</small>}</div>
     </button>)}</div>
   </div>
  </div>}

  {quickItem&&<div className="modal-backdrop stock-quick-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setQuickItem(null)}}>
   <div className="modal stock-quick-modal card">
    <div className="modal-head"><div><h3>{itemTitle(quickItem)}</h3></div><button className="btn small" onClick={()=>setQuickItem(null)}>✕</button></div>
    <div className="guided-meta">{[quickItem.brand,quickItem.uom,quickItem.category].filter(Boolean).map(x=><span key={x}>{x}</span>)}</div>
    {!isCounter&&<div className="guided-stats section"><div><span>{t('stock.max','Maximum Stock')} <InfoButton topic="maximum_stock" language={language}/></span><b>{qty(quickItem.max_stock)}</b></div><div><span>{t('stock.reorder','Reorder Level')} <InfoButton topic="reorder_level" language={language}/></span><b>{qty(quickItem.reorder_level)}</b></div></div>}
    <div className="guided-entry section"><label>{t('stock.physical','Physical Stock')}</label><input ref={quickInput} className="input" inputMode="decimal" enterKeyHint="done" value={quickValue} onChange={e=>setQuickValue(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();saveQuick(Number(quickValue)===0)}}} placeholder="Enter quantity"/></div>
    {Number(quickValue)===0&&quickValue!==''&&<div className="urgent-zero-notice section"><b>{t('stock.zero','Zero stock')}</b><span>{t('stock.zero_hint','Zero is valid and can be marked urgent.')}</span></div>}
    <div className="toolbar section">{Number(quickValue)===0&&quickValue!==''?<><button className="btn primary" disabled={urgentBusy} onClick={()=>saveQuick(true)}>{urgentBusy?t('stock.marking','Marking…'):t('stock.save_mark_urgent','Save + Mark Urgent')}</button><button className="btn" onClick={()=>saveQuick(false)}>{t('stock.save_only','Save Only')}</button></>:<><button className="btn primary" onClick={()=>saveQuick(false)}>{t('stock.save_stock','Save Stock')}</button><button className="btn warn" disabled={urgentBusy} onClick={async()=>{if(await markUrgentNow(quickItem,quickValue===''?null:Number(quickValue)))setQuickItem(null)}}>{t('stock.mark_urgent','Mark Urgent')}</button></>}<button className="btn" onClick={()=>setQuickItem(null)}>{t('common.cancel','Cancel')}</button></div>
   </div>
  </div>}
 </>
}

export function Items({profile,fields,flash,fail,can=()=>false,t=(k,f)=>f||k}){
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
  let value=v
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

 const editableText=(r,key,wide=false)=>
  canEdit?<input className={'input item-inline-edit '+(wide?'wide':'')} defaultValue={r[key]||''} list={key==='category'?'item-master-categories':undefined} onBlur={e=>{if(String(e.target.value??'')!==String(r[key]??''))save(r,key,e.target.value)}}/>:(r[key]||'—')

 const defaults=[
  {key:'active',label:'Enabled',render:r=>canEdit?<button className={'btn small '+(r.active?'good':'')} onClick={()=>save(r,'active',!r.active)}>{r.active?'Enabled':'Disabled'}</button>:<Badge>{r.active?'enabled':'disabled'}</Badge>},
  {key:'item_code',label:'Code',render:r=><span className="mono">{r.item_code}</span>},
  {key:'category',label:'Category',render:r=>editableText(r,'category')},
  {key:'brand',label:'Brand',render:r=>editableText(r,'brand')},
  {key:'description',label:'Description',render:r=><div className="item-master-title"><strong>{itemTitle(r)}</strong>{canEdit&&<input className="input item-inline-edit" defaultValue={r.description||''} onBlur={e=>{if(e.target.value!==r.description)save(r,'description',e.target.value)}}/>}</div>},
  {key:'main_group',label:'Main Group',render:r=>editableText(r,'main_group')},
  {key:'subgroup',label:'Subgroup',render:r=>editableText(r,'subgroup')},
  {key:'size',label:'Size',render:r=>editableText(r,'size')},
  {key:'uom',label:'UOM',render:r=>editableText(r,'uom')},
  {key:'movement',label:'Movement',render:r=>canEdit?<select className="select compact-select" value={r.movement} onChange={e=>save(r,'movement',e.target.value)}><option>FAST</option><option>NORMAL</option><option>SLOW</option></select>:<Badge>{r.movement}</Badge>},
  {key:'max_stock',label:'Max Stock',render:r=>canEdit?<input className="input stock-entry" defaultValue={r.max_stock} inputMode="decimal" onBlur={e=>save(r,'max_stock',e.target.value)}/>:qty(r.max_stock)},
  {key:'reorder_level',label:'Reorder At',render:r=>qty(r.reorder_level)},
  {key:'remarks',label:'Remarks',render:r=>editableText(r,'remarks',true)}
 ]
 const cols=configuredColumns(fields,'items',defaults)

 return <div className="card pad">
  <datalist id="item-master-categories">{cats.map(c=><option key={c} value={c}/>)}</datalist>
  <div className="sectionhead"><div><h3>{t('items.title','Item Master')}</h3><p>{t('items.subtitle','Edit approved item details, move items between categories or FAST/NORMAL/SLOW, and enable/disable products without deleting their history.')}</p></div><div className="toolbar"><input className="input toolbar-input" placeholder={t('items.search','Search item, size, brand or group')} value={q} onChange={e=>setQ(e.target.value)}/><select className="select toolbar-select" value={cat} onChange={e=>setCat(e.target.value)}><option value="">{t('stock.all_categories','All categories')}</option>{cats.map(c=><option key={c}>{c}</option>)}</select><select className="select toolbar-select" value={status} onChange={e=>setStatus(e.target.value)}><option value="active">{t('items.enabled_items','Enabled items')}</option><option value="inactive">{t('items.disabled_items','Disabled items')}</option><option value="all">{t('items.all_items','All items')}</option></select></div></div>
  {canEdit&&<div className="notice"><b>{t('items.quick_edit','Quick edit is on.')}</b> {t('items.quick_edit_hint','Change Description, Size, Category, Movement or Max Stock directly. Reorder level remains formula-controlled by movement.')}</div>}
  {loading?<Empty>{t('items.loading','Loading item master…')}</Empty>:<><div className="section"><DataTable columns={cols} rows={filtered} mobileCards/></div><div className="toolbar section"><button className="btn" disabled={page<=0} onClick={()=>setPage(x=>Math.max(0,x-1))}>{t('common.previous','Previous')}</button><span className="muted tiny">{total?((page*pageSize)+1):0}–{Math.min((page+1)*pageSize,total)} {t('common.of','of')} {total}</span><button className="btn" disabled={(page+1)*pageSize>=total} onClick={()=>setPage(x=>x+1)}>{t('common.next','Next')}</button></div></>}
 </div>
}

