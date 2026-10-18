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
   <p className="muted tiny">Private audit database: {result.auditDatabaseReady?'Ready (readable)': 'Not ready or not readable — migration required before activation'}.</p>
   <div style={{display:'grid',gap:6,margin:'8px 0'}}>
    <strong style={{fontSize:12}}>Configured WhatsApp destinations</strong>
    {(result.directChecks||[]).map(group=><div key={group.name} style={{display:'flex',justifyContent:'space-between',gap:10,fontSize:12}}>
     <strong>{group.name}</strong>
     <span className="muted" style={{textAlign:'right'}}>{group.ok?'Exact group confirmed':group.reason==='direct_lookup_unavailable'?'Group lookup unavailable':group.reason==='direct_metadata_mismatch'?'Metadata not verified':'Group ID not configured'}</span>
    </div>)}
   </div>
   {result.groups?.length===0?<p className="muted">{result.discovery?.listed>0?(result.discovery?.nameless>0?'WAHA returned '+result.discovery.listed+' group records, but '+result.discovery.nameless+' have no recognizable names. This can happen before WhatsApp community metadata is fully synchronized.':'WAHA returned '+result.discovery.listed+' group records, but none match RFQ, PO or General. Verify the group names in WhatsApp.'):'WAHA returned no recognized group records. Open the groups on your phone, confirm they can receive messages, and retry.'}</p>:null}
   {result.discovery&&<p className="muted tiny" role="status">WAHA discovery: {result.discovery.listed} group records · {result.discovery.nameless} missing names · source: {result.discovery.source}{result.discovery.groupCount===null?'':' · WAHA reports '+result.discovery.groupCount+' groups'}. No messages sent.</p>}
   <div style={{display:'grid',gap:7}}>
   {(result.groups||[]).map(group=><div key={group.id} style={{border:'1px solid var(--line)',borderRadius:8,padding:8,minWidth:0}}>
    <strong>{group.name}</strong>
    <p className="muted tiny" style={{margin:'3px 0',overflowWrap:'anywhere'}}>Group ID: {group.id}</p>
    <p className="muted tiny" style={{margin:'3px 0'}}>Members: {group.memberCount===null?'Could not verify':group.memberCount} · {group.ownerVerified?'Verified: this WhatsApp account is the only member':group.reason==='linked_account_unknown'?'WAHA account identity unavailable':group.reason==='not_exclusive_owner_group'?'Linked WhatsApp identity not verified':group.reason==='linked_identity_mapping_unavailable'?'WAHA linked-ID mapping unavailable':group.reason==='no_members_returned'?'WhatsApp returned no group members':group.reason==='check_each_member'?'Group has multiple members; do not enable audit':'Owner identity not verified'}</p>
    {!!group.memberIds?.length&&<details><summary className="muted tiny">View group member IDs</summary><p className="muted tiny" style={{overflowWrap:'anywhere'}}>{group.memberIds.join(', ')}</p></details>}
   </div>)}
   </div>
   {!!result.invitePreviews?.length&&<div style={{border:'1px solid var(--line)',borderRadius:8,padding:8,marginTop:7}}>
    <strong>Invite-link verification (read-only)</strong>
    <p className="muted tiny">Group invite codes stay on the server and are never displayed here. This lookup does not join a community or send a message.</p>
    {result.invitePreviews.map(p=><p key={p.slot} className="muted tiny" style={{margin:'5px 0',overflowWrap:'anywhere'}}>
     <strong>Link {p.slot}:</strong> {p.name||'Name unavailable'} {p.isCommunity?'· Community (not an audit subgroup)':''}
     {p.id?' · Group ID '+p.id:''} {p.memberCount!==null?' · '+p.memberCount+' reported members':''}
     {p.status!=='recognized'?' · '+(p.status==='lookup_unavailable'?'WAHA lookup unavailable':p.status==='unrecognized_reply'?'WAHA returned unknown group format':'Review identity before use'):''}
    </p>)}
   </div>}
   {(result.discovery?.responseShape||result.invitePreviews?.some(p=>p.responseShape))&&<details style={{border:'1px solid var(--line)',borderRadius:8,padding:8,marginTop:8}}>
    <summary>WAHA response diagnostics (privacy-safe)</summary>
    <p className="muted tiny">Only data types and field names are displayed. No invitation codes, phone numbers, messages or raw group records.</p>
    {result.discovery?.responseShape&&<div className="muted tiny">
     <strong>Group-list response structure</strong>
     <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}}>{JSON.stringify(result.discovery.responseShape,null,2)}</pre>
    </div>}
    {(result.invitePreviews||[]).filter(p=>p.responseShape).map(p=><div key={'shape'+p.slot} className="muted tiny">
     <strong>Invite {p.slot} response structure</strong>
     <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',fontSize:11}}>{JSON.stringify(p.responseShape,null,2)}</pre>
    </div>)}
   </details>}
   {!!result.missing?.length&&<p className="muted tiny">Still unverified: {result.missing.join(', ')}. WAHA must confirm these saved destinations and their membership before document copies can be enabled.</p>}
   <p className="muted tiny">No messages were sent by this check. A successful lookup does not confirm that a one-person group accepts messages; verify in WhatsApp first.</p>
  </>}
 </details>
}
