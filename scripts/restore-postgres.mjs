import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import pg from 'pg';
import {poolOptions} from '../postgres.js';
import {restoreToEmpty} from '../postgres-snapshot.js';
if(!process.env.RESTORE_DATABASE_URL||!process.argv[2])throw new Error('Set RESTORE_DATABASE_URL for a NEW database and pass snapshot.json.gz');
const snapshot=JSON.parse(gunzipSync(readFileSync(process.argv[2]),{maxOutputLength:24*1024*1024}));
const client=new pg.Client(poolOptions(process.env.RESTORE_DATABASE_URL));
try {
 await client.connect(); await client.query('BEGIN');
 const result=await restoreToEmpty(client,snapshot);
 await client.query('COMMIT');console.log(JSON.stringify({status:'restored',...result}));
} catch {await client.query('ROLLBACK').catch(()=>{});console.error('Restore failed; transaction rolled back');process.exitCode=1;}
finally {await client.end();}
