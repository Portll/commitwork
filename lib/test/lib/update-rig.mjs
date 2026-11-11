// Shared rig for the lib/update tests: an ephemeral Ed25519 key (generated per run, never a release
// key), manifest signing, and a fake fetch that serves a URL table.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { signedBytes } from '../../update/contract.mjs';

export const VECTOR = JSON.parse(readFileSync(new URL('../fixtures/portll-update-vector.json', import.meta.url), 'utf8'));

export function makeKey(keyId = 'rig-key') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64');
  return { keyId, privateKey, keys: { [keyId]: raw } };
}

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** A signed commitwork manifest for `bytes`. */
export function manifestFor({ key, version = '9.9.9', channel = 'stable', bytes = Buffer.from('tarball bytes'), product = 'commitwork', name } = {}) {
  const file = name || `commitwork-${version}.tgz`;
  const m = {
    schema: 'portll-update@1', product, channel, version, published: '2026-11-11T13:00:00Z', notes: 'rig',
    artifacts: [{
      name: file, platform: 'any', size: bytes.length, sha256: sha256(bytes),
      url: `https://updates.portll.net/v1/${product}/${version}/${file}`,
      github: { repo: 'Portll/commitwork', tag: `v${version}`, asset: file },
    }],
  };
  return resign(m, key);
}

export function resign(m, key) {
  const out = { ...m };
  delete out.signature;
  out.signature = { alg: 'ed25519', keyId: key.keyId, sig: sign(null, signedBytes(out), key.privateKey).toString('base64') };
  return out;
}

/**
 * fetch over a table: url -> { status, body, headers } | (init) => that | Error to throw.
 * Records every call as { url, init }.
 */
export function fakeFetch(table) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    let entry = table[url];
    if (typeof entry === 'function') entry = entry(init);
    if (entry instanceof Error) throw entry;
    if (!entry) return new Response('not found', { status: 404 });
    const body = entry.body === undefined ? null : (Buffer.isBuffer(entry.body) || typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body));
    return new Response(body, { status: entry.status ?? 200, headers: entry.headers || {} });
  };
  fn.calls = calls;
  return fn;
}
