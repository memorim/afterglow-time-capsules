import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createPostgresFactory, poolOptions } from '../postgres.js';
process.env.NODE_ENV = 'test';
const { createApp, createDb } = await import('../server.js');
const url = process.env.POSTGRES_TEST_URL;

test('remote PostgreSQL always verifies TLS', () => {
  const config = poolOptions('postgresql://u:p@db.example.test/app?sslmode=disable');
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
});

test('PostgreSQL persists encrypted capsules, isolates accounts and shares budgets', { skip: !url }, async () => {
  const name = () => createHash('sha256').update(randomUUID()).digest('hex') + '.db';
  const account = name(), other = name();
  let factory = createPostgresFactory(url, { seedDb: createDb });
  try {
    const [db, same, isolated] = await Promise.all([factory.open(account), factory.open(account), factory.open(other)]);
    assert.equal((await db.prepare('SELECT * FROM capsules ORDER BY id').all()).length, 4);
    const start = Date.parse('2030-01-01T00:00:00Z');
    const app = createApp(db, { now: () => start, authenticatedOrigin: 'https://example.test' });
    const created = await request(app).post('/api/capsules').send({
      title: 'Persisted capsule', sender: 'Technical', recipient: 'Technical',
      unlockAt: '2030-01-01T00:01:00Z', message: 'Encrypted persistence verification', passphrase: 'technical-passphrase',
    }).expect(201);
    const row = await same.prepare('SELECT * FROM capsules WHERE id=?').get(created.body.id);
    assert.ok(row.ciphertext); assert.equal(JSON.stringify(row).includes('Encrypted persistence'), false);
    assert.equal(await isolated.prepare('SELECT * FROM capsules WHERE id=?').get(created.body.id), undefined);
    await request(app).post(`/api/capsules/${created.body.id}/open`).send({passphrase:'technical-passphrase'}).expect(423);
    const budgets = await Promise.all(Array.from({length: 20}, (_,i)=>(i%2 ? same : db).consumeBudget('parallel', 10, start)));
    assert.equal(budgets.filter(x=>x.allowed).length, 10);
    await factory.close();
    factory = createPostgresFactory(url, { seedDb: createDb });
    const reopened = await factory.open(account);
    assert.equal((await reopened.consumeBudget('parallel', 10, start)).allowed, false);
    const afterUnlock = createApp(reopened, {now:()=>start+61000,authenticatedOrigin:'https://example.test'});
    const opened = await request(afterUnlock).post(`/api/capsules/${created.body.id}/open`).send({passphrase:'technical-passphrase'}).expect(200);
    assert.equal(opened.body.message, 'Encrypted persistence verification');
    const listing = await request(afterUnlock).get('/api/capsules').expect(200);
    assert.equal(JSON.stringify(listing.body).includes('ciphertext'), false);
  } finally { await factory.close(); }
});
