import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
function expand(file){return fs.readFileSync(file,'utf8').split('\n').map(line=>{const m=line.match(/^\\ir\s+(.+)$/);if(m)return expand(path.resolve(path.dirname(file),m[1]));return line.startsWith('\\')?'':line}).join('\n')}
export const databaseRegressionFiles=['tests/procurement-workflow.sql','tests/sql/workflow-efficiency.sql','tests/sql/role-boundaries.sql','tests/sql/disabled-role-helper.sql','tests/sql/large-stock-count.sql','tests/sql/api-table-privileges.sql','tests/sql/additional-sizes.sql','tests/sql/quote-variations.sql','tests/sql/add-rfq-supplier.sql','tests/sql/company-items.sql','tests/sql/custom-role-cloning.sql','tests/sql/user-removal.sql','tests/sql/admin-data-management.sql','tests/sql/reset-preserves-company-catalogue.sql','tests/sql/admin-safeupdate-static.sql','tests/sql/company-submit-boundaries.sql','tests/sql/company-supplier-setup.sql','tests/sql/receiving-closure.sql','tests/sql/supplier-portal.sql','tests/sql/supplier-portal-boundaries.sql','tests/sql/supplier-portal-native-fixture.sql','tests/sql/rpc-business-conflicts.sql','tests/sql/portal-database-scheduler.sql','tests/sql/supplier-portal-otp.sql']
export async function runDatabaseRegression(db,snapshot,files=databaseRegressionFiles){
const log=[]
const tableNames=snapshot.tables.map(t=>t.sql.match(/^CREATE TABLE (\S+)/)[1])
async function rowCounts(){const counts={};for(const name of tableNames){const r=await db.query('SELECT count(*)::integer n FROM '+name);counts[name]=r.rows[0].n}return counts}
const seededCounts=await rowCounts()
for(const file of files){
 const started=Date.now()
 try{const sql=expand(path.resolve(file)),result=await db.exec(/^begin;/im.test(sql)?sql:'BEGIN;\n'+sql+'\nROLLBACK;');assert.deepEqual(await rowCounts(),seededCounts,'Test failed to roll back its fixture records');log.push({file,status:'passed',ms:Date.now()-started,checks:result.flatMap(x=>x.rows||[])})}
 catch(e){await db.exec('ROLLBACK;RESET ROLE;');log.push({file,status:'failed',ms:Date.now()-started,error:e.message,where:e.where})}
 console.log(JSON.stringify(log.at(-1)))
}
return log
}
