/**
 * Safe, read-only diagnostics for GH Procurement's optional Google Sheets link.
 * Never send JSON keys, private-key fragments or access tokens to the browser.
 */
export function inspectCompanySheetsSettings({spreadsheetId,serviceAccountJson}={}){
 const id=typeof spreadsheetId==='string'?spreadsheetId.trim():''
 const validSpreadsheet=/^[A-Za-z0-9_-]{15,100}$/.test(id)
 const base={configured:false,verified:false,spreadsheetId:validSpreadsheet?id:null,spreadsheetUrl:validSpreadsheet?'https://docs.google.com/spreadsheets/d/'+id+'/edit':null,serviceAccountEmail:null}
 if(!validSpreadsheet)return {...base,status:'missing_spreadsheet',reason:'COMPANY_ITEMS_SPREADSHEET_ID is missing or invalid.'}
 if(!serviceAccountJson)return {...base,status:'missing_service_account',reason:'GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON has not been set in Railway.'}
 let account
 try{account=JSON.parse(serviceAccountJson)}
 catch{return {...base,status:'invalid_service_account',reason:'The service-account JSON cannot be parsed.'}}
 if(!account||account.type!=='service_account'||typeof account.client_email!=='string'||!account.client_email.endsWith('.gserviceaccount.com')||typeof account.private_key!=='string'||!account.private_key.includes('-----BEGIN PRIVATE KEY-----')||!account.private_key.includes('-----END PRIVATE KEY-----')){
  return {...base,status:'invalid_service_account',reason:'The service-account JSON must contain a client email and a valid PEM private key.'}
 }
 return {...base,configured:true,status:'ready_to_test',reason:'Credentials are present. Verify authentication and spreadsheet access.',serviceAccountEmail:account.client_email}
}
