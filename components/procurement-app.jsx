'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import dynamic from 'next/dynamic'
import {supabase} from '@/lib/supabase'
import {interfaceVariables} from '@/lib/procurement-journey.mjs'
import {stepForView,viewForStep} from '@/lib/workflow-guide.mjs'
import {NAV,Err,WorkflowNavigation} from './ui'
import {LoginScreen,ChangePassword} from './auth-screen'
import {createTranslator,navText} from '@/lib/i18n'
import {HelpCenter} from './help-ui'
import {withStartupDeadline} from '@/lib/workspace-startup.mjs'
import {AccessBoundary} from './access-boundary'
import {CaptureSession} from './capture-settings'

// Keep purchasing and PDF code out of the initial sign-in download.
const screenLoading=()=> <p role="status">Loading screen…</p>
const Dashboard=dynamic(()=>import('./modules-stock').then(m=>m.Dashboard),{loading:screenLoading})
const StockCheck=dynamic(()=>import('./modules-stock').then(m=>m.StockCheck),{loading:screenLoading})
const Items=dynamic(()=>import('./modules-stock').then(m=>m.Items),{loading:screenLoading})
const Requirements=dynamic(()=>import('./modules-buying').then(m=>m.Requirements),{loading:screenLoading})
const Suppliers=dynamic(()=>import('./modules-buying').then(m=>m.Suppliers),{loading:screenLoading})
const Rfqs=dynamic(()=>import('./modules-buying').then(m=>m.Rfqs),{loading:screenLoading})
const UrgentActions=dynamic(()=>import('./modules-urgent').then(m=>m.UrgentActions),{loading:screenLoading})
const CompanyLists=dynamic(()=>import('./modules-company').then(m=>m.CompanyLists),{loading:screenLoading})
const CompanyPriceLists=dynamic(()=>import('./modules-company').then(m=>m.CompanyPriceLists),{loading:screenLoading})
const PurchaseOrders=dynamic(()=>import('./modules-documents').then(m=>m.PurchaseOrders),{loading:screenLoading})
const Invoices=dynamic(()=>import('./modules-documents').then(m=>m.Invoices),{loading:screenLoading})
const Receiving=dynamic(()=>import('./modules-documents').then(m=>m.Receiving),{loading:screenLoading})
const Reports=dynamic(()=>import('./modules-admin').then(m=>m.Reports),{loading:screenLoading})
const Admin=dynamic(()=>import('./modules-admin').then(m=>m.Admin),{loading:screenLoading})

export default function ProtectedProcurementApp(){
 return <><CaptureSession/><AccessBoundary><ProcurementApp/></AccessBoundary></>
}

function ProcurementApp(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[view,setView]=useState('dashboard')
 const[viewFilters,setViewFilters]=useState({}),[viewKeys,setViewKeys]=useState({})
 const[visited,setVisited]=useState(()=>new Set(['dashboard']))
 const activeScreen=useRef(view);activeScreen.current=view
 const[navigation,setNavigation]=useState({filter:'',revision:0})
 const[guide,setGuide]=useState({step:1,revision:0}),[guideRfqId,setGuideRfqId]=useState('')
 const[boot,setBoot]=useState(true),[notice,setNotice]=useState(''),[error,setError]=useState(''),[recovery,setRecovery]=useState(false)
 const[bootError,setBootError]=useState(''),[startupAttempt,setStartupAttempt]=useState(0)
 const[modules,setModules]=useState([]),[fields,setFields]=useState([]),[features,setFeatures]=useState([]),[settings,setSettings]=useState({})
 const[permissions,setPermissions]=useState(new Set()),[permissionsLoaded,setPermissionsLoaded]=useState(false),[language,setLanguage]=useState(()=>typeof window!=='undefined'?(localStorage.getItem('gh-procurement-language')||'en'):'en')
 const[mobileMenu,setMobileMenu]=useState(false),[securityOpen,setSecurityOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false)
 const[screenHistory,setScreenHistory]=useState({entries:[{view:'dashboard',filter:''}],index:0})
 const workContent=useRef(null)
 useEffect(()=>{
  if(boot||!workContent.current)return
  const screen=workContent.current.querySelector('section:not([hidden])')
  if(!screen||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return
  const motion=screen.animate?.([{opacity:0.45},{opacity:1}],{duration:180,easing:'ease-out'})
  return()=>motion?.cancel()
 },[view,guide.step,boot])
 useEffect(()=>{
  if(!mobileMenu)return
  const previous=document.activeElement,overflow=document.body.style.overflow
  const drawer=document.querySelector('.mobile-drawer')
  const buttons=()=>[...drawer.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled)')]
  buttons()[0]?.focus();document.body.style.overflow='hidden'
  const keydown=e=>{
   if(e.key==='Escape'){e.preventDefault();setMobileMenu(false)}
   if(e.key==='Tab'){const targets=buttons(),first=targets[0],last=targets.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
  }
  document.addEventListener('keydown',keydown)
  return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);if(previous?.isConnected)previous.focus()}
 },[mobileMenu])
 const historyRef=useRef(screenHistory)
 const scrollPositions=useRef({})
 useEffect(()=>{const id=requestAnimationFrame(()=>window.scrollTo(0,scrollPositions.current[view]||0));return()=>cancelAnimationFrame(id)},[view])
 const lastActivity=useRef(Date.now()),noticeTimer=useRef(null),errorTimer=useRef(null)
 const hydratedUser=useRef(null)

 const ensure=useCallback(async s=>{
  const x=await supabase.from('proc_profiles').select('*').eq('id',s.user.id).maybeSingle()
  if(x.error)throw x.error
  if(x.data){if(!x.data.active)throw new Error('Your GH Procurement access is disabled.');return {next:x.data,created:false}}
  const r=await supabase.rpc('proc_ensure_profile')
  if(r.error)throw r.error
  const p=Array.isArray(r.data)?r.data[0]:r.data
  if(!p?.active)throw new Error('Your GH Procurement access is disabled.');return {next:p,created:true}
 },[])

 const loadPermissions=useCallback(async()=>{
  const r=await supabase.rpc('proc_my_permissions_v1')
  if(r.error)throw r.error
  return new Set((r.data||[]).map(x=>typeof x==='string'?x:x.permission_key).filter(Boolean))
 },[])

 const loadConfig=useCallback(async()=>{
  const[a,b,c,d]=await Promise.all([
   supabase.from('proc_module_settings').select('*').order('sort_order'),
   supabase.from('proc_field_settings').select('*').order('module_key').order('sort_order'),
   supabase.from('proc_feature_settings').select('*').order('group_key').order('sort_order'),
   supabase.from('proc_settings').select('key,value')
  ])
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error
  return {modules:a.data||[],fields:b.data||[],features:c.data||[],settings:Object.fromEntries((d.data||[]).map(x=>[x.key,x.value]))}
 },[])
 const applyConfig=useCallback(config=>{
  for(const [setting,prefix] of [['stock_reset_revision','gh-stock-count-draft:'],['procurement_reset_revision','gh_receiving_draft_v1:']]){
   const revision=config.settings[setting]
   if(revision&&localStorage.getItem('gh-'+setting)!==revision){
    for(const key of Object.keys(localStorage)){if(key.startsWith(prefix))localStorage.removeItem(key)}
    localStorage.setItem('gh-'+setting,revision)
   }
  }
  setModules(config.modules);setFields(config.fields);setFeatures(config.features);setSettings(config.settings)},[])

 useEffect(()=>{
  let cancelled=false,authReady=false
  const setupPage=new URLSearchParams(window.location.search).get('recovery')==='1'
  if(setupPage){setRecovery(true);setBoot(false)}
  const timer=setTimeout(()=>{if(!cancelled&&!authReady&&!setupPage){setBootError('Sign-in is taking too long to respond. Check your connection and try again.');setBoot(false)}},15000)
  const receiveSession=(event,s)=>{
   if(cancelled)return
   authReady=true;clearTimeout(timer);setBootError('')
   if(event==='PASSWORD_RECOVERY'){setRecovery(true);setBoot(false)}
   setSession(s)
   if(!s){const initialHistory={entries:[{view:'dashboard',filter:''}],index:0};historyRef.current=initialHistory;setScreenHistory(initialHistory);setView('dashboard');setGuide({step:1,revision:0});setGuideRfqId('');setVisited(new Set(['dashboard']));setViewFilters({});setViewKeys({});scrollPositions.current={};hydratedUser.current=null;setProfile(null);setModules([]);setFields([]);setFeatures([]);setSettings({});setPermissions(new Set());setPermissionsLoaded(false);setBoot(false)}
  }
  // Keep this callback synchronous: Supabase holds its auth lock while it runs.
  const{data}=supabase.auth.onAuthStateChange(receiveSession)
  // Also resolve explicitly in case the initial auth event is delayed or missed.
  supabase.auth.getSession().then(({data,error})=>{
   if(error)throw error
   if(!authReady)receiveSession('INITIAL_SESSION',data.session)
  }).catch(e=>{
   if(!cancelled&&!authReady){clearTimeout(timer);setBootError(e.message);setBoot(false)}
  })
  return()=>{cancelled=true;clearTimeout(timer);data.subscription.unsubscribe()}
 },[startupAttempt])

 useEffect(()=>{
  if(recovery){setBoot(false);return}
  if(!session)return
  let cancelled=false
  const initial=hydratedUser.current!==session.user.id
  if(initial){setBoot(true);setBootError('');setProfile(null);setPermissions(new Set());setPermissionsLoaded(false);lastActivity.current=Date.now()}
  async function hydrate(){
   try{
    const {next,config,allowed}=await withStartupDeadline((async()=>{
     const [{next,created},initialAllowed,config]=await Promise.all([
      ensure(session),loadPermissions(),loadConfig()
     ])
     // Invited accounts already have a profile. Only legacy provisioning needs
     // a second permissions read after its profile has actually been created.
     const allowed=created?await loadPermissions():initialAllowed
     return {next,allowed,config}
    })())
    if(!cancelled){applyConfig(config);setPermissions(allowed);setPermissionsLoaded(true);setProfile(next);hydratedUser.current=session.user.id;setError('')}
    // Invitation bookkeeping must not delay access to the workspace.
    if(!cancelled)supabase.rpc('proc_mark_own_invite_accepted').then(r=>{if(r.error)console.warn('Invite acceptance status not updated',r.error)}).catch(()=>{})
   }catch(e){if(!cancelled){hydratedUser.current=null;setProfile(null);setPermissions(new Set());setPermissionsLoaded(false);setError(e.message)}}
   finally{if(!cancelled)setBoot(false)}
  }
  hydrate()
  return()=>{cancelled=true}
 },[session,recovery,ensure,loadConfig,loadPermissions,applyConfig,startupAttempt])

 useEffect(()=>{
  if(!session||!profile)return
  const touch=()=>{lastActivity.current=Date.now()}
  const events=['pointerdown','keydown','touchstart','scroll']
  events.forEach(e=>window.addEventListener(e,touch,{passive:true}))
  const id=setInterval(async()=>{
   const mins=Math.max(10,Number(settings.security_idle_minutes||60))
   if(Date.now()-lastActivity.current>mins*60000){
    setNotice(createTranslator(language)('app.signed_out_idle','You were signed out after a period of inactivity.'))
    await supabase.auth.signOut()
   }
  },30000)
  return()=>{clearInterval(id);events.forEach(e=>window.removeEventListener(e,touch))}
 },[session,profile,settings.security_idle_minutes])

 const flash=useCallback(m=>{
  if(noticeTimer.current)window.clearTimeout(noticeTimer.current)
  if(errorTimer.current)window.clearTimeout(errorTimer.current)
  setNotice(m);setError('')
  noticeTimer.current=window.setTimeout(()=>setNotice(''),4200)
 },[])
 const fail=useCallback(e=>{
  console.error(e)
  if(errorTimer.current)window.clearTimeout(errorTimer.current)
  if(noticeTimer.current)window.clearTimeout(noticeTimer.current)
  setError(e?.message||String(e));setNotice('')
 },[])
 const refreshConfig=useCallback(async()=>{const user=hydratedUser.current;try{const config=await loadConfig();if(user&&hydratedUser.current===user)applyConfig(config)}catch(e){fail(e)}},[loadConfig,applyConfig,fail])

 useEffect(()=>{
  if(!profile||typeof window==='undefined')return
  const saved=localStorage.getItem('gh-procurement-language')
  const next=profile.language||saved||'en'
  setLanguage(next==='ta'?'ta':'en')
 },[profile])

 useEffect(()=>{
  if(typeof document!=='undefined')document.documentElement.lang=language==='ta'?'ta':'en'
 },[language])

 const t=useMemo(()=>createTranslator(language),[language])
 const can=useCallback(key=>{
  if(permissionsLoaded)return permissions.has(key)
  return false
 },[permissions,permissionsLoaded,profile])

 const setAppLanguage=useCallback(async next=>{
  const lang=next==='ta'?'ta':'en'
  setLanguage(lang)
  if(typeof window!=='undefined')localStorage.setItem('gh-procurement-language',lang)
  try{
   const r=await supabase.rpc('proc_set_my_language_v1',{p_language:lang})
   if(r.error)throw r.error
   setProfile(p=>p?{...p,language:lang}:p)
  }catch(e){fail(e)}
 },[fail])

 const visibleNav=useMemo(()=>{
  if(!profile)return[]
  const db=modules.length?modules:NAV.map((n,i)=>({module_key:n[0],label:n[2],enabled:true,sort_order:(i+1)*10,allowed_roles:['admin','procurement','stock_handler','stock_checker','document_assistant','receiver','viewer']}))
  const permissionFor={
   dashboard:'dashboard.view',stock:'stock.count.view',urgent_actions:'urgent.view',requirements:'procurement.requirements.view',
   company_lists:'company_lists.view',suppliers:'suppliers.view',price_lists:'price_lists.view',rfq:'procurement.rfq.view',
   po:'procurement.orders.view',invoices:'invoices.view',receiving:'receiving.view',items:'items.view',reports:'reports.view'
  }
  const allowed=m=>{
   if(!m.enabled)return false
   if(m.module_key==='admin')return can('admin.users.manage')||can('admin.roles.manage')||can('admin.configure_app')||can('admin.audit.view')
   const key=permissionFor[m.module_key]
   if(permissionsLoaded&&key)return can(key)
   return (m.allowed_roles||[]).includes(profile.role)
  }
  return db.filter(allowed).sort((a,b)=>a.sort_order-b.sort_order).map(m=>{
   const base=NAV.find(n=>n[0]===m.module_key)||[m.module_key,'•',m.label]
   return [m.module_key,base[1],navText(m.module_key,m.label,language)]
  })
 },[modules,profile,permissionsLoaded,can,language])

 const roleKey=String(profile?.role_key||profile?.role||'')
 const primaryKeys=useMemo(()=>{
  if(['stock_checker','stock_handler'].includes(roleKey))return ['dashboard','stock','urgent_actions']
  if(roleKey==='receiver')return ['dashboard','receiving']
  if(roleKey==='document_assistant')return ['dashboard','price_lists']
  if(roleKey==='viewer')return ['dashboard']
  if(['admin','procurement'].includes(roleKey))return ['dashboard','stock','requirements','rfq','po','receiving']
  return ['dashboard','requirements','rfq','po']
 },[roleKey])
 const primaryNav=useMemo(()=>primaryKeys.map(k=>visibleNav.find(n=>n[0]===k)).filter(Boolean),[primaryKeys,visibleNav])
 const secondaryNav=useMemo(()=>visibleNav.filter(n=>!primaryKeys.includes(n[0])),[visibleNav,primaryKeys])
 const mobileQuickNav=useMemo(()=>{
  if(['admin','procurement'].includes(roleKey))return ['stock','rfq','po','receiving'].map(k=>visibleNav.find(n=>n[0]===k)).filter(Boolean)
  return primaryNav.slice(0,4)
 },[primaryNav,roleKey,visibleNav])

 useEffect(()=>{
  if(!profile||!visibleNav.length)return
  if(visibleNav.some(n=>n[0]===view))return
  // Restricted roles may not have Dashboard access. Selecting the correct
  // view alone will not render lazy screens: the screen must be marked visited.
  const next=primaryNav[0]?.[0]||visibleNav[0][0]
  setVisited(current=>new Set([...current,next]))
  const initialHistory={entries:[{view:next,filter:''}],index:0}
  historyRef.current=initialHistory
  setScreenHistory(initialHistory)
  setView(next);setGuide(g=>({step:stepForView(next),revision:g.revision+1}))
 },[visibleNav,primaryNav,view,profile])
 const[lastWork,setLastWork]=useState(null)
 useEffect(()=>{if(!profile?.id)return;try{const saved=JSON.parse(localStorage.getItem('gh-last-work:'+profile.id)||'null');setLastWork(saved)}catch{}},[profile?.id])
 useEffect(()=>{if(!profile?.id||!['stock','requirements','rfq','po'].includes(view))return;const work={view,step:guide.step,filter:view==='rfq'?(guideRfqId||viewFilters[view]||''):(viewFilters[view]||'')};try{localStorage.setItem('gh-last-work:'+profile.id,JSON.stringify(work));setLastWork(work)}catch{}},[profile?.id,view,guide.step,guideRfqId,viewFilters])
 const hasAuthorizedWorkspace=visibleNav.length>0

 if(recovery)return <LoginScreen initialError={error}/>
 const retryStartup=()=>{setBootError('');setError('');setBoot(true);setStartupAttempt(x=>x+1)}
 if(boot)return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>GH Procurement</h1><p>{t('app.loading_secure','Loading secure workspace…')}</p></div></div>
 if(bootError)return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>Connection interrupted</h1><p>{bootError}</p><button className="btn primary" onClick={retryStartup}>Retry</button></div></div>
 if(!session)return <LoginScreen initialError={error}/>
 if(!profile)return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>{t('app.access_unavailable','Access unavailable')}</h1><p>{error||t('app.account_not_enabled','Your account is not enabled for GH Procurement.')}</p><div className="row"><button className="btn primary" onClick={retryStartup}>Retry</button><button className="btn" onClick={()=>supabase.auth.signOut()}>{t('common.sign_out','Sign out')}</button></div></div></div>
 if(!hasAuthorizedWorkspace)return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>No permitted workspace</h1><p>Your account is active, but no procurement screens are currently enabled for your role. Ask an administrator to review your role permissions.</p><div className="row"><button className="btn primary" onClick={retryStartup}>Retry</button><button className="btn" onClick={()=>supabase.auth.signOut()}>Sign out</button></div></div></div>

 const title=visibleNav.find(x=>x[0]===view)?.[2]||'GH Procurement'
 const company=settings.company_profile||{name:'General Hardware',town:'Nawalapitiya',country:'Sri Lanka'}
 const footer=settings.pdf_footer||'Generated by GH Procurement'
 function showScreen(k,filter='',restore=false,step=stepForView(k)){
  setGuide(v=>({step,revision:v.revision+1}))
  setNavigation(x=>({filter,revision:x.revision+1}));scrollPositions.current[view]=window.scrollY
  if((restore&&filter!==(viewFilters[k]||''))||(!restore&&filter)){setViewFilters(v=>({...v,[k]:filter}));setViewKeys(v=>({...v,[k]:(v[k]||0)+1}))}
  if(!restore)scrollPositions.current[k]=0
  setVisited(v=>new Set([...v,k]));setView(k);setMobileMenu(false);setError('')
  if(!restore)requestAnimationFrame(()=>window.scrollTo(0,0))
 }
 function saveHistory(next){historyRef.current=next;setScreenHistory(next)}
 function go(k,filter='',step=null){
  if(!visibleNav.some(n=>n[0]===k))return
  if(k===view&&!filter&&step===null){setMobileMenu(false);return}
  const current=historyRef.current
  const entries=current.entries.slice(0,current.index+1)
  // Keep the actual current screen as the starting point after permission redirects.
  entries[entries.length-1]={view,filter:viewFilters[view]||'',step:guide.step}
  entries.push({view:k,filter:filter||viewFilters[k]||'',step:step??stepForView(k)})
  saveHistory({entries,index:entries.length-1});showScreen(k,filter,false,step??stepForView(k))
 }
 function historyTarget(direction){
  for(let i=screenHistory.index+direction;i>=0&&i<screenHistory.entries.length;i+=direction){
   if(visibleNav.some(n=>n[0]===screenHistory.entries[i].view))return i
  }
  return -1
 }
 function moveHistory(direction){
  const index=historyTarget(direction);if(index<0)return
  const entry=screenHistory.entries[index]
  saveHistory({...screenHistory,index});showScreen(entry.view,entry.filter,true,entry.step??stepForView(entry.view))
 }
 function guidedDestination(step){
  const allowed=k=>visibleNav.some(n=>n[0]===k)
  if(step===6){if(['po','receiving'].includes(view)&&allowed(view))return view;return allowed('rfq')?'rfq':allowed('po')?'po':'receiving'}
  return viewForStep(step,(Boolean(guideRfqId)||view==='rfq')&&view!=='requirements')
 }
 function canStep(step){return visibleNav.some(n=>n[0]===guidedDestination(step))}
 function guideTo(step){if(canStep(step))go(guidedDestination(step),'',step)}
 const p={settings,lastWork,resumeWork:()=>{if(lastWork)go(lastWork.view,lastWork.filter,lastWork.step)},isActiveView:k=>activeScreen.current===k,guidedStep:guide.step,guideRevision:guide.revision,guideTo,onRfqSelected:setGuideRfqId,profile,fields,features,company,footer,flash,fail,can,permissions,language,t,activeView:view,navigate:go,initialFilter:navigation.filter,canNavigate:k=>visibleNav.some(n=>n[0]===k)}
 return <div className="app" style={interfaceVariables(settings.interface_preferences)}>
  <aside className="sidebar">
   <div className="brand"><div className="brandmark">GH</div><div><h1>GH Procurement</h1><small>{t('app.purchase_control','Purchase Control')}</small></div></div>
   <div className="nav">
    <div className="nav-section-label">WORK</div>
    {primaryNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><b>{n[1]}</b>{n[2]}</button>)}
    {secondaryNav.length>0&&<details className="nav-more" open={secondaryNav.some(n=>n[0]===view)}>
     <summary><b>•••</b><span>More / Admin</span></summary>
     <div className="nav-more-items">{secondaryNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><b>{n[1]}</b>{n[2]}</button>)}</div>
    </details>}
   </div>
   <div className="sidefoot"><div className="userbox"><strong>{profile.display_name||session.user.email}</strong><small>{String(profile.role_key||profile.role).replaceAll('_',' ')}</small><div className="toolbar user-actions"><button className="btn ghost small" onClick={()=>setSecurityOpen(true)}>{t('common.security','Security')}</button><button className="btn ghost small" onClick={()=>supabase.auth.signOut()}>{t('common.sign_out','Sign out')}</button></div></div></div>
  </aside>

  <main className="main">
   <header className="topbar"><div className="topbar-left"><button className="mobile-menu-btn" onClick={()=>setMobileMenu(true)} aria-label="Open menu">☰</button><div><h2>{title}</h2><div className="muted tiny">General Hardware · Nawalapitiya</div></div></div><div className="top-actions"><div className="language-switch" aria-label="Language"><button className={language==='en'?'active':''} onClick={()=>setAppLanguage('en')}>EN</button><button className={language==='ta'?'active':''} onClick={()=>setAppLanguage('ta')}>TA</button></div><button className="btn small info-top-btn" onClick={()=>setHelpOpen(true)} aria-label={t('common.help','Help')}>i</button><button className="btn keep-mobile" onClick={()=>location.reload()}>{t('common.refresh','Refresh')}</button><button className="btn hide-mobile" onClick={()=>setSecurityOpen(true)}>{t('common.security','Security')}</button></div></header>
   <nav className="app-history-nav" aria-label="Screen navigation"><button className="btn small" aria-label="Go back" disabled={historyTarget(-1)<0} onClick={()=>moveHistory(-1)}>← {t('common.back','Back')}</button><button className="btn small" aria-label="Go forward" disabled={historyTarget(1)<0} onClick={()=>moveHistory(1)}>{t('common.forward','Forward')} →</button></nav>
   <div className="content" ref={workContent}>
    <WorkflowNavigation view={view} step={guide.step} onStep={guideTo} canStep={canStep} navigate={go} canNavigate={p.canNavigate} t={t}/>
     {!visibleNav.some(n=>n[0]===view)&&<p role="status" className="muted">Opening your permitted workspace…</p>}
    <section hidden={view!=='dashboard'} key={'dashboard-'+(viewKeys['dashboard']||0)}>{visited.has('dashboard')&&visibleNav.some(n=>n[0]==='dashboard')&&<Dashboard {...p} initialFilter={viewFilters['dashboard']||''}/>}</section>
    <section hidden={view!=='stock'} key={'stock-'+(viewKeys['stock']||0)}>{visited.has('stock')&&visibleNav.some(n=>n[0]==='stock')&&<StockCheck {...p} initialFilter={viewFilters['stock']||''}/>}</section>
    <section hidden={view!=='urgent_actions'} key={'urgent_actions-'+(viewKeys['urgent_actions']||0)}>{visited.has('urgent_actions')&&visibleNav.some(n=>n[0]==='urgent_actions')&&<UrgentActions {...p} initialFilter={viewFilters['urgent_actions']||''}/>}</section>
    <section hidden={view!=='requirements'} key={'requirements-'+(viewKeys['requirements']||0)}>{visited.has('requirements')&&visibleNav.some(n=>n[0]==='requirements')&&<Requirements {...p} initialFilter={viewFilters['requirements']||''}/>}</section>
    <section hidden={view!=='company_lists'} key={'company_lists-'+(viewKeys['company_lists']||0)}>{visited.has('company_lists')&&visibleNav.some(n=>n[0]==='company_lists')&&<CompanyLists {...p} initialFilter={viewFilters['company_lists']||''}/>}</section>
    <section hidden={view!=='suppliers'} key={'suppliers-'+(viewKeys['suppliers']||0)}>{visited.has('suppliers')&&visibleNav.some(n=>n[0]==='suppliers')&&<Suppliers {...p} initialFilter={viewFilters['suppliers']||''}/>}</section>
    <section hidden={view!=='price_lists'} key={'price_lists-'+(viewKeys['price_lists']||0)}>{visited.has('price_lists')&&visibleNav.some(n=>n[0]==='price_lists')&&<CompanyPriceLists {...p} initialFilter={viewFilters['price_lists']||''}/>}</section>
    <section hidden={view!=='rfq'} key={'rfq-'+(viewKeys['rfq']||0)}>{visited.has('rfq')&&visibleNav.some(n=>n[0]==='rfq')&&<Rfqs {...p} initialFilter={viewFilters['rfq']||''}/>}</section>
    <section hidden={view!=='po'} key={'po-'+(viewKeys['po']||0)}>{visited.has('po')&&visibleNav.some(n=>n[0]==='po')&&<PurchaseOrders {...p} initialFilter={viewFilters['po']||''}/>}</section>
    <section hidden={view!=='invoices'} key={'invoices-'+(viewKeys['invoices']||0)}>{visited.has('invoices')&&visibleNav.some(n=>n[0]==='invoices')&&<Invoices {...p} initialFilter={viewFilters['invoices']||''}/>}</section>
    <section hidden={view!=='receiving'} key={'receiving-'+(viewKeys['receiving']||0)}>{visited.has('receiving')&&visibleNav.some(n=>n[0]==='receiving')&&<Receiving {...p} initialFilter={viewFilters['receiving']||''}/>}</section>
    <section hidden={view!=='items'} key={'items-'+(viewKeys['items']||0)}>{visited.has('items')&&visibleNav.some(n=>n[0]==='items')&&<Items {...p} initialFilter={viewFilters['items']||''}/>}</section>
    <section hidden={view!=='reports'} key={'reports-'+(viewKeys['reports']||0)}>{visited.has('reports')&&visibleNav.some(n=>n[0]==='reports')&&<Reports {...p} initialFilter={viewFilters['reports']||''}/>}</section>
    <section hidden={view!=='admin'} key={'admin-'+(viewKeys['admin']||0)}>{visited.has('admin')&&visibleNav.some(n=>n[0]==='admin')&&<Admin {...p} initialFilter={viewFilters['admin']||''} modules={modules} features={features} settings={settings} onConfigChanged={refreshConfig}/>}</section>
   </div>
  </main>

  <nav className="mobile-bottom-nav" style={{gridTemplateColumns:`repeat(${mobileQuickNav.length+1},minmax(0,1fr))`}}>
   {mobileQuickNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><span>{n[1]}</span>{n[2].split(' ')[0]}</button>)}
   <button className={mobileMenu?'active':''} onClick={()=>setMobileMenu(true)}><span>☰</span>{t('app.more','More')}</button>
  </nav>

  {mobileMenu&&<div className="mobile-drawer-backdrop" onClick={()=>setMobileMenu(false)}><div className="mobile-drawer" role="dialog" aria-modal="true" aria-labelledby="mobile-menu-title" onClick={e=>e.stopPropagation()}><div className="mobile-drawer-head"><div><strong id="mobile-menu-title">GH Procurement</strong><div className="muted tiny">{String(profile.role_key||profile.role).replaceAll('_',' ')}</div></div><button className="btn small" onClick={()=>setMobileMenu(false)}>{t('common.close','Close')}</button></div><div className="drawer-section-title">WORK</div><div className="mobile-drawer-grid">{primaryNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><span>{n[1]}</span><b>{n[2]}</b></button>)}</div>{secondaryNav.length>0&&<><div className="drawer-section-title">MORE / ADMIN</div><div className="mobile-drawer-grid secondary">{secondaryNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><span>{n[1]}</span><b>{n[2]}</b></button>)}</div></>}<div className="drawer-language"><span>{t('common.settings','Settings')}</span><div className="language-switch"><button className={language==='en'?'active':''} onClick={()=>setAppLanguage('en')}>EN</button><button className={language==='ta'?'active':''} onClick={()=>setAppLanguage('ta')}>TA</button></div></div><div className="drawer-actions"><button className="btn" onClick={()=>{setMobileMenu(false);setHelpOpen(true)}}>{t('common.help','Help')}</button><button className="btn" onClick={()=>{setMobileMenu(false);setSecurityOpen(true)}}>{t('common.security','Security')}</button><button className="btn bad" onClick={()=>supabase.auth.signOut()}>{t('common.sign_out','Sign out')}</button></div></div></div>}

  <div className="app-toast-stack" aria-live="polite">
   {notice&&<div className="app-toast success-toast"><b>✓</b><span>{notice}</span><button aria-label="Dismiss notification" onClick={()=>setNotice('')}>×</button></div>}
   {error&&<div className="app-toast error-toast" role="alert"><b>!</b><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
  </div>
  <HelpCenter open={helpOpen} onClose={()=>setHelpOpen(false)} language={language} t={t}/>
  <ChangePassword open={securityOpen} onClose={()=>setSecurityOpen(false)} flash={flash} fail={fail}/>
 </div>
}
