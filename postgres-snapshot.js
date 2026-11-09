import { createHash, randomUUID } from 'node:crypto';
export const capsuleColumns = ['id','title','sender','recipient','unlock_at','theme','color','hint','ciphertext','salt','iv','tag','created_at'];
const budgetColumns = ['key','count','reset_at'];
export function digest(value) {
  const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function validateSnapshot(snapshot) {
  if (snapshot.version !== 1 || !Array.isArray(snapshot.accounts) || !snapshot.accounts.length || snapshot.accounts.length > 100 || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new Error('Invalid snapshot');
  const schemas = new Set();
  for (const a of snapshot.accounts) {
    if (!/^ag_[a-z0-9]{1,50}$/.test(a.schema) || schemas.has(a.schema)) throw new Error('Invalid account');
    schemas.add(a.schema);
    for (const [rows, columns] of [[a.capsules,capsuleColumns],[a.budgets,budgetColumns]]) {
      if (!Array.isArray(rows) || rows.length > 100000) throw new Error('Invalid rows');
      for (const row of rows) if (Object.keys(row).sort().join(',') !== [...columns].sort().join(',')) throw new Error('Invalid columns');
    }
    for (const row of a.capsules) {
      if (!Number.isSafeInteger(row.id) || row.id < 1 || capsuleColumns.slice(1).some(k=>typeof row[k] !== 'string')) throw new Error('Invalid capsule');
      if (!/^[a-f0-9]*$/.test(row.ciphertext) || row.ciphertext.length % 2 || !/^[a-f0-9]{32}$/.test(row.salt) || !/^[a-f0-9]{24}$/.test(row.iv) || !/^[a-f0-9]{32}$/.test(row.tag)) throw new Error('Invalid encryption fields');
    }
    for (const row of a.budgets) if (typeof row.key !== 'string' || !Number.isInteger(row.count) || row.count < 0 || !/^\d+$/.test(String(row.reset_at))) throw new Error('Invalid budget');
    if (a.sha256 !== digest({capsules:a.capsules,budgets:a.budgets})) throw new Error('Snapshot digest mismatch');
  }
  return snapshot;
}
export async function exportSnapshot(client, {maxBytes=20*1024*1024} = {}) {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const schemas = (await client.query("SELECT nspname FROM pg_namespace WHERE nspname ~ '^ag_[a-z0-9]{1,50}$' ORDER BY nspname")).rows;
    if (!schemas.length || schemas.length > 100) throw new Error('No valid account set');
    const accounts=[]; let bytes=0;
    for (const {nspname:schema} of schemas) {
      const account={schema,capsules:[],budgets:[]};
      for (const [table, key, order] of [['capsules','capsules','id'],['request_budgets','budgets','key']]) {
        await client.query(`DECLARE snapshot_rows NO SCROLL CURSOR FOR SELECT * FROM "${schema}".${table} ORDER BY ${order}`);
        while (true) {
          const {rows}=await client.query('FETCH FORWARD 500 FROM snapshot_rows');
          if (!rows.length) break;
          bytes+=Buffer.byteLength(JSON.stringify(rows));
          if (bytes>maxBytes || account[key].length+rows.length>100000) throw new Error('Snapshot size limit');
          account[key].push(...rows);
        }
        await client.query('CLOSE snapshot_rows');
      }
      account.sha256=digest({capsules:account.capsules,budgets:account.budgets}); accounts.push(account);
    }
    const snapshot=validateSnapshot({version:1,createdAt:new Date().toISOString(),accounts});
    await client.query('COMMIT'); return snapshot;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
}
// Restores into session-private tables, never overwrites an application schema.
export async function verifyRestore(client, snapshot) {
  validateSnapshot(snapshot); let capsules=0;
  for (const a of snapshot.accounts) {
    const suffix=randomUUID().replaceAll('-','');
    const cap='restore_capsules_'+suffix, budget='restore_budgets_'+suffix;
    await client.query(`CREATE TEMP TABLE ${cap}(id integer PRIMARY KEY,${capsuleColumns.slice(1).map(c=>c+' text NOT NULL').join(',')}) ON COMMIT DROP`);
    await client.query(`CREATE TEMP TABLE ${budget}(key text PRIMARY KEY,count integer NOT NULL,reset_at bigint NOT NULL) ON COMMIT DROP`);
    for (const [name,rows,columns] of [[cap,a.capsules,capsuleColumns],[budget,a.budgets,budgetColumns]]) {
      for (let i=0;i<rows.length;i+=200) {
        const batch=rows.slice(i,i+200),values=[];
        const groups=batch.map(row=>'('+columns.map(c=>{values.push(row[c]);return '$'+values.length;}).join(',')+')');
        await client.query(`INSERT INTO ${name}(${columns.join(',')}) VALUES ${groups.join(',')}`,values);
      }
    }
    const restored={capsules:(await client.query(`SELECT * FROM ${cap} ORDER BY id`)).rows,budgets:(await client.query(`SELECT * FROM ${budget} ORDER BY key`)).rows};
    if (digest(restored)!==a.sha256) throw new Error('Restored rows differ');
    capsules+=restored.capsules.length;
  }
  return {accounts:snapshot.accounts.length,capsules};
}

// Caller owns the transaction. CREATE SCHEMA deliberately fails if a target exists.
export async function restoreToEmpty(client, snapshot) {
  validateSnapshot(snapshot);
  for (const a of snapshot.accounts) {
    const schema='"'+a.schema+'"';
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`CREATE TABLE ${schema}.capsules(id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,${capsuleColumns.slice(1).map(c=>c+' text NOT NULL').join(',')})`);
    await client.query(`CREATE INDEX capsules_unlock_order ON ${schema}.capsules(unlock_at,id)`);
    await client.query(`CREATE TABLE ${schema}.request_budgets(key text PRIMARY KEY,count integer NOT NULL,reset_at bigint NOT NULL)`);
    for (const [table,rows,columns] of [['capsules',a.capsules,capsuleColumns],['request_budgets',a.budgets,budgetColumns]]) {
      for (const row of rows) await client.query(`INSERT INTO ${schema}.${table}(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`,columns.map(k=>row[k]));
    }
    const next=a.capsules.reduce((n,c)=>Math.max(n,c.id),0)+1;
    await client.query(`ALTER TABLE ${schema}.capsules ALTER COLUMN id RESTART WITH ${next}`);
    const actual={capsules:(await client.query(`SELECT * FROM ${schema}.capsules ORDER BY id`)).rows,budgets:(await client.query(`SELECT * FROM ${schema}.request_budgets ORDER BY key`)).rows};
    if(digest(actual)!==a.sha256)throw new Error('Restore verification failed');
  }
  return {accounts:snapshot.accounts.length,capsules:snapshot.accounts.reduce((n,a)=>n+a.capsules.length,0)};
}
