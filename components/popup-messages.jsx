'use client'
import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react'
import {createPortal} from 'react-dom'
const PopupContext=createContext(()=>{})
export function PopupProvider({children}){
 const [messages,setMessages]=useState([]),[ready,setReady]=useState(false)
 const sequence=useRef(0)
 useEffect(()=>setReady(true),[])
 const dismiss=useCallback(id=>setMessages(rows=>rows.filter(x=>x.id!==id)),[])
 const notify=useCallback(message=>{
  if(message?.clear){setMessages([]);return}
  if(!message?.text)return
  const id=++sequence.current
  setMessages(rows=>[...rows.filter(x=>x.text!==message.text),{...message,id}].slice(-3))
 },[])
 return <PopupContext.Provider value={notify}>{children}{ready&&createPortal(<div className="app-toast-stack" aria-label="Notifications">{messages.map(m=><Popup key={m.id} message={m} dismiss={dismiss}/>)}</div>,document.body)}</PopupContext.Provider>
}
function Popup({message:m,dismiss}){
 const [paused,setPaused]=useState(false)
 useEffect(()=>{if(m.kind==='error'||paused)return;const timer=setTimeout(()=>dismiss(m.id),8000);return()=>clearTimeout(timer)},[m.id,m.kind,dismiss,paused])
 return <div className={'app-toast '+(m.kind==='error'?'error-toast':'success-toast')} role={m.kind==='error'?'alert':'status'} onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)} onFocus={()=>setPaused(true)} onBlur={()=>setPaused(false)}><b aria-hidden="true">{m.kind==='error'?'!':m.kind==='reminder'?'◷':'✓'}</b><span>{m.text}{m.onOpen&&<button className="popup-action" onClick={()=>{m.onOpen();dismiss(m.id)}}>Open task →</button>}</span><button aria-label="Dismiss notification" onClick={()=>dismiss(m.id)}>×</button></div>
}
export function usePopup(){return useContext(PopupContext)}
export function MessagePopup({text,kind='error'}){
 const notify=usePopup()
 useEffect(()=>{if(text)notify({text,kind})},[text,kind,notify])
 return null
}
