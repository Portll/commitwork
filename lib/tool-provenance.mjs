// How each scanner on this box was installed, written by `commitwork setup` and read by `doctor`.
//
// A present binary says nothing about where its bytes came from. This record keys each tool to the
// channel setup used and the signature tier the release path reached, so doctor can print a tier
// instead of a tick. A tool present with no record is `unrecorded`: it was installed by something
// other than setup, and that is an undetermined state, never upgraded to a tier. Operational,
// per box, outside the tree. CW_TOOL_PROVENANCE overrides, read at call time.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

export const provenancePath = () => (process.env.CW_TOOL_PROVENANCE
  ? resolve(process.env.CW_TOOL_PROVENANCE)
  : join(homedir(), '.commitwork', 'tool-provenance.json'));

// Highest trust first. The three columns that decide it: whose identity is proven, how the version
// is pinned, and how many tools one compromise of the channel poisons.
export const CHANNEL_TIERS = {
  'release/cosign': { rank: 0, label: 'primary, publisher-signed, pinned' },
  'release/sha256': { rank: 1, label: 'primary, pinned, unsigned' },
  go: { rank: 2, label: 'registry, sumdb-checked' },
  cargo: { rank: 2, label: 'registry, lockfile-pinned' },
  npm: { rank: 2, label: 'registry, exact version' },
  brew: { rank: 3, label: 'secondary, curated rebuild, unpinned' },
  apt: { rank: 3, label: 'secondary, distro-signed, stale' },
  dnf: { rank: 3, label: 'secondary, distro-signed, stale' },
  winget: { rank: 4, label: 'secondary, hashed pointer, vendor-scanned' },
  pipx: { rank: 5, label: 'registry, unpinned, live transitive deps' },
  gem: { rank: 5, label: 'registry, unpinned' },
  composer: { rank: 5, label: 'registry, unpinned' },
  scoop: { rank: 6, label: 'secondary, bot-hashed manifest' },
};

export function channelKey(via, signatureTier) {
  return via === 'release' ? `release/${signatureTier === 'cosign' ? 'cosign' : 'sha256'}` : via;
}

export function tierFor(record) {
  if (!record) return { rank: null, label: 'unrecorded (not installed by setup)' };
  const t = CHANNEL_TIERS[record.channel];
  return t || { rank: null, label: `unranked channel ${record.channel}` };
}

/** Fail closed: ENOENT is the empty store; anything else is an error the caller sees. */
export function readProvenance(path = provenancePath()) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return { tools: {} }; throw e; }
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || !data.tools || typeof data.tools !== 'object') throw new Error(`${path}: not a provenance store`);
  return data;
}

export function recordProvenance(name, { via, signatureTier = null, detail = null, now = process.env.CW_NOW || new Date().toISOString() }, path = provenancePath()) {
  const data = readProvenance(path);
  data.tools[name] = { channel: channelKey(via, signatureTier), via, ...(signatureTier ? { signatureTier } : {}), ...(detail ? { detail } : {}), at: now };
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
  return data.tools[name];
}
