import {companyAccess,companyBody,companyReply,sheetsRequest,sheetsToken} from '@/lib/company-server'
// @ts-ignore Pure credential diagnostic is tested with Node's native test runner.
import {inspectCompanySheetsSettings} from '@/lib/company-sheets-connection.mjs'

export const runtime='nodejs'
export const dynamic='force-dynamic'

/**
 * Admin-only, nonmutating diagnostics.
 * The app's user JWT never grants Google access by itself: the Railway
 * server must hold its own service-account key shared with the spreadsheet.
 */
export async function POST(request:Request){
 try{
  await companyAccess(request,true)
  const body=await companyBody(request)
  if(body?.action!=='status'&&body?.action!=='test')return companyReply({ok:false,error:'Choose connection status or test.'},400)
  const settings=inspectCompanySheetsSettings({
   spreadsheetId:process.env.COMPANY_ITEMS_SPREADSHEET_ID,
   serviceAccountJson:process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
  })
  if(body.action==='status'||!settings.configured)return companyReply({ok:true,...settings})
  try{
   const token=await sheetsToken()
   const sheet=await sheetsRequest(token,'?fields=spreadsheetId,properties(title)')
   return companyReply({ok:true,...settings,verified:true,status:'connected',
    spreadsheetTitle:String(sheet?.properties?.title||'Company Items'),
    reason:'Service account connected and can read the configured spreadsheet.'})
  }catch{
   return companyReply({ok:true,...settings,verified:false,status:'connection_failed',
    reason:'Could not authenticate or open the spreadsheet. Confirm the Sheets API is enabled and grant the service-account email Editor access to the configured sheet.'})
  }
 }catch(e){
  return companyReply({ok:false,error:e instanceof Error?e.message:'Company access denied.'},403)
 }
}
