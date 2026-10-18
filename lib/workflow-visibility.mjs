// Never render inaccessible workflow stages. A user authorized for only
// one stage gets a focused workspace without any procurement flow navigation.
const STAGES=Object.freeze([
 Object.freeze(['Stock','stock','✓']),
 Object.freeze(['Review','requirements','≡']),
 Object.freeze(['Prices','rfq','₨']),
 Object.freeze(['Order','po','▤']),
 Object.freeze(['Receive','receiving','⇩'])
])

export function visibleWorkflowStages(view,canNavigate=()=>false){
 if(!STAGES.some(([,target])=>target===view))return []
 const permitted=STAGES.filter(([,target])=>Boolean(canNavigate(target)))
 return permitted.length>1&&permitted.some(([,target])=>target===view)?permitted:[]
}
