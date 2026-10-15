'use client'
/**
 * This fallback is intentionally in the same browser form, not an attempt
 * to read the device address book without an explicit file or picker selection.
 */
export function PhoneContactImportHelp({visible=false}){
 if(!visible)return null
 return <div className="section" role="status" aria-label="Alternative to Android contact picker" style={{padding:'12px',border:'1px solid var(--line, #38455c)',borderRadius:12}}>
  <strong>Contact picker empty or closes?</strong>
  <p className="muted tiny">The search screen belongs to Android, so GH Procurement cannot make hidden phone contacts appear or keep that native screen open. Your entered supplier name and number remain in this form.</p>
  <ol className="muted tiny">
   <li>Open your phone's <strong>Contacts</strong> app and find the supplier there.</li>
   <li>Choose <strong>Share contact</strong> (or Export), select the <strong>vCard / .vcf</strong> format, and save the file to your phone. Menu wording varies by phone.</li>
   <li>Return here, tap <strong>Import .vcf</strong>, and select the saved file. Search the imported contacts, tap Choose, edit the name or number, then Save contact.</li>
  </ol>
  <p className="muted tiny">If the native picker still says “No contacts found,” confirm your contacts are visible in the phone's Contacts app and in the correct personal or work profile. Only the contact you explicitly save is added to GH Procurement; the full .vcf file stays on your phone.</p>
 </div>
}
