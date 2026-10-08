import {copyFile,mkdir,readdir} from 'node:fs/promises'
import {dirname,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

const here=dirname(fileURLToPath(import.meta.url))
const root=resolve(here,'..')

async function copy(src,dest){
  await mkdir(dirname(dest),{recursive:true})
  await copyFile(src,dest)
}

await copy(
  resolve(root,'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'),
  resolve(root,'public/pdf.worker.min.mjs')
)

await copy(
  resolve(root,'node_modules/tesseract.js/dist/worker.min.js'),
  resolve(root,'public/tesseract/worker.min.js')
)

const coreDir=resolve(root,'node_modules/tesseract.js-core')
for(const name of await readdir(coreDir)){
  if(/^tesseract-core.*\.(?:js|wasm)$/.test(name)){
    await copy(resolve(coreDir,name),resolve(root,'public/tesseract-core',name))
  }
}

console.log('Copied PDF.js + Tesseract OCR browser workers/core assets')
