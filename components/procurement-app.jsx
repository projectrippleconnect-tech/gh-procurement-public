'use client'

import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {NAV,Err} from './ui'
import {LoginScreen,ChangePassword} from './auth-screen'
import {Dashboard,StockCheck,Items} from './modules-stock'
import {Requirements,Suppliers,Rfqs} from './modules-buying'
import {UrgentActions} from './modules-urgent'
import {CompanyLists,CompanyPriceLists} from './modules-company'
import {PurchaseOrders,Invoices,Receiving} from './modules-documents'
import {Reports,Admin} from './modules-admin'
import {createTranslator,navText} from '@/lib/i18n'
import {HelpCenter} from './help-ui'

export default function ProcurementApp(){
 const[session,setSession]=useState(null),[profile,setProfile]=useState(null),[view,setView]=useState('dashboard')
 const[navigation,setNavigation]=useState({filter:'',revision:0})
 const[boot,setBoot]=useState(true),[notice,setNotice]=useState(''),[error,setError]=useState(''),[recovery,setRecovery]=useState(false)
 const[modules,setModules]=useState([]),[fields,setFields]=useState([]),[features,setFeatures]=useState([]),[settings,setSettings]=useState({})
 const[permissions,setPermissions]=useState(new Set()),[permissionsLoaded,setPermissionsLoaded]=useState(false),[language,setLanguage]=useState(()=>typeof window!=='undefined'?(localStorage.getItem('gh-procurement-language')||'en'):'en')
 const[mobileMenu,setMobileMenu]=useState(false),[securityOpen,setSecurityOpen]=useState(false),[helpOpen,setHelpOpen]=useState(false)
 const lastActivity=useRef(Date.now()),noticeTimer=useRef(null),errorTimer=useRef(null)

 const ensure=useCallback(async s=>{
  const x=await supabase.from('proc_profiles').select('*').eq('id',s.user.id).maybeSingle()
  if(x.error)throw x.error
  if(x.data){if(!x.data.active)throw new Error('Your GH Procurement access is disabled.');const accepted=await supabase.rpc('proc_mark_own_invite_accepted');if(accepted.error)console.warn('Invite acceptance status not updated',accepted.error);return x.data}
  const r=await supabase.rpc('proc_ensure_profile')
  if(r.error)throw r.error
  const p=Array.isArray(r.data)?r.data[0]:r.data
  if(!p?.active)throw new Error('Your GH Procurement access is disabled.');const accepted=await supabase.rpc('proc_mark_own_invite_accepted');if(accepted.error)console.warn('Invite acceptance status not updated',accepted.error);return p
 },[])

 const loadPermissions=useCallback(async()=>{
  const r=await supabase.rpc('proc_my_permissions_v1')
  if(r.error)throw r.error
  setPermissions(new Set((r.data||[]).map(x=>typeof x==='string'?x:x.permission_key).filter(Boolean)));setPermissionsLoaded(true)
 },[])

 const loadConfig=useCallback(async()=>{
  const[a,b,c,d]=await Promise.all([
   supabase.from('proc_module_settings').select('*').order('sort_order'),
   supabase.from('proc_field_settings').select('*').order('module_key').order('sort_order'),
   supabase.from('proc_feature_settings').select('*').order('group_key').order('sort_order'),
   supabase.from('proc_settings').select('key,value')
  ])
  if(a.error)throw a.error;if(b.error)throw b.error;if(c.error)throw c.error;if(d.error)throw d.error
  setModules(a.data||[]);setFields(b.data||[]);setFeatures(c.data||[]);setSettings(Object.fromEntries((d.data||[]).map(x=>[x.key,x.value])))
 },[])

 useEffect(()=>{
  if(typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('recovery')==='1')setRecovery(true)
  // Keep this callback synchronous: Supabase holds its auth lock while it runs.
  const{data}=supabase.auth.onAuthStateChange((event,s)=>{
   if(event==='PASSWORD_RECOVERY')setRecovery(true)
   setSession(s)
   if(!s){setProfile(null);setModules([]);setFields([]);setFeatures([]);setPermissions(new Set());setPermissionsLoaded(false);setBoot(false)}
  })
  return()=>data.subscription.unsubscribe()
 },[])

 useEffect(()=>{
  if(!session||recovery)return
  let cancelled=false
  setBoot(true);setProfile(null);setPermissions(new Set());setPermissionsLoaded(false)
  async function hydrate(){
   try{
    const next=await ensure(session)
    await Promise.all([loadConfig(),loadPermissions()])
    if(!cancelled){setProfile(next);setError('')}
   }catch(e){if(!cancelled)setError(e.message)}
   finally{if(!cancelled)setBoot(false)}
  }
  hydrate()
  return()=>{cancelled=true}
 },[session,recovery,ensure,loadConfig,loadPermissions])

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
  errorTimer.current=window.setTimeout(()=>setError(''),6500)
 },[])
 const refreshConfig=useCallback(async()=>{try{await loadConfig()}catch(e){fail(e)}},[loadConfig,fail])

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
  return profile?.role==='admin'
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
  if(['admin','procurement'].includes(roleKey))return ['dashboard','stock','requirements','rfq','po']
  return ['dashboard','requirements','rfq','po']
 },[roleKey])
 const primaryNav=useMemo(()=>primaryKeys.map(k=>visibleNav.find(n=>n[0]===k)).filter(Boolean),[primaryKeys,visibleNav])
 const secondaryNav=useMemo(()=>visibleNav.filter(n=>!primaryKeys.includes(n[0])),[visibleNav,primaryKeys])
 const mobileQuickNav=useMemo(()=>{
  if(['admin','procurement'].includes(roleKey))return ['stock','requirements','rfq','po'].map(k=>visibleNav.find(n=>n[0]===k)).filter(Boolean)
  return primaryNav.slice(0,4)
 },[primaryNav,roleKey,visibleNav])

 useEffect(()=>{
  if(!profile||!visibleNav.length)return
  if(!visibleNav.some(n=>n[0]===view))setView(primaryNav[0]?.[0]||visibleNav[0][0])
 },[visibleNav,primaryNav,view,profile])

 if(boot)return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>GH Procurement</h1><p>{t('app.loading_secure','Loading secure workspace…')}</p></div></div>
 if(recovery)return <LoginScreen initialError={error}/>
 if(!session)return <LoginScreen initialError={error}/>
 if(!profile)return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>{t('app.access_unavailable','Access unavailable')}</h1><p>{error||t('app.account_not_enabled','Your account is not enabled for GH Procurement.')}</p><button className="btn" onClick={()=>supabase.auth.signOut()}>{t('common.sign_out','Sign out')}</button></div></div>

 const title=visibleNav.find(x=>x[0]===view)?.[2]||'GH Procurement'
 const company=settings.company_profile||{name:'General Hardware',town:'Nawalapitiya',country:'Sri Lanka'}
 const footer=settings.pdf_footer||'Generated by GH Procurement'
 function go(k,filter=''){if(!visibleNav.some(n=>n[0]===k))return;if(k===view&&!filter){setMobileMenu(false);return}setNavigation(x=>({filter,revision:x.revision+1}));setView(k);setMobileMenu(false);setError('')}
 const p={profile,fields,features,company,footer,flash,fail,can,permissions,language,t,navigate:go,initialFilter:navigation.filter,canNavigate:k=>visibleNav.some(n=>n[0]===k)}
 return <div className="app">
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
   <div className="content" key={navigation.revision}>
    {view==='dashboard'&&<Dashboard {...p}/>}
    {view==='stock'&&<StockCheck {...p}/>}
    {view==='urgent_actions'&&<UrgentActions {...p}/>}
    {view==='requirements'&&<Requirements {...p}/>}
    {view==='company_lists'&&<CompanyLists {...p}/>}
    {view==='suppliers'&&<Suppliers {...p}/>}
    {view==='price_lists'&&<CompanyPriceLists {...p}/>}
    {view==='rfq'&&<Rfqs {...p}/>}
    {view==='po'&&<PurchaseOrders {...p}/>}
    {view==='invoices'&&<Invoices {...p}/>}
    {view==='receiving'&&<Receiving {...p}/>}
    {view==='items'&&<Items {...p}/>}
    {view==='reports'&&<Reports {...p}/>}
    {view==='admin'&&<Admin {...p} modules={modules} features={features} settings={settings} onConfigChanged={refreshConfig}/>}
   </div>
  </main>

  <nav className="mobile-bottom-nav" style={{gridTemplateColumns:`repeat(${mobileQuickNav.length+1},minmax(0,1fr))`}}>
   {mobileQuickNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><span>{n[1]}</span>{n[2].split(' ')[0]}</button>)}
   <button className={mobileMenu?'active':''} onClick={()=>setMobileMenu(true)}><span>☰</span>{t('app.more','More')}</button>
  </nav>

  {mobileMenu&&<div className="mobile-drawer-backdrop" onClick={()=>setMobileMenu(false)}><div className="mobile-drawer" onClick={e=>e.stopPropagation()}><div className="mobile-drawer-head"><div><strong>GH Procurement</strong><div className="muted tiny">{String(profile.role_key||profile.role).replaceAll('_',' ')}</div></div><button className="btn small" onClick={()=>setMobileMenu(false)}>{t('common.close','Close')}</button></div><div className="drawer-section-title">WORK</div><div className="mobile-drawer-grid">{primaryNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><span>{n[1]}</span><b>{n[2]}</b></button>)}</div>{secondaryNav.length>0&&<><div className="drawer-section-title">MORE / ADMIN</div><div className="mobile-drawer-grid secondary">{secondaryNav.map(n=><button key={n[0]} className={view===n[0]?'active':''} onClick={()=>go(n[0])}><span>{n[1]}</span><b>{n[2]}</b></button>)}</div></>}<div className="drawer-language"><span>{t('common.settings','Settings')}</span><div className="language-switch"><button className={language==='en'?'active':''} onClick={()=>setAppLanguage('en')}>EN</button><button className={language==='ta'?'active':''} onClick={()=>setAppLanguage('ta')}>TA</button></div></div><div className="drawer-actions"><button className="btn" onClick={()=>{setMobileMenu(false);setHelpOpen(true)}}>{t('common.help','Help')}</button><button className="btn" onClick={()=>{setMobileMenu(false);setSecurityOpen(true)}}>{t('common.security','Security')}</button><button className="btn bad" onClick={()=>supabase.auth.signOut()}>{t('common.sign_out','Sign out')}</button></div></div></div>}

  <div className="app-toast-stack" aria-live="polite">
   {notice&&<div className="app-toast success-toast"><b>✓</b><span>{notice}</span><button onClick={()=>setNotice('')}>×</button></div>}
   {error&&<div className="app-toast error-toast"><b>!</b><span>{error}</span><button onClick={()=>setError('')}>×</button></div>}
  </div>
  <HelpCenter open={helpOpen} onClose={()=>setHelpOpen(false)} language={language} t={t}/>
  <ChangePassword open={securityOpen} onClose={()=>setSecurityOpen(false)} flash={flash} fail={fail}/>
 </div>
}
