export function normalizeSupplierChatId(phone:unknown):string
export function verifyPng(base64:unknown):Buffer
export function wahaImagePayload(args:{session?:string;phone:unknown;filename:string;base64:string;caption:string}):{
 session:string;chatId:string;file:{mimetype:string;filename:string;data:string};caption:string
}
export function extractWahaMessageId(data:unknown):string|null

export function hasGatewayPermission(permissions:unknown,key:string):boolean
