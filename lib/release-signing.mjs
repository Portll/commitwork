// Publisher-signature verification for a pinned release asset (bin/setup.mjs's `release` channel).
//
// A sha256 pin proves the bytes are the ones catalogued; it does not prove who published them, and
// the pin itself was taken on trust the day it was written. goreleaser-built tools sign their
// checksums file with cosign keyless (Fulcio certificate bound to the GitHub Actions workflow that
// cut the release), so the asset's hash in that signed file is a second witness with a different
// failure mode from our pin. A release that declares `signing.kind: "cosign-checksums"` installs only
// when both witnesses agree; declaring `none` records a measured absence (gitleaks v8.30.1 ships
// checksums.txt with no .sig/.pem and no GitHub attestation), which is reported, never upgraded to a
// pass. An undeclared block is undetermined and is reported as such — the catalogue gate, not the
// installer, is what refuses to ship one.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';
export const SIGNING_KINDS = ['cosign-checksums', 'none'];

export const cosignBin = () => process.env.CW_COSIGN_BIN || 'cosign';

export function signingKind(spec) {
  const k = spec?.signing?.kind;
  return SIGNING_KINDS.includes(k) ? k : 'undeclared';
}

/** The three sibling assets a cosign-checksums block needs, by their names on the release. */
export function signingAssets(signing) {
  const c = signing.checksums;
  return { checksums: c, signature: `${c}.sig`, certificate: `${c}.pem` };
}

export function cosignArgv(signing, dir) {
  const a = signingAssets(signing);
  return [cosignBin(), 'verify-blob',
    '--certificate', join(dir, a.certificate),
    '--signature', join(dir, a.signature),
    '--certificate-identity-regexp', signing.identity,
    '--certificate-oidc-issuer', signing.issuer,
    join(dir, a.checksums)];
}

/** The hex digest a goreleaser checksums file states for `asset`, or null when it has no line for it. */
export function checksumFor(text, asset) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)\s*$/.exec(line.trim());
    if (m && m[2] === asset) return m[1];
  }
  return null;
}

const refused = (reason) => ({ ok: false, reason });

/**
 * -> { ok: true, tier: 'cosign' | 'sha256', detail } | { ok: false, reason }
 * `fetchAsset(name)` resolves to the bytes of a sibling release asset. `sha256` is the pinned digest
 * the caller has already matched against the downloaded bytes.
 */
export async function verifyReleaseSignature({ spec, asset, sha256, fetchAsset, spawn = spawnSync }) {
  const kind = signingKind(spec);
  if (kind === 'undeclared') return { ok: true, tier: 'sha256', detail: 'publisher signature: undeclared in the catalogue (undetermined)' };
  const signing = spec.signing;
  if (kind === 'none') return { ok: true, tier: 'sha256', detail: `publisher signature: none published (checked ${signing.checkedAt || 'undated'})` };
  if (!signing.checksums || !signing.identity || !signing.issuer) return refused('signing block is missing checksums, identity or issuer');
  const probe = spawn(cosignBin(), ['version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) return refused(`release is cosign-signed and ${cosignBin()} is not installed (brew install cosign; winget install Sigstore.Cosign; scoop install cosign)`);
  const names = signingAssets(signing);
  const dir = mkdtempSync(join(tmpdir(), 'cw-release-signing-'));
  try {
    for (const name of Object.values(names)) {
      let buf;
      try { buf = await fetchAsset(name); } catch (e) { return refused(`could not fetch ${name} — ${e.message}`); }
      writeFileSync(join(dir, name), buf);
    }
    const argv = cosignArgv(signing, dir);
    const r = spawn(argv[0], argv.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) return refused(`cosign could not run — ${r.error.message}`);
    if (r.status !== 0) return refused(`cosign verify-blob exit ${r.status} — ${String(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ')}`);
    const signed = checksumFor(readFileSync(join(dir, names.checksums), 'utf8'), asset);
    if (!signed) return refused(`signed ${names.checksums} has no line for ${asset}`);
    if (signed !== sha256) return refused(`signed checksum ${signed} disagrees with the pinned ${sha256}`);
    return { ok: true, tier: 'cosign', detail: `publisher signature verified: cosign keyless, identity ${signing.identity}` };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
