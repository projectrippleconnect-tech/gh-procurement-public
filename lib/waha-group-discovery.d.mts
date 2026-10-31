export interface WahaGroup {id:string;name:string}
export function parseWahaGroups(raw:unknown):{recognized:boolean;items:WahaGroup[]}
export function parseWahaChats(raw:unknown):WahaGroup[]
export function groupMatches(items:WahaGroup[],labels?:string[]):WahaGroup[]
export function wahaGroupJid(value:unknown):string
export function wahaGroupName(value:unknown):string
export function wahaResponseShape(value:unknown):{type:string;keys:string[];entryCount:number;preview:Array<{field:string;type:string;size:number;childKeys:string[];sampleKeys:string[]}>}
