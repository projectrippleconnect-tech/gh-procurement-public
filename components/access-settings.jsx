'use client'
import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {DEFAULT_ACCESS_POLICY,validateAccessPolicy} from '@/lib/access-restrictions.mjs'

export function AccessSettings({users,flash,fail}){
 const[user,setUser]=useState(''),[policy,setPolicy]=useState({...DEFAULT_ACCESS_POLICY}),[busy,setBusy]=useState(true),[loaded,setLoaded]=useState(false)
 useEffect(()=>{let alive=true;setBusy(true);setLoaded(false)
  supabase.rpc('proc_admin_access_policy_v1',{p_user_id:user||null}).then(r=>{
   if(r.error)throw r.error
   if(alive){setPolicy({...r.data,start_time:r.data.start_time.slice(0,5),end_time:r.data.end_time.slice(0,5)});setLoaded(true)}
  }).catch(fail).finally(()=>{if(alive)setBusy(false)})
  return()=>{alive=false}
 },[user,fail])
 const change=(key,value)=>setPolicy(p=>({...p,[key]:value}))
 async function save(){
  const error=validateAccessPolicy(policy);if(error)return fail(new Error(error))
  setBusy(true)
  try{const r=await supabase.rpc('proc_admin_save_access_policy_v1',{p_user_id:user||null,p_policy:policy});if(r.error)throw r.error;flash('Access restrictions saved. Existing location verification must be renewed.')}
  catch(e){fail(e)}finally{setBusy(false)}
 }
 async function inherit(){setBusy(true);try{const r=await supabase.rpc('proc_admin_clear_access_policy_v1',{p_user_id:user});if(r.error)throw r.error;setUser('');flash('User now inherits the default access restrictions.')}catch(e){fail(e)}finally{setBusy(false)}}
 return <details name="gh-admin-section" className="admin-accordion"><summary>Time & Location Restrictions</summary><div className="card pad">
  <h3>Time & location access</h3><p>All roles, including custom roles, inherit the default rules. Super Admin is always exempt. You can customize a specific user below.</p>
  <div className="field"><label>Apply settings to</label><select className="input" disabled={busy} value={user} onChange={e=>setUser(e.target.value)}><option value="">Default — every non-Super-Admin user</option>{users.filter(u=>(u.role_key||u.role)!=='admin').map(u=><option key={u.id} value={u.id}>{u.display_name||u.id}</option>)}</select></div>
  <fieldset disabled={busy||!loaded} style={{border:0,padding:0}}>
   <label className="row"><input type="checkbox" checked={policy.time_enabled} onChange={e=>change('time_enabled',e.target.checked)}/>Enable time restriction</label>
   <div className="row" style={{flexWrap:'wrap'}}>{['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((day,i)=><label key={day}><input type="checkbox" checked={policy.days.includes(i)} onChange={e=>change('days',e.target.checked?[...policy.days,i]:policy.days.filter(d=>d!==i))}/>{day}</label>)}</div>
   <div className="formgrid"><div className="field"><label>Opening time (Sri Lanka)</label><input className="input" type="time" value={policy.start_time} onChange={e=>change('start_time',e.target.value)}/></div><div className="field"><label>Closing time (Sri Lanka)</label><input className="input" type="time" value={policy.end_time} onChange={e=>change('end_time',e.target.value)}/></div></div>
   <label className="row"><input type="checkbox" checked={policy.location_enabled} onChange={e=>change('location_enabled',e.target.checked)}/>Enable location restriction</label>
   <div className="formgrid">{[['location_name','Permitted location','text'],['latitude','Latitude','number'],['longitude','Longitude','number'],['radius_m','Allowed radius (metres)','number']].map(([key,label,type])=><div className="field" key={key}><label>{label}</label><input className="input" type={type} step="any" value={policy[key]} onChange={e=>change(key,type==='number'?e.target.value:e.target.value)}/></div>)}</div>
   <p className="muted tiny">Location is checked repeatedly while the app is open. Browser location can be falsified. Android APK screenshot protection applies to the app window; browsers and downloaded documents cannot receive the same protection.</p>
   <div className="row"><button className="btn primary" onClick={save}>Save access restrictions</button>{user&&<button className="btn" onClick={inherit}>Use default rules for this user</button>}</div>
  </fieldset>
 </div></details>
}
