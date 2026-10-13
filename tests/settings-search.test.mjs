import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeSettingsSearch,settingsMatch} from '../lib/settings-search.mjs'
test('settings searches match multiple terms across labels and punctuation',()=>{
 assert.equal(normalizeSettingsSearch('Time & Location'), 'time location')
 assert.ok(settingsMatch('Time & Location Restrictions Opening time Sri Lanka','location sri'))
 assert.ok(settingsMatch('Screenshot Protection','SCREENSHOT'))
 assert.ok(settingsMatch('பயனர் அமைப்புகள்','பயனர்'))
 assert.ok(settingsMatch('Users',''))
 assert.equal(settingsMatch('Interface Fonts and spacing','screenshot'),false)
})
