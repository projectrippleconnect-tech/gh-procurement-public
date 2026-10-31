import {PURCHASING_SECTIONS} from './workflow-model.mjs'
const STAGES=Object.freeze(PURCHASING_SECTIONS.map(s=>Object.freeze([s.label,s.view,s.icon])))
export function visibleWorkflowStages(view,canNavigate=()=>false){
 if(!STAGES.some(([,target])=>target===view))return []
 const permitted=STAGES.filter(([,target])=>Boolean(canNavigate(target)))
 return permitted.length>1&&permitted.some(([,target])=>target===view)?permitted:[]
}
