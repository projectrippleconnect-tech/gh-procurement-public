export interface InviteInfo {id:string;name:string;memberCount:number|null;isCommunity:boolean}
export function inviteCodes(raw:string):string[]
export function normalizeInviteInfo(value:unknown):InviteInfo|null
export function preferredInviteRoles(info:InviteInfo|null):'RFQ'|'PO'|'GENERAL'|null
