import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
process.env.NODE_ENV='test';
const { createApp, createDb } = await import('../server.js');
const db=createDb(':memory:');
const futureDate = new Date(Date.now() + 7 * 86400000).toISOString();
db.prepare('UPDATE capsules SET unlock_at=? WHERE id=4').run(futureDate);
const app=createApp(db);
describe('Afterglow API',()=>{
  it('never exposes encrypted payloads in the public list',async()=>{const r=await request(app).get('/api/capsules');assert.equal(r.status,200);assert.equal(r.body.length,4);assert.equal('ciphertext' in r.body[0],false)});
  it('opens an unlocked capsule with the correct passphrase',async()=>{const r=await request(app).post('/api/capsules/1/open').send({passphrase:'light'});assert.equal(r.status,200);assert.match(r.body.message,/тёплый воздух/)});
  it('rejects a wrong passphrase',async()=>{const r=await request(app).post('/api/capsules/1/open').send({passphrase:'wrong'});assert.equal(r.status,401)});
  it('keeps future capsules locked',async()=>{const r=await request(app).post('/api/capsules/4/open').send({passphrase:'city'});assert.equal(r.status,423)});
  it('creates an encrypted future capsule',async()=>{const r=await request(app).post('/api/capsules').send({title:'После следующего лета',sender:'Роман',recipient:'Будущему себе',unlockAt:futureDate,message:'Это достаточно длинное секретное сообщение.',passphrase:'secret-key',hint:'Личный пароль',theme:'orbit'});assert.equal(r.status,201)});
});

describe('Input validation and missing records', () => {
  it('rejects invalid input', async () => { assert.equal((await request(app).post('/api/capsules').send({})).status, 400); });
  it('returns 404 for a missing record', async () => { assert.equal((await request(app).post('/api/capsules/999/open').send({passphrase:'test'})).status, 404); });
});
