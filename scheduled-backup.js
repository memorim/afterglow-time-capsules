import pg from 'pg';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { poolOptions } from './postgres.js';
import { exportSnapshot, verifyRestore } from './postgres-snapshot.js';
const bucket='afterglow-backups';
const hash=b=>createHash('sha256').update(b).digest('hex');
let source, verification, s3;
function resources() {
  if (!process.env.SOURCE_DATABASE_URL || !process.env.DATABASE_URL) throw new Error('Database configuration required');
  source??=new pg.Pool({...poolOptions(process.env.SOURCE_DATABASE_URL),max:1});
  verification??=new pg.Pool({...poolOptions(process.env.DATABASE_URL),max:1});
  for (const pool of [source,verification]) if (!pool.listenerCount('error')) pool.on('error',()=>console.error({event:'backup_database_unavailable'}));
  s3??=new S3Client({forcePathStyle:true});
  return {source,verification,s3};
}
export async function backupOnce({source,verification,s3}, now=new Date()) {
  const target=await verification.connect(); let reader;
  try {
    await target.query('BEGIN');
    const lock=await target.query("SELECT pg_try_advisory_xact_lock(39180241) AS locked");
    if (!lock.rows[0].locked) return {status:'busy'};
    let bytes=0, token;
    do {
      const page=await s3.send(new ListObjectsV2Command({Bucket:bucket,Prefix:'snapshots/',ContinuationToken:token}));
      bytes+=(page.Contents||[]).reduce((n,o)=>n+(o.Size||0),0);
      token=page.IsTruncated?page.NextContinuationToken:undefined;
    } while(token);
    // Stop safely within the free allowance; never upgrade billing or remove old copies.
    if (bytes>2*1024*1024*1024) throw new Error('Backup storage budget reached');
    reader=await source.connect();
    const snapshot=await exportSnapshot(reader); reader.release(); reader=undefined;
    const body=gzipSync(Buffer.from(JSON.stringify(snapshot)));
    const checksum=hash(body);
    const key='snapshots/'+now.toISOString().replaceAll(':','-')+'-'+checksum.slice(0,16)+'.json.gz';
    await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'application/gzip',Metadata:{sha256:checksum}}));
    const stored=await s3.send(new GetObjectCommand({Bucket:bucket,Key:key}));
    const downloaded=Buffer.from(await stored.Body.transformToByteArray());
    if(hash(downloaded)!==checksum)throw new Error('Stored bytes differ');
    const restored=await verifyRestore(target,JSON.parse(gunzipSync(downloaded,{maxOutputLength:24*1024*1024})));
    const result={status:'verified',key,sha256:checksum,bytes:body.length,...restored,verifiedAt:new Date().toISOString()};
    await s3.send(new PutObjectCommand({Bucket:bucket,Key:key+'.verified.json',Body:JSON.stringify(result),ContentType:'application/json'}));
    return result;
  } finally {
    reader?.release();
    try {await target.query('ROLLBACK');} finally {target.release();}
  }
}
export default {
  async fetch(request) {
    if(new URL(request.url).pathname!=='/cron')return new Response('Not found',{status:404});
    if(request.method!=='POST')return new Response('Method not allowed',{status:405});
    const parsed=await parseTriggerDelivery(request);
    if(!parsed.ok)return new Response('Unauthorized',{status:401});
    if(parsed.invocation.type!=='schedule'||parsed.invocation.trigger.name!=='afterglow-backup')return new Response('Unexpected trigger',{status:403});
    try {const result=await backupOnce(resources());console.log(JSON.stringify({event:'backup',...result}));return Response.json(result);}
    catch {
      console.error(JSON.stringify({event:'backup',status:'failed'}));
      if(process.env.NTFY_TOPIC) await fetch('https://ntfy.sh/',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/json'},body:JSON.stringify({topic:process.env.NTFY_TOPIC,title:'Afterglow backup',message:'Scheduled backup failed. Check the private backup worker.'})}).catch(()=>{});
      return Response.json({status:'failed'},{status:503});
    }
  }
};
