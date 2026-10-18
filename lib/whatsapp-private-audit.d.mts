// Type contract for server-only archive code.
export function privateGroupConfig(env?:Record<string,string|undefined>):
 {ready:false;reason:string;groupId?:never;groupName?:never;approved?:never} |
 {ready:true;groupId:string;groupName:string;approved:string[];ownerOnly?:boolean}
export function inspectPrivateGroup(input:{group:unknown;participants:unknown;config:ReturnType<typeof privateGroupConfig>;sessionMe?:unknown}):{ok:boolean;reason:string}
export function privateGroupCaption(input:{kind:'po'|'rfq';number:string;supplier:string;dispatchId:string;originalCaption:string;at?:string}):string
export function mirrorStaffGroupCopy(input:{
 db:any;kind:'po'|'rfq'|'company_po'|'company_rfq';sourceId:string;pageNumber?:number;session:string;base:string;key:string;
 base64:string;filename:string;caption:string;imageHash:string;config?:unknown
}):Promise<{status:string;reason:string}>
export function resolveOwnerMemberAliases(input:{base:string;session:string;key:string;memberIds:unknown[];sessionMe:unknown;read?:(url:string,key:string)=>Promise<any>}):Promise<{ok:boolean;reason:string}>

export function wahaMemberId(value:unknown):string|null
