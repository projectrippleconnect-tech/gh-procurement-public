import {WORKFLOW_ACTIONS} from './workflow-model.mjs'
export const PROCUREMENT_STEPS=WORKFLOW_ACTIONS
export function stepForView(view){return {stock:1,requirements:2,rfq:4,po:6,receiving:6}[view]||1}
export function viewForStep(step,hasRfq=false){return step===3&&hasRfq?'rfq':PROCUREMENT_STEPS.find(s=>s.id===step)?.view||'stock'}
