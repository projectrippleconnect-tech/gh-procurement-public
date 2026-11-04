export type WahaGateway={base:string;key:string;session:string}
export function wahaGatewayConfig(env?:Record<string,string|undefined>):WahaGateway|null
