'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {FONT_FIELDS,FONT_DEFAULTS,normalizeInterface,interfaceVariables} from '@/lib/procurement-journey.mjs'

export function InterfaceSettings({value,onSaved,flash,fail}) {
 const[draft,setDraft]=useState(()=>normalizeInterface(value)),[device,setDevice]=useState('mobile'),[busy,setBusy]=useState(false)
 useEffect(()=>setDraft(normalizeInterface(value)),[value])
 async function save(){if(busy)return;setBusy(true);try{const r=await supabase.from('proc_settings').upsert({key:'interface_preferences',value:normalizeInterface(draft),description:'Mobile and desktop procurement font sizes and row spacing'});if(r.error)throw r.error;flash('Interface settings saved for all staff.');await onSaved()}catch(e){fail(e)}finally{setBusy(false)}}
 return <details name="gh-admin-section" className="admin-accordion"><summary>Interface · Fonts & spacing</summary><div className="card pad">
  <p className="muted tiny">Choose readable sizes independently for phones and desktops. Changes apply to all staff after saving.</p>
  <label className="field">Preview device<select className="select" value={device} onChange={e=>setDevice(e.target.value)}><option value="mobile">Mobile</option><option value="desktop">Desktop</option></select></label>
  <div className="toolbar section">{[['Compact',{description:12,size:12,reorder:16,input:16,spacing:3}],['Standard',FONT_DEFAULTS],['Large',{description:18,size:14,reorder:22,input:20,spacing:10}]].map(([name,values])=><button className="btn small" key={name} onClick={()=>setDraft(v=>({...v,[device]:{...values}}))}>{name}</button>)}</div>
  <div className="formgrid section">{Object.entries({...FONT_FIELDS,spacing:'Row spacing'}).map(([key,label])=><label className="field" key={key}>{label} · {draft[device][key]} px<input type="range" min={key==='spacing'?2:12} max={key==='spacing'?14:24} step="1" value={draft[device][key]} onChange={e=>setDraft(v=>({...v,[device]:{...v[device],[key]:Number(e.target.value)}}))}/></label>)}</div>
  <div className="interface-preview section" style={interfaceVariables(draft)}><strong style={{fontSize:draft[device].description}}>Cycle lock</strong><span style={{fontSize:draft[device].size}}>Size: 2 feet · pieces</span><b style={{fontSize:draft[device].reorder,color:'var(--brand2)'}}>Reorder: 12</b><input aria-label="Preview stock input" className="input" readOnly value="6" style={{fontSize:draft[device].input,padding:draft[device].spacing}}/></div>
  <div className="toolbar section"><button className="btn primary" disabled={busy} onClick={save}>{busy?'Saving…':'Save interface settings'}</button><button className="btn" disabled={busy} onClick={()=>setDraft(v=>({...v,[device]:{...FONT_DEFAULTS}}))}>Reset preview to defaults</button></div>
 </div></details>
}
