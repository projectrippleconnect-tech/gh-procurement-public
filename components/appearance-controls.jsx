'use client'

import {useEffect,useState} from 'react'

const KEY='gh-procurement-appearance-v1'
const DEFAULT={theme:'classic',mode:'auto',motion:'premium'}
const allowed={theme:['classic','blue','green','slate'],mode:['auto','light','dark'],motion:['off','standard','premium','rich']}

function normalize(value){
 const result={}
 for(const key of Object.keys(DEFAULT)){
  result[key]=allowed[key].includes(value?.[key])?value[key]:DEFAULT[key]
 }
 return result
}
function readAppearance(){
 try{return normalize(JSON.parse(localStorage.getItem(KEY)||'null'))}catch{return {...DEFAULT}}
}
function applyAppearance(settings){
 const root=document.documentElement
 const prefersDark=window.matchMedia?.('(prefers-color-scheme: dark)').matches
 root.dataset.ghTheme=settings.theme
 root.dataset.ghMode=settings.mode==='auto'?(prefersDark?'dark':'light'):settings.mode
 root.dataset.ghMotion=settings.motion
}
function saveAppearance(settings){
 const next=normalize(settings)
 try{localStorage.setItem(KEY,JSON.stringify(next))}catch{}
 applyAppearance(next)
 window.dispatchEvent(new Event('gh-appearance-changed'))
}

export function AppearanceBootstrap(){
 useEffect(()=>{
  const update=()=>applyAppearance(readAppearance())
  update()
  const media=window.matchMedia?.('(prefers-color-scheme: dark)')
  media?.addEventListener?.('change',update)
  window.addEventListener('storage',update)
  window.addEventListener('gh-appearance-changed',update)
  // Lightweight visual-only tap ring. No business handler, form value, request or
  // navigation event is intercepted or modified.
  const tap=(event)=>{
   const root=document.documentElement
   if(root.dataset.ghTheme==='classic'||!['premium','rich'].includes(root.dataset.ghMotion))return
   if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return
   if(event.isPrimary===false)return
   const target=event.target
   if(!(target instanceof Element))return
   const control=target.closest('button,summary,[role="button"]')
   if(!control||control.matches(':disabled,[aria-disabled="true"]'))return
   const ring=document.createElement('span')
   ring.className='gh-fx-burst'
   ring.setAttribute('aria-hidden','true')
   ring.style.setProperty('--gh-fx-x',event.clientX+'px')
   ring.style.setProperty('--gh-fx-y',event.clientY+'px')
   document.body.appendChild(ring)
   window.setTimeout(()=>ring.remove(),700)
  }
  document.addEventListener('pointerdown',tap,{passive:true})
  return()=>{
   document.removeEventListener('pointerdown',tap)
   media?.removeEventListener?.('change',update)
   window.removeEventListener('storage',update)
   window.removeEventListener('gh-appearance-changed',update)
  }
 },[])
 return null
}

export function AppearanceControls(){
 const[settings,setSettings]=useState(DEFAULT)
 useEffect(()=>{
  const update=()=>setSettings(readAppearance())
  update()
  window.addEventListener('storage',update)
  window.addEventListener('gh-appearance-changed',update)
  return()=>{
   window.removeEventListener('storage',update)
   window.removeEventListener('gh-appearance-changed',update)
  }
 },[])
 const update=(key,value)=>{
  const next=normalize({...settings,[key]:value})
  setSettings(next)
  saveAppearance(next)
 }
 return <details className="gh-appearance-control">
  <summary aria-label="Appearance settings" title="Neon themes and appearance">✦</summary>
  <div className="gh-appearance-panel" role="group" aria-label="Appearance settings">
   <h3>✦ Appearance Lab</h3>
   <label>Theme
    <select aria-label="Theme" value={settings.theme} onChange={event=>update('theme',event.target.value)}>
     <option value="classic">Classic — original (unchanged)</option>
     <option value="blue">Cyber Circuit · Neon Cyan</option>
     <option value="green">Quantum Matrix · Neon Green</option>
     <option value="slate">Plasma Pulse · Neon Violet</option>
    </select>
   </label>
   <label>Appearance mode
    <select aria-label="Appearance mode" value={settings.mode} disabled={settings.theme==='classic'} onChange={event=>update('mode',event.target.value)}>
     <option value="auto">Automatic — match phone</option>
     <option value="light">Light</option>
     <option value="dark">Dark</option>
    </select>
   </label>
   <label>Interaction effects
    <select aria-label="Interaction effects" value={settings.motion} disabled={settings.theme==='classic'} onChange={event=>update('motion',event.target.value)}>
     <option value="off">Off</option>
     <option value="standard">Standard — subtle tap</option>
     <option value="premium">Premium — glow and gold sparkle</option>
     <option value="rich">Hyperdrive — animated HUD and light trails</option>
    </select>
   </label>
   {settings.theme==='classic'?<div className="gh-appearance-classic-help">
    <p>Classic is the original, unchanged appearance. Try the new digital interface without affecting procurement data.</p>
    <button type="button" className="btn primary" onClick={()=>{const next={theme:'blue',mode:'dark',motion:'premium'};setSettings(next);saveAppearance(next)}}>✦ Activate Cyber Neon</button>
   </div>:<div className="gh-theme-preview">
    <span className="gh-preview-kicker">● GH / PROCUREMENT SYSTEM • NEON ONLINE</span>
    <strong className="gh-preview-title">{settings.theme==='blue'?'CYBER CIRCUIT':settings.theme==='green'?'QUANTUM MATRIX':'PLASMA PULSE'}</strong>
    <div className="gh-preview-track"><span>01 · STOCK</span><span>02 · RFQ</span><span>03 · PO</span></div>
    <button type="button" className="btn primary gh-neon-demo">✦ Test Neon Pulse</button>
   </div>}
   <p>Use Dark for the most vivid neon, or Light for a bright, high-contrast workspace. Effects are visual only. Gold sparkles mark actual success messages, not unconfirmed actions. Reduced-motion preferences are respected. Appearance saves on this device.</p>
   <button type="button" className="btn small" onClick={()=>{const next={...DEFAULT};setSettings(next);saveAppearance(next)}}>Restore original appearance</button>
  </div>
 </details>
}
