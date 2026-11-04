'use client'
import {ProcurementGuide} from './procurement-guide'
import {useState} from 'react'
import {interfaceTranslator} from '@/lib/interface-copy.mjs'
import {WorkCases} from './work-cases'
import {WorkExtras} from './work-extras'
import {resumeTaskLabel} from '@/lib/dashboard-actions.mjs'

export function Dashboard({can=()=>false,lastWork,resumeWork=()=>{},activeView='dashboard',navigate=()=>{},canNavigate=()=>false,language='en'}){
 const tr=interfaceTranslator(language)
 const[revision,setRevision]=useState(0)
 return <>
  <ProcurementGuide canNavigate={canNavigate} language={language}/>
  <div className="toolbar work-refresh"><button className="btn small" onClick={()=>setRevision(x=>x+1)}>{tr('Refresh work')}</button></div>
  {canNavigate('requirements')?<WorkCases language={language} revision={revision} activeView={activeView} can={can} canNavigate={canNavigate} navigate={navigate}/>:<WorkExtras language={language} can={can} revision={revision} activeView={activeView} canNavigate={canNavigate} navigate={navigate} includePurchasing/>}
  {canNavigate('requirements')&&<WorkExtras language={language} can={can} revision={revision} activeView={activeView} canNavigate={canNavigate} navigate={navigate}/>}
  {lastWork&&canNavigate(lastWork.view)&&<button className="btn small" onClick={resumeWork}>{resumeTaskLabel(lastWork)}</button>}
 </>
}

