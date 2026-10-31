'use client'
import {useId} from 'react'

export function ItemListSelector({value='general',onChange,allowCompany=true,disabled=false,t=(k,f)=>f||k}){
 const id=useId()
 return <div className="item-list-selector section"><label htmlFor={id}>{t('purchasing.item_list','Item list')}</label><select id={id} className="select" aria-label="Item list type" value={value} disabled={disabled||!onChange} onChange={e=>onChange?.(e.target.value)}><option value="general">{t('purchasing.general','General Items')}</option>{allowCompany&&<option value="company">{t('purchasing.company','Company Items')}</option>}</select></div>
}
export function AttentionBadge({reason='',label='Needs attention'}){
 const id=useId()
 if(!reason)return null
 return <details className="record-attention"><summary className="badge warn" aria-controls={id}>{label}</summary><div id={id} className="notice tiny" role="status">{reason}</div></details>
}
