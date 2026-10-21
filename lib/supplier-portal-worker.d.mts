export function authorizedWorker(request:Request,env:NodeJS.ProcessEnv):boolean;
export function runPortalWorker(options?:{env?:NodeJS.ProcessEnv;db?:unknown;fetcher?:typeof fetch;render?:unknown}):Promise<unknown>;
