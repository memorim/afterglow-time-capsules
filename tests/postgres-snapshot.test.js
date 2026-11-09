import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import {createPostgresFactory,poolOptions} from '../postgres.js';
import {exportSnapshot,verifyRestore,restoreToEmpty,validateSnapshot} from '../postgres-snapshot.js';
import handler,{backupOnce} from '../scheduled-backup.js';
process.env.NODE_ENV='test';
const {createDb,unseal}=await import('../server.js');
const url=process.env.POSTGRES_TEST_URL;

test('backup endpoint rejects unauthenticated invocation',async()=>{
 const r=await handler.fetch(new Request('https://example.test/cron',{method:'POST',body:'{}'}));assert.equal(r.status,401);
});
test('snapshot restores encrypted data, identities and budgets; corruption cannot be verified',{skip:!url},async()=>{
 const factory=createPostgresFactory(url,{seedDb:createDb});
 const pool=new pg.Pool(poolOptions(url));
 let reader,target;
 try {
  const db=await factory.open(randomBytes(32).toString('hex')+'.db');
  await db.consumeBudget('persisted',3,Date.now());
  reader=await pool.connect();
  const snapshot=await exportSnapshot(reader);reader.release();reader=undefined;
  target=await pool.connect();await target.query('BEGIN');
  const verified=await verifyRestore(target,snapshot);assert.ok(verified.capsules>=4);
  const selected=structuredClone(snapshot.accounts.find(a=>a.schema===db.schema));
  selected.schema='ag_restore'+randomBytes(8).toString('hex');
  const recovery={...snapshot,accounts:[selected]};
  await restoreToEmpty(target,recovery);
  const row=(await target.query(`SELECT * FROM "${selected.schema}".capsules WHERE id=1`)).rows[0];
  assert.ok(unseal(row,'light').length>10);
  const n=(await target.query(`SELECT nextval(pg_get_serial_sequence('"${selected.schema}".capsules','id')) AS n`)).rows[0].n;
  assert.equal(Number(n),5);
  await target.query('ROLLBACK');target.release();target=undefined;
  const corrupt=structuredClone(snapshot);corrupt.accounts[0].capsules[0].title+='tampered';
  assert.throws(()=>validateSnapshot(corrupt),/digest/);
  const objects=new Map();let breakRead=false;
  const s3={async send(command){const i=command.input;switch(command.constructor.name){
   case 'ListObjectsV2Command':return {Contents:[]};
   case 'PutObjectCommand':objects.set(i.Key,Buffer.from(i.Body));return {};
   case 'GetObjectCommand':return {Body:{async transformToByteArray(){return breakRead?Buffer.from('corrupt'):objects.get(i.Key);}}};
   default:throw new Error('Unexpected storage operation');
  }}};
  const result=await backupOnce({source:pool,verification:pool,s3});assert.equal(result.status,'verified');
  assert.ok(objects.has(result.key+'.verified.json'));
  breakRead=true;const markerCount=[...objects.keys()].filter(k=>k.endsWith('.verified.json')).length;
  await assert.rejects(()=>backupOnce({source:pool,verification:pool,s3}),/Stored bytes differ/);
  assert.equal([...objects.keys()].filter(k=>k.endsWith('.verified.json')).length,markerCount);
 } finally {reader?.release();if(target){await target.query('ROLLBACK');target.release();}await pool.end();await factory.close();}
});
