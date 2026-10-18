'use client'

// Restricted stock roles never mount the purchasing dashboard or its network
// requests. Only authorized stock-related destinations are presented.
export function StockOnlyHome({navigate=()=>{},canNavigate=()=>false}){
 return <section className="card pad section" aria-labelledby="stock-workspace-title">
  <h3 id="stock-workspace-title">Stock workspace</h3>
  <p>Enter physical stock quantities, review your submissions, and report urgent stock issues.</p>
  <div className="toolbar section">
   {canNavigate('stock')&&<button type="button" className="btn primary" onClick={()=>navigate('stock')}>Open Stock Entry →</button>}
   {canNavigate('urgent_actions')&&<button type="button" className="btn" onClick={()=>navigate('urgent_actions')}>Urgent Stock Items →</button>}
  </div>
 </section>
}
