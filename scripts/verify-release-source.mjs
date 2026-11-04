import {existsSync} from 'node:fs'
import {requiredReleaseFiles} from '../lib/release-capabilities.mjs'
const missing=requiredReleaseFiles.filter(p=>!existsSync(p))
if(missing.length)throw Error('Incomplete procurement source; release blocked: '+missing.join(', '))
console.log('PASS required procurement source modules present')
