'use client'
import {useEffect,useRef,useState} from 'react'
import {settingsMatch} from '@/lib/settings-search.mjs'

export function SettingsSearch({children}){
 const[query,setQuery]=useState(''),[sections,setSections]=useState([])
 const panels=useRef(null),search=useRef(null)
 useEffect(()=>{
  const read=()=>{
   const next=[...panels.current.querySelectorAll('details.admin-accordion')].map((node,index)=>({
    node,index,title:node.querySelector('summary')?.textContent.trim()||'Settings',
    text:node.textContent+' '+[...node.querySelectorAll('[aria-label],[title],[placeholder]')].map(n=>[n.getAttribute('aria-label'),n.getAttribute('title'),n.getAttribute('placeholder')].join(' ')).join(' ')
   }))
   setSections(old=>old.length===next.length&&old.every((s,i)=>s.node===next[i].node&&s.text===next[i].text)?old:next)
  }
  read();const observer=new MutationObserver(read)
  observer.observe(panels.current,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['aria-label','title','placeholder']})
  return()=>observer.disconnect()
 },[])
 const matches=sections.filter(s=>settingsMatch(s.text,query)).sort((a,b)=>Number(settingsMatch(b.title,query))-Number(settingsMatch(a.title,query)))
 useEffect(()=>{
  for(const section of sections)section.node.hidden=Boolean(query.trim())&&!settingsMatch(section.text,query)
  for(const grid of panels.current.querySelectorAll('.admin-grid'))grid.hidden=Boolean(query.trim())&&[...grid.querySelectorAll('details.admin-accordion')].every(n=>n.hidden)
 },[query,sections])
 function jump(section){
  section.node.open=true
  section.node.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'})
  const summary=section.node.querySelector('summary');summary?.focus({preventScroll:true})
 }
 return <div className="settings-search"><div className="settings-search-box"><label htmlFor="gh-settings-search">Search settings</label><div className="row"><input ref={search} id="gh-settings-search" className="input" type="search" placeholder="Search screenshots, users, time, location, fonts…" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&query.trim()&&matches[0]){e.preventDefault();jump(matches[0])}if(e.key==='Escape')setQuery('')}}/>{query&&<button className="btn small" onClick={()=>{setQuery('');search.current.focus()}}>Clear search</button>}</div>
  {query.trim()&&<><p className="muted tiny" aria-live="polite">{matches.length?`${matches.length} matching ${matches.length===1?'section':'sections'}`:'No matching settings. Try another word.'}</p><ul className="settings-search-results">{matches.map(section=><li key={section.index}><button className="btn" onClick={()=>jump(section)}>{section.title}<span aria-hidden="true">↓</span></button></li>)}</ul></>}
 </div><div ref={panels} className="settings-search-panels">{children}</div></div>
}
