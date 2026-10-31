const STAGES=Object.freeze([
 Object.freeze(['Review','requirements','≡']),
 Object.freeze(['Quotes','rfq','₨']),
 Object.freeze(['Orders','po','▤'])
])
export function visibleWorkflowStages(view,canNavigate=()=>false){
 if(!STAGES.some(([,target])=>target===view))return []
 const permitted=STAGES.filter(([,target])=>Boolean(canNavigate(target)))
 return permitted.length>1&&permitted.some(([,target])=>target===view)?permitted:[]
}
