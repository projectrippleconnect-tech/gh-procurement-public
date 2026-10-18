import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'

// Regression: mobile submit is portaled directly as a primary button, whereas
// Company Items renders a button inside a transparent dock container.
test('General stock mobile Submit has a visible primary background and readable label',()=>{
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
 const match=css.match(/\.app \.stock-header-action button\.btn\.primary\.stock-submit-dock\s*\{([^}]+)\}/)
 assert.ok(match,'General stock Submit needs an explicit mobile-header style')
 const rule=match[1]
 assert.match(rule,/background:\s*linear-gradient\(/)
 assert.match(rule,/color:\s*#18130a/)
 assert.match(rule,/border:\s*1px solid var\(--brand2\)/)
})
