'use client'

import {Children,Fragment,isValidElement,useEffect,useId,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
import {useModalSurface} from './use-modal-surface'

function optionText(value){
 if(value==null||typeof value==='boolean')return ''
 if(typeof value==='string'||typeof value==='number')return String(value)
 if(Array.isArray(value))return value.map(optionText).join('')
 return isValidElement(value)?optionText(value.props.children):''
}
function optionsFrom(children,disabled=false){
 const result=[]
 Children.forEach(children,child=>{
  if(!isValidElement(child))return
  if(child.type==='option'){
   const text=optionText(child.props.children)
   result.push({value:String(child.props.value??text),text,disabled:disabled||child.props.disabled})
  }else if(child.type===Fragment||child.type==='optgroup')result.push(...optionsFrom(child.props.children,disabled||child.props.disabled))
 })
 return result
}
function display(text){
 const parts=text.split(' · ')
 if(/^PO-/.test(parts[0])&&parts.length>1)return {title:parts.slice(1).join(' · '),detail:parts[0]}
 return {title:text,detail:''}
}

export function ModernSelect({children,value,defaultValue='',onChange,disabled,className='',id,style,...props}){
 const [local,setLocal]=useState(String(defaultValue)),[open,setOpen]=useState(false),[search,setSearch]=useState(''),[title,setTitle]=useState('Choose an option')
 const uid=useId(),trigger=useRef(null),surface=useModalSurface(open,()=>setOpen(false))
 const options=optionsFrom(children),current=String(value??local),selected=options.find(o=>o.value===current)
 const label=props['aria-label']||'Choose an option'
 const shown=options.filter(o=>o.text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
 useEffect(()=>{if(disabled)setOpen(false)},[disabled])
 function choose(option){
  setLocal(option.value);setOpen(false)
  onChange?.({target:{value:option.value,name:props.name},currentTarget:{value:option.value,name:props.name}})
 }
 const content=display(selected?.text||options[0]?.text||label)
 return <>
  <button {...props} id={id} ref={trigger} type="button" className={'select modern-select '+className} style={style} disabled={disabled}
   aria-haspopup="dialog" aria-expanded={open} aria-controls={open?uid:undefined}
   data-value={current} onClick={()=>{setTitle(props['aria-label']||(id?document.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent:null)||trigger.current?.closest('.field')?.querySelector('label')?.textContent||label);setSearch('');setOpen(true)}}>
   <span className="picker-trigger-copy"><span>{content.title}</span>{content.detail&&<small>{content.detail}</small>}</span><span className="picker-arrow" aria-hidden="true">⌄</span>
  </button>
  {open&&createPortal(<div className="modal-backdrop picker-backdrop" onClick={e=>{if(e.target===e.currentTarget)setOpen(false)}}>
   <section ref={surface} id={uid} role="dialog" aria-modal="true" aria-labelledby={uid+'-title'} className="card picker-panel">
    <header className="picker-header"><div><small>SELECT</small><h3 id={uid+'-title'}>{title}</h3></div><button type="button" className="picker-close" aria-label="Close selection" onClick={()=>setOpen(false)}>×</button></header>
    <div className="picker-search"><input className="input" aria-label={'Search '+label} placeholder="Search…" value={search} onChange={e=>setSearch(e.target.value)} /></div>
    <div className="picker-options" role="group" aria-label={label}>
     {shown.map((option,index)=>{const row=display(option.text);return <button type="button" key={option.value+'-'+index} data-option-value={option.value} disabled={option.disabled} aria-pressed={current===option.value} className={'picker-option '+(current===option.value?'selected':'')} onClick={()=>choose(option)}><span><strong>{row.title}</strong>{row.detail&&<small>{row.detail}</small>}</span><span className="picker-check" aria-hidden="true">{current===option.value?'✓':''}</span></button>})}
     {!shown.length&&<p className="picker-empty">No matching options.</p>}
    </div><footer className="picker-footer">{shown.length} option{shown.length===1?'':'s'}</footer>
   </section>
  </div>,document.body)}
 </>
}
