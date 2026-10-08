'use client'

import {useEffect,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {Err} from './ui'

function passwordIssue(value){
 if(value.length<12)return 'Use a password with at least 12 characters.'
 if(!/[a-z]/.test(value))return 'Add at least one lowercase letter.'
 if(!/[A-Z]/.test(value))return 'Add at least one uppercase letter.'
 if(!/[0-9]/.test(value))return 'Add at least one number.'
 if(!/[^A-Za-z0-9]/.test(value))return 'Add at least one symbol.'
 return ''
}

export function LoginScreen({initialError=''}) {
 const [mode,setMode]=useState('login')
 const [email,setEmail]=useState('')
 const [password,setPassword]=useState('')
 const [confirm,setConfirm]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState(initialError)
 const [notice,setNotice]=useState('')

 async function signIn(){
  if(!email||!password)return setError('Enter your email and password.')
  setBusy(true);setError('');setNotice('')
  const {error:e}=await supabase.auth.signInWithPassword({email:email.trim(),password})
  setBusy(false); if(e)setError(e.message)
 }
 async function forgot(){
  if(!email)return setError('Enter your email address first.')
  setBusy(true);setError('');setNotice('')
  const {error:e}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin+'/?recovery=1'})
  setBusy(false)
  if(e)setError(e.message)
  else setNotice('If this email belongs to an approved GH account, a password-reset email has been sent.')
 }
 async function updatePassword(){
  const issue=passwordIssue(password)
  if(issue)return setError(issue)
  if(password!==confirm)return setError('Passwords do not match.')
  setBusy(true);setError('');setNotice('')
  const {error:e}=await supabase.auth.updateUser({password})
  setBusy(false)
  if(e)setError(e.message)
  else {setNotice('Password updated successfully. You can continue to GH Procurement.');setMode('done')}
 }
 useEffect(()=>{
   const {data}=supabase.auth.onAuthStateChange((event)=>{
     if(event==='PASSWORD_RECOVERY')setMode('recovery')
   })
   if(new URLSearchParams(window.location.search).get('recovery')==='1')setMode('recovery')
   return()=>data.subscription.unsubscribe()
 },[])

 if(mode==='recovery')return <div className="login-shell"><div className="card login">
   <div className="logo">GH</div><h1>Set a new password</h1><p>Choose a strong password for your approved GH account.</p>
   <div className="stack"><input className="input" type="password" autoComplete="new-password" placeholder="New password (12+ with upper/lowercase, number & symbol)" value={password} onChange={e=>setPassword(e.target.value)}/><input className="input" type="password" autoComplete="new-password" placeholder="Confirm new password" value={confirm} onChange={e=>setConfirm(e.target.value)}/><Err v={error}/>{notice&&<div className="success">{notice}</div>}<button className="btn primary" disabled={busy} onClick={updatePassword}>{busy?'Updating…':'Update password'}</button></div>
 </div></div>

 if(mode==='done')return <div className="login-shell"><div className="card login"><div className="logo">GH</div><h1>Password updated</h1><p>Your password is now changed.</p><div className="success">{notice}</div><button className="btn primary section" onClick={()=>window.location.replace('/')}>Continue</button></div></div>

 return <div className="login-shell"><div className="card login">
   <div className="logo">GH</div><h1>GH Procurement</h1><p>Secure procurement, supplier comparison, purchase orders and stock receiving.</p>
   <div className="stack">
    <input className="input" type="email" autoComplete="username" placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)}/>
    {mode==='login'&&<input className="input" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==='Enter'&&signIn()}/>}
    <Err v={error}/>{notice&&<div className="success">{notice}</div>}
    {mode==='login'?<>
      <button className="btn primary" disabled={busy} onClick={signIn}>{busy?'Signing in…':'Sign in'}</button>
      <button className="link-button" disabled={busy} onClick={()=>{setMode('forgot');setError('');setNotice('')}}>Forgot password?</button>
    </>:<>
      <button className="btn primary" disabled={busy} onClick={forgot}>{busy?'Sending…':'Send password-reset email'}</button>
      <button className="link-button" onClick={()=>{setMode('login');setError('');setNotice('')}}>Back to sign in</button>
    </>}
    <div className="muted tiny">Public registration is disabled. Only approved GH accounts can access this app.</div>
   </div>
 </div></div>
}

export function ChangePassword({open,onClose,flash,fail}){
 const[current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false)
 if(!open)return null
 async function save(){
  if(!current)return fail(new Error('Enter your current password.'))
  const issue=passwordIssue(password)
  if(issue)return fail(new Error(issue))
  if(password!==confirm)return fail(new Error('New passwords do not match.'))
  setBusy(true)
  const {error}=await supabase.auth.updateUser({password,current_password:current})
  setBusy(false)
  if(error)return fail(error)
  setCurrent('');setPassword('');setConfirm('');flash('Password changed successfully.');onClose()
 }
 return <div className="modal-backdrop"><div className="modal card"><div className="modal-head"><h3>Account security</h3><button className="btn small" onClick={onClose}>Close</button></div><div className="stack">
  <div className="notice">For security, confirm your current password before choosing a new one.</div>
  <input className="input" type="password" placeholder="Current password" value={current} onChange={e=>setCurrent(e.target.value)}/>
  <input className="input" type="password" placeholder="New password (12+ with upper/lowercase, number & symbol)" value={password} onChange={e=>setPassword(e.target.value)}/>
  <input className="input" type="password" placeholder="Confirm new password" value={confirm} onChange={e=>setConfirm(e.target.value)}/>
  <button className="btn primary" disabled={busy} onClick={save}>{busy?'Updating…':'Change password'}</button>
 </div></div></div>
}
