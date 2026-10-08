'use client'

import {useState} from 'react'
import {getAllHelpTopics,getHelpTopic} from '@/lib/help'

export function InfoButton({topic,language='en',className=''}) {
 const[open,setOpen]=useState(false)
 const h=getHelpTopic(topic,language)
 if(!h)return null
 return <span className={'info-help '+className}>
  <button type="button" className="info-icon-btn" aria-label={h.title} title={h.title} onClick={e=>{e.stopPropagation();setOpen(v=>!v)}}>i</button>
  {open&&<span className="info-popover" role="note"><b>{h.title}</b><span>{h.body}</span><button type="button" onClick={()=>setOpen(false)}>×</button></span>}
 </span>
}

export function HelpCenter({open,onClose,language='en',t=(k,f)=>f||k}){
 if(!open)return null
 const topics=getAllHelpTopics(language)
 return <div className="modal-backdrop help-center-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose?.()}>
  <div className="modal card wide help-center">
   <div className="modal-head"><div><h3>{t('help.center','Information Center')}</h3><p className="muted tiny">{t('help.subtitle','Short explanations for important functions.')}</p></div><button className="btn small" onClick={onClose}>{t('common.close','Close')}</button></div>
   <div className="help-topic-grid">{topics.map(x=><div className="help-topic" key={x.key}><h4>{x.title}</h4><p>{x.body}</p></div>)}</div>
  </div>
 </div>
}
