// In-memory PostgreSQL only. No database URL, live user, gateway or business rows.
import fs from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto'
import {bootstrapProcurementSchema} from './schema-bootstrap.mjs'
import {runDatabaseRegression,databaseRegressionFiles} from './database-regression.mjs'
const db=new PGlite({extensions:{pgcrypto}})
const {snapshot,meta,patches}=await bootstrapProcurementSchema(db)
const log=await runDatabaseRegression(db,snapshot,process.argv.length>2?process.argv.slice(2):databaseRegressionFiles)
fs.mkdirSync('test-results',{recursive:true})
fs.writeFileSync('test-results/full-database.json',JSON.stringify({baseline:meta.source_commit,patches,results:log},null,2))
await db.close()
if(log.some(x=>x.status==='failed'))process.exitCode=1
