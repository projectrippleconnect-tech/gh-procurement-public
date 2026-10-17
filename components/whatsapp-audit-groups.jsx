'use client'
import {useState} from 'react'
import {supabase} from '@/lib/supabase'

/** Safe group discovery only: never sends, joins, or changes WhatsApp groups. */
export function WhatsAppAuditGroups(){
 const [running,setRunning]=useState(false)
 const [result,setResult]=useState(null)
 const [error,setError]=useState('')
 async function checkGroups(){
  if(running)return
  setRunning(true);setError('');setResult(null)
  try{
   const {data:{session},error:authError}=await supabase.auth.getSession()
   if(authError||!session?.access_token)throw new Error('Sign in as administrator to check WhatsApp groups.')
   const r=await fetch('/api/integrations/whatsapp/audit-groups',{
    headers:{Authorization:'Bearer '+session.access_token},cache:'no-store',signal:AbortSignal.timeout(25000)
   })
   const data=await r.json()
   if(!r.ok||!data.ok)throw new Error(data.error||'Could not check WhatsApp groups.')
   setResult(data)
  }catch(e){setError(e?.message||'WhatsApp group lookup failed.')}
  finally{setRunning(false)}
 }
 return <details className="card pad section" aria-label="Check WhatsApp audit groups">
  <summary><strong>WhatsApp Audit Groups</strong> · RFQ / PO verification</summary>
  <p className="muted tiny section">Uses the same WhatsApp account already linked to WAHA. Read-only: it never sends a message or changes group members. Only your private RFQ and PO groups should receive document copies.</p>
  <button type="button" className="btn primary small section" onClick={checkGroups} disabled={running}>{running?'Checking groups…':'Check my WhatsApp groups'}</button>
  {error&&<p role="alert" className="error">{error}</p>}
  {result&&<>
   <p className="muted tiny">{result.archiveEnabled?'Archive switch is on — group privacy checks still apply.':'Automatic audit copies are OFF until group IDs and migration are verified.'}</p>
   {result.groups?.length===0?<p className="muted">{result.discovery?.listed>0?(result.discovery?.nameless>0?'WAHA returned '+result.discovery.listed+' group records, but '+result.discovery.nameless+' have no recognizable names. This can happen before WhatsApp community metadata is fully synchronized.':'WAHA returned '+result.discovery.listed+' group records, but none match RFQ, PO or General. Verify the group names in WhatsApp.'):'WAHA returned no recognized group records. Open the groups on your phone, confirm they can receive messages, and retry.'}</p>:null}
   {result.discovery&&<p className="muted tiny" role="status">WAHA discovery: {result.discovery.listed} group records · {result.discovery.nameless} missing names · source: {result.discovery.source}{result.discovery.groupCount===null?'':' · WAHA reports '+result.discovery.groupCount+' groups'}. No messages sent.</p>}
   <div style={{display:'grid',gap:7}}>
   {(result.groups||[]).map(group=><div key={group.id} style={{border:'1px solid var(--line)',borderRadius:8,padding:8,minWidth:0}}>
    <strong>{group.name}</strong>
    <p className="muted tiny" style={{margin:'3px 0',overflowWrap:'anywhere'}}>Group ID: {group.id}</p>
    <p className="muted tiny" style={{margin:'3px 0'}}>Members: {group.memberCount===null?'Could not verify':group.memberCount} · {group.reason==='only_your_account_reported'?'Only your account found':group.reason==='no_members_returned'?'WhatsApp returned no group members':group.reason==='check_each_member'?'Verify all members belong to you':'Verification unavailable'}</p>
    {!!group.memberIds?.length&&<details><summary className="muted tiny">View group member IDs</summary><p className="muted tiny" style={{overflowWrap:'anywhere'}}>{group.memberIds.join(', ')}</p></details>}
   </div>)}
   </div>
   {!!result.missing?.length&&<p className="muted tiny">Not found: {result.missing.join(', ')}. These groups must appear in WAHA before an audit destination can be enabled.</p>}
   <p className="muted tiny">No messages were sent by this check. A successful lookup does not confirm that a one-person group accepts messages; verify in WhatsApp first.</p>
  </>}
 </details>
}
