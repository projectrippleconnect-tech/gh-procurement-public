export interface WahaGatewayConfig {base:string;key:string;session:string}
export function gatewayConfig(env?:NodeJS.ProcessEnv):WahaGatewayConfig|null
