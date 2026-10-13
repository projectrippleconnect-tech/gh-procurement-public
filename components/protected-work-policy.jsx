'use client'

export function ProtectedWorkPolicy({admin=false}){
 return <details className="notice" data-protected-work-policy><summary>Protected work-session policy</summary>
  <p>GH Procurement must be used through an authorized protected work-browser session. Screenshots and screen recordings of the interface are prohibited for all non-Super-Admin users.</p>
  <p>Super Admin may authorize a capture exception through the browser-management policy. A GH password or shared link does not authorize an exception.</p>
  <p>Personal phones may be used with a supported protected work-browser session. A dedicated company phone or GH Android app is not required.</p>
  <p className="muted tiny"><b>Technical enforcement is not active:</b> this is a policy notice. Ordinary browser sessions can still capture the screen until browser-management protection and server access verification are configured.</p>
  {admin&&<><h4>Activation requirements</h4><p>Connect Microsoft Intune and Entra Conditional Access, assign the screenshot-blocking work-browser policy to staff, and require verified protected sessions for GH Procurement and its data APIs. Keep Super Admin exceptions in the management policy and verify them on a supported device.</p><p className="muted tiny">A browser name, user-agent string or checkbox is not proof of protection. Website settings alone cannot change the browser capture policy. Management licenses and setup are separate.</p></>}
 </details>
}
