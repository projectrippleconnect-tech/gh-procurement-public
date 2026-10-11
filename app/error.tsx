'use client'

export default function WorkspaceError({reset}:{error:Error & {digest?:string};reset:()=>void}){
 return <div className="login-shell"><div className="card login" role="alert">
  <div className="logo">GH</div><h1>This screen could not load</h1>
  <p>Try loading it again. Saved drafts remain on this device.</p>
  <div className="toolbar section">
   <button className="btn primary" onClick={reset}>Try again</button>
   <button className="btn" onClick={()=>window.location.reload()}>Reload app</button>
  </div>
 </div></div>
}
