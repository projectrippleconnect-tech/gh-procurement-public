import {readFileSync} from 'node:fs'
import {requiredReleaseRoutes} from '../lib/release-capabilities.mjs'
const paths=JSON.parse(readFileSync('.next/server/app-paths-manifest.json','utf8'))
const missing=requiredReleaseRoutes.filter(p=>!paths[p])
if(missing.length)throw Error('Required procurement routes missing from build; release blocked: '+missing.join(', '))
console.log('PASS built supplier portals and server dispatch routes present')
