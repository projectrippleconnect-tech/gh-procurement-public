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
  return()=>{
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
  <summary aria-label="Appearance settings" title="Appearance settings">✦</summary>
  <div className="gh-appearance-panel" role="group" aria-label="Appearance settings">
   <h3>Appearance</h3>
   <label>Theme
    <select aria-label="Theme" value={settings.theme} onChange={event=>update('theme',event.target.value)}>
     <option value="classic">Classic — original (unchanged)</option>
     <option value="blue">Professional Blue</option>
     <option value="green">Emerald Green</option>
     <option value="slate">Modern Slate</option>
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
     <option value="rich">Rich — enhanced sparkle</option>
    </select>
   </label>
   <p>Classic preserves the original GH Procurement appearance. Gold sparkle appears only on successful confirmations. Settings are saved on this device. Reduced-motion settings are respected.</p>
   <button type="button" className="btn small" onClick={()=>{const next={...DEFAULT};setSettings(next);saveAppearance(next)}}>Restore original appearance</button>
  </div>
 </details>
}
