'use client'
import {useState} from 'react'
import {WorkCases} from './work-cases'
import {WorkExtras} from './work-extras'
import {resumeTaskLabel} from '@/lib/dashboard-actions.mjs'

export function Dashboard({can=()=>false,lastWork,resumeWork=()=>{},activeView='dashboard',navigate=()=>{},canNavigate=()=>false}){
 const[revision,setRevision]=useState(0)
 return <>
  <div className="toolbar work-refresh"><button className="btn small" onClick={()=>setRevision(x=>x+1)}>Refresh work</button></div>
  {canNavigate('requirements')?<WorkCases revision={revision} activeView={activeView} can={can} canNavigate={canNavigate} navigate={navigate}/>:<WorkExtras can={can} revision={revision} activeView={activeView} canNavigate={canNavigate} navigate={navigate} includePurchasing/>}
  {canNavigate('requirements')&&<WorkExtras can={can} revision={revision} activeView={activeView} canNavigate={canNavigate} navigate={navigate}/>}
  {lastWork&&canNavigate(lastWork.view)&&<button className="btn small" onClick={resumeWork}>{resumeTaskLabel(lastWork)}</button>}
 </>
}

