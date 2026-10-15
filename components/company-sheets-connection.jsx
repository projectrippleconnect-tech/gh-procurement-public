'use client'
import {useEffect,useState} from 'react'

/**
 * An authenticated GH Procurement administrator configures the Google
 * service account in Railway, not in the browser and not in the company DB.
 * The status probe exposes no credentials and never modifies Google Sheets.
 */
export function CompanySheetsConnection({api,companyId,connection,onStatus,flash=()=>{},fail=()=>{},onChanged=()=>{}}){
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(false)
 useEffect(()=>{
  let current=true
  setLoading(true)
  api('sheets/connection',{action:'status'}).then(r=>{if(current)onStatus(r)}).catch(e=>{if(current)fail(e)}).finally(()=>{if(current)setLoading(false)})
  return()=>{current=false}
 },[api])
 const ready=connection?.configured===true,verified=connection?.verified===true
 const missing=connection?.configured===false
 const run=async action=>{
  if(busy)return
  setBusy(true)
  try{
   if(action==='test'){
    const result=await api('sheets/connection',{action:'test'})
    onStatus(result)
    if(result.verified)flash('Google Sheets connected successfully. '+(result.spreadsheetTitle||''))
    return
   }
   if(!ready)throw new Error('Set up and test the Google Sheets service account before synchronizing.')
   const r=await api('sheets',action==='import'?{action:'import'}:{action:'publish',companyId})
   if(action==='import')await onChanged()
   flash(r.message)
  }catch(e){fail(e)}finally{setBusy(false)}
 }
 function copyEmail(){
  if(!connection?.serviceAccountEmail)return
  if(!navigator.clipboard?.writeText){flash('Select the email shown and copy it.');return}
  navigator.clipboard.writeText(connection.serviceAccountEmail).then(()=>flash('Service-account email copied.')).catch(()=>flash('Select the email shown and copy it.'))
 }
 return <details className="section" open={missing?true:undefined} aria-label="Google Sheets connection setup">
  <summary>Google Sheets connection {loading?'· Checking…':connection?.status==='connected'?'· Connected':missing?'· Setup needed':ready?'· Ready to test':''}</summary>
  <p className="muted tiny">Company Lists and stock data remain available from the GH Procurement database even when this optional connection is offline. Google Sheets import, publish and reviewed catalogue preview require a separately authorized service account.</p>
  {loading&&!connection&&<p className="muted tiny">Checking the production connection…</p>}
  {connection&&<>
   <p role="status"><strong>{verified?'Connected':missing?'Setup required':connection.status==='connection_failed'?'Connection test failed':'Credentials configured; verification required'}</strong> · {connection.reason}</p>
   {connection.spreadsheetUrl&&<p className="muted tiny"><a href={connection.spreadsheetUrl} target="_blank" rel="noopener noreferrer">Open configured Company Items spreadsheet</a></p>}
   {connection.status==='connected'&&connection.spreadsheetTitle&&<p className="muted tiny">Verified spreadsheet: {connection.spreadsheetTitle}</p>}
   {!verified&&<div className="section">
    <strong>Finish connection setup</strong>
    <ol className="muted tiny">
     <li>In Google Cloud, enable the Google Sheets API and create a service account for this app (or reuse an authorized existing one).</li>
     <li>Open the Company Items sheet in Google Drive and share it with the service-account email as <strong>Editor</strong>.</li>
     <li>In Railway production service Variables, set <code>GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON</code> to the complete service-account JSON and confirm <code>COMPANY_ITEMS_SPREADSHEET_ID</code> points to the correct spreadsheet. Redeploy the service manually, then select Test connection.</li>
    </ol>
    {connection.serviceAccountEmail&&<div className="section"><span className="muted tiny">Service account to share with:</span><div className="toolbar" style={{overflowWrap:'anywhere'}}><code>{connection.serviceAccountEmail}</code><button type="button" className="btn small" onClick={copyEmail}>Copy email</button></div></div>}
    <p className="muted tiny">Do not paste the private JSON key into chat, a Google Sheet or GH Procurement form. Only store it in Railway's secured environment variables.</p>
   </div>}
  </>}
  <div className="toolbar section" style={{flexWrap:'wrap'}}>
   <button type="button" className="btn" disabled={busy||!ready||loading} onClick={()=>run('test')}>{busy?'Checking…':'Test connection'}</button>
   <button type="button" className="btn" disabled={busy||!ready||loading} onClick={()=>run('import')}>Import new tabs and items</button>
   <button type="button" className="btn" disabled={busy||!ready||loading||!companyId} onClick={()=>run('publish')}>Publish company tab</button>
  </div>
  <p className="muted tiny">Publishing an existing company creates or updates only its app-managed tab; it does not replace the original source tab. Reviewed updates are previewed separately and must be approved before changing app item descriptions.</p>
 </details>
}
