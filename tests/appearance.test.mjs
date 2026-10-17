import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const css=readFileSync(new URL('../app/appearance.css',import.meta.url),'utf8')
const js=readFileSync(new URL('../components/appearance-controls.jsx',import.meta.url),'utf8')

function luminance(color){
 const values=color.match(/[a-f\d]{2}/gi)?.map(x=>parseInt(x,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4)
 assert.equal(values?.length,3,'Expected opaque six-digit hexadecimal colour')
 return values[0]*.2126+values[1]*.7152+values[2]*.0722
}
function contrast(a,b){
 const l1=luminance(a),l2=luminance(b)
 return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)
}
function palette(theme,mode){
 const rx=new RegExp('html\\[data-gh-theme="'+theme+'"\\]\\[data-gh-mode="'+mode+'"\\] \\{([\\s\\S]*?)\\n\\}')
 const match=css.match(rx)
 assert.ok(match,'Missing '+theme+'/'+mode+' palette')
 return Object.fromEntries([...match[1].matchAll(/--(gh-[\w-]+):([^;]+);/g)].map(m=>[m[1],m[2].trim()]))
}

test('six neon skins keep text, labels, controls and navigation clearly legible',()=>{
 for(const theme of ['blue','green','slate']){
  for(const mode of ['light','dark']){
   const p=palette(theme,mode)
   for(const [label,front,back] of [
    ['body','gh-text','gh-surface'],
    ['muted','gh-muted','gh-surface'],
    ['field','gh-text','gh-field'],
    ['navigation','gh-text','gh-nav'],
    ['primary button','gh-on-accent','gh-accent'],
    ['accent heading','gh-accent-2','gh-surface']
   ]){
    assert.ok(contrast(p[front],p[back])>=4.5,theme+'/'+mode+' '+label+' contrast inadequate')
   }
  }
 }
})
test('original Classic styling and print output remain isolated',()=>{
 assert.match(css,/not\(\[data-gh-theme="classic"\]\)/)
 assert.match(js,/theme:'classic'/)
 assert.match(css,/@media screen \{/)
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)/)
 assert.match(css,/@media \(prefers-reduced-motion:no-preference\)/)
 assert.match(js,/prefers-reduced-motion: reduce/)
 assert.doesNotMatch(js,/(?:fetch\(|supabase|axios|XMLHttpRequest)/)
 assert.match(js,/localStorage\.setItem\(KEY/)
})
test('neon options remain independently selectable without changing business state',()=>{
 for(const name of ['Cyber Circuit','Quantum Matrix','Plasma Pulse','Classic']){
  assert.ok(js.includes(name),name+' choice not available')
 }
 assert.match(js,/addEventListener\('pointerdown',tap,\{passive:true\}\)/)
 assert.match(js,/aria-hidden/)
 assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length,'CSS blocks not balanced')
})
