import { Buffer, defaultChainInfo, mainnetClient, timelockDecrypt, timelockEncrypt } from 'tlock-js';
import { releaseRound } from './public/capsule-time.js';

const toHex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
const fromHex = value => Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16));
const encoder = new TextEncoder();

// Encryption needs only the network's pinned public parameters. Fetch a
// signed drand beacon when opening a capsule.
const encryptionClient = { chain: () => ({ info: async () => defaultChainInfo }) };

async function passwordKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password),
    'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptCapsule(message, password, unlockAt) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(message));
  const ciphertext = await timelockEncrypt(releaseRound(unlockAt), Buffer.from(sealed), encryptionClient);
  return { ciphertext, salt: toHex(salt), iv: toHex(iv) };
}

export async function decryptCapsule(envelope, password, client = mainnetClient()) {
  const inner = await timelockDecrypt(envelope.ciphertext, client);
  const key = await passwordKey(password, fromHex(envelope.salt));
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromHex(envelope.iv) }, key, new Uint8Array(inner),
  );
  return new TextDecoder().decode(clear);
}
