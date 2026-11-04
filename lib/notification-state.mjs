export function isOpenIssue(row,now=Date.now()){
 return Boolean(row.issue_key&&!row.resolved_at&&(!row.snoozed_until||Date.parse(row.snoozed_until)<=now))
}
export function newlyArrivedNotifications(previous,rows,now=Date.now()){
 if(!previous)return []
 return rows.filter(n=>!previous.has(n.id)&&!n.read_at&&!n.resolved_at&&(!n.snoozed_until||Date.parse(n.snoozed_until)<=now))
}
export function notificationDestination(row){
 const views=new Set(['stock','rfq','po','receiving','invoices','urgent_actions','supplier_access'])
 return {view:views.has(row.target_view)?row.target_view:'urgent_actions',filter:row.target_filter||(['rfq','po'].includes(row.target_view)?row.record_id||'':'')}
}
