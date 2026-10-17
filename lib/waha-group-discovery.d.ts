export interface WahaGroup {id:string;name:string}
export function parseWahaGroups(raw:unknown):{recognized:boolean;items:WahaGroup[]}
export function parseWahaChats(raw:unknown):WahaGroup[]
export function groupMatches(items:WahaGroup[],labels?:string[]):WahaGroup[]
