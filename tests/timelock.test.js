import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { defaultChainInfo } from 'tlock-js';
import { encryptCapsule, decryptCapsule, decryptLegacyCapsule } from '../capsule-crypto.js';

process.env.NODE_ENV = 'test';
const { createDb, createApp, seal } = await import('../server.js');
const password = 'E2E regression passphrase';
const message = 'This message stays inside the encrypted browser envelope.';

test('browser can decrypt a legacy capsule without posting a password', async () => {
  assert.equal(await decryptLegacyCapsule(seal(message, password), password), message);
});

test('encrypted capsules store an envelope bound to the future drand round', async () => {
  const db = createDb(':memory:');
  const app = createApp(db);
  const unlockAt = new Date(Date.now() + 60000).toISOString();
  const sealed = await encryptCapsule(message, password, unlockAt);
  const body = { title: 'Time-locked capsule', sender: 'Author', recipient: 'Reader', unlockAt, sealed };
  try {
    const invalid = await request(app).post('/api/capsules').send({
      ...body, unlockAt: new Date(Date.parse(unlockAt) + 60000).toISOString(),
    });
    assert.equal(invalid.status, 400);
    const response = await request(app).post('/api/capsules').send(body);
    assert.equal(response.status, 201, JSON.stringify(response.body));
    const path = '/api/capsules/' + response.body.id;
    const meta = (await request(app).get(path)).body;
    assert.equal(meta.encryption, 'drand-quicknet-v1');
    assert.equal(meta.locked, true);
    const envelope = (await request(app).get(path + '/envelope')).body;
    assert.deepEqual(envelope, sealed);
    const stored = JSON.stringify(db.prepare('SELECT * FROM capsules WHERE id=?').get(response.body.id));
    assert.ok(!stored.includes(message) && !stored.includes(password));
    await assert.rejects(decryptCapsule(envelope, password, {
      chain: () => ({ info: async () => defaultChainInfo }),
      get: async () => { throw new Error('No future beacon exists'); },
    }), /too early/);
  } finally { db.close(); }
});

test('the correct historical Quicknet beacon and password decrypt the browser message', async () => {
  const signed = {
    round: 24807412,
    randomness: '518b94dd56c804dd9087c39e20d1187d5846cdccb1ae2f9508600531b4a18c7b',
    signature: 'b9fa3349b38b18f4e988b3175693ee6d685836b6e8837737922b28eb44a247535544b28565a6557da9b9960da0452598',
  };
  const client = {
    options: { disableBeaconVerification: false },
    chain: () => ({ info: async () => defaultChainInfo }),
    get: async round => {
      assert.equal(round, signed.round);
      return signed;
    },
  };
  const sealed = await encryptCapsule(message, password, '2026-01-01T00:00:00.000Z');
  assert.equal(await decryptCapsule(sealed, password, client), message);
  await assert.rejects(decryptCapsule(sealed, 'incorrect password', client), { name: 'OperationError' });
});
