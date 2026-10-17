// Type contract for server-only archive code.
export function privateGroupConfig(env?:Record<string,string|undefined>):
 {ready:false;reason:string;groupId?:never;groupName?:never;approved?:never} |
 {ready:true;groupId:string;groupName:string;approved:string[]}
export function inspectPrivateGroup(input:{group:unknown;participants:unknown;config:ReturnType<typeof privateGroupConfig>}):{ok:boolean;reason:string}
export function privateGroupCaption(input:{kind:'po'|'rfq';number:string;supplier:string;dispatchId:string;originalCaption:string;at?:string}):string
export function mirrorStaffGroupCopy(input:{
 db:any;kind:'po'|'rfq';supplierDispatchId:string;session:string;base:string;key:string;
 base64:string;filename:string;caption:string;imageHash:string;config?:unknown
}):Promise<{status:string;reason:string}>
