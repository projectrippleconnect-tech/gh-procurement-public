import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectCompanySheetsSettings} from '../lib/company-sheets-connection.mjs'

const id='1JusAK0GIme94j6PCf71r8ooIrEd9eDUgjNQtA1viQYU'
const json=JSON.stringify({type:'service_account',client_email:'gh-procurement@sample-project.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\nprivate-content\n-----END PRIVATE KEY-----\n'})
test('missing credentials reports a nonfatal status while retaining the sheet link',()=>{
 const status=inspectCompanySheetsSettings({spreadsheetId:id})
 assert.equal(status.status,'missing_service_account')
 assert.equal(status.configured,false)
 assert.equal(status.spreadsheetUrl,'https://docs.google.com/spreadsheets/d/'+id+'/edit')
 assert.equal(status.serviceAccountEmail,null)
})
test('missing spreadsheet ID never exposes a malformed link',()=>{
 const status=inspectCompanySheetsSettings({spreadsheetId:'../invalid',serviceAccountJson:json})
 assert.equal(status.status,'missing_spreadsheet')
 assert.equal(status.spreadsheetUrl,null)
})
test('invalid, personal and incomplete account credentials are rejected',()=>{
 assert.equal(inspectCompanySheetsSettings({spreadsheetId:id,serviceAccountJson:'not json'}).status,'invalid_service_account')
 assert.equal(inspectCompanySheetsSettings({spreadsheetId:id,serviceAccountJson:JSON.stringify({type:'authorized_user',client_email:'user@gmail.com',private_key:'abc'})}).configured,false)
 assert.equal(inspectCompanySheetsSettings({spreadsheetId:id,serviceAccountJson:JSON.stringify({type:'service_account',client_email:'bad@example.com',private_key:'abc'})}).configured,false)
})
test('valid service account reports only safe metadata, not private credentials',()=>{
 const status=inspectCompanySheetsSettings({spreadsheetId:id,serviceAccountJson:json})
 assert.equal(status.configured,true)
 assert.equal(status.status,'ready_to_test')
 assert.equal(status.verified,false)
 assert.equal(status.serviceAccountEmail,'gh-procurement@sample-project.iam.gserviceaccount.com')
 assert.ok(!JSON.stringify(status).includes('private-content'))
 assert.ok(!JSON.stringify(status).includes('-----BEGIN PRIVATE KEY-----'))
})
