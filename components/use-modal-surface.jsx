'use client'
import {useEffect,useRef} from 'react'
export function useModalSurface(open,onClose){
 const ref=useRef(null),close=useRef(onClose);close.current=onClose
 useEffect(()=>{
  if(!open||!ref.current)return
  const previous=document.activeElement,overflow=document.body.style.overflow
  const controls=()=>[...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')].filter(n=>n.getClientRects().length)
  controls()[0]?.focus();document.body.style.overflow='hidden'
  const keydown=e=>{
   if([...document.querySelectorAll('.modal-backdrop')].at(-1)!==ref.current.closest('.modal-backdrop'))return
   if(e.key==='Escape'){e.preventDefault();close.current()}
   if(e.key==='Tab'){const list=controls(),first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}
  }
  document.addEventListener('keydown',keydown)
  return()=>{document.removeEventListener('keydown',keydown);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus()}
 },[open])
 return ref
}
