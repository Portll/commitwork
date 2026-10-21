#!/usr/bin/env node
// cra/attest.mjs — signed attestations over evidence artifacts (Phase 2 integrity primitive).
//
// The roadmap's #1 remaining gap: append-only JSON on a workstation is honest but not
// tamper-evident — an auditor treats it as vendor claims. This adds cryptographic integrity
// with zero dependencies (Node's built-in `crypto`, ed25519):
//
//   keygen   → an ed25519 keypair (private key gitignored; public key committable)
//   sign     → for each evidence artifact (rollup, ledger, cases, sbom/vex/poam/soc2 outputs
//              present): a canonical SHA-256 digest, a detached ed25519 signature, and an
//              entry in a HASH-CHAINED attestation log (attestations.jsonl) — so the SET of
//              evidence at a point in time is itself signed and ordered, not just each file.
//   verify   → recompute every digest, check every signature against the public key, and
//              re-check the chain. Exit 1 on any mismatch; exit 3 when the only fault is a
//              torn final record (an append that did not complete), which is not a tamper.
//
// This is the on-prem/local-first integrity story (keys stay with the customer); the hosted
// plane later swaps the local key for a KMS/Fulcio identity. The `at` here is this machine's clock;
// cra/timestamp.mjs adds an RFC 3161 TSA token per signature record. Not yet: per-human identity
// (Phase 2 SSO).
//
//   node cra/attest.mjs keygen [--force]
//   node cra/attest.mjs sign [--key <path>]
//   node cra/attest.mjs verify [--pub <path>]
//
// Zero deps.

import { generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey, createPrivateKey } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { resolvePaths, sha256, stableStringify, nowISO, chainHash, resolveKeyDir, withCraStoreLock, ATTEST_KEY, ATTEST_PUB } from './lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const tty = process.stdout.isTTY;
const c = (n, s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : s);
const bold = (s) => c('1', s), dim = (s) => c('2', s), red = (s) => c('31', s), grn = (s) => c('32', s), yel = (s) => c('33', s);

function paths2() {
  const p = resolvePaths();
  return {
    ...p,
    keyDir: resolveKeyDir(p),
    attestLog: process.env.CW_ATTEST_LOG ? process.env.CW_ATTEST_LOG : join(p.out, 'attestations.jsonl'),
    sigDir: join(p.out, 'signatures'),
  };
}

// Artifacts to attest: the durable evidence, plus whatever derived outputs exist.
function evidenceArtifacts(p) {
  const list = [
    { role: 'rollup', path: p.rollup },
    { role: 'ledger', path: p.ledger },
    { role: 'cases', path: p.cases },
    { role: 'annotations', path: p.annotations },
    { role: 'products', path: p.products },
  ];
  return list.filter((a) => existsSync(a.path));
}

// sign appends JSON + '\n' in one call, so a final record without its newline is an append that did
// not complete — whether or not the bytes that landed happen to parse. It is reported as torn,
// never dropped and never read as a forged record (monitor/history-chain.mjs, same posture).
export function splitAttestLog(raw) {
  const parts = String(raw).split('\n');
  const tail = parts.pop();
  return { lines: parts.filter((l) => l.trim()), torn: tail.trim() ? { bytes: Buffer.byteLength(tail) } : null };
}

function canonicalDigest(path) {
  const raw = readFileSync(path, 'utf8');
  // Canonicalize JSON (stable key order) so formatting churn doesn't change the digest;
  // fall back to raw bytes for non-JSON.
  try { return sha256(stableStringify(JSON.parse(raw))); }
  catch { return sha256(raw); }
}

// Throws rather than exits, so the refusals are testable in-process. `io` is injectable because a
// filesystem that rejects chmod cannot be conjured in a test without root.
export function keygen(P, { force = false, io = { chmodSync } } = {}) {
  mkdirSync(P.keyDir, { recursive: true });
  const priv = join(P.keyDir, ATTEST_KEY), pub = join(P.keyDir, ATTEST_PUB);
  if (existsSync(priv) && !force) throw new Error(`key exists: ${priv} (use --force to overwrite — this INVALIDATES prior signatures)`);
  // .gitignore FIRST: CW_ATTEST_KEYDIR can point anywhere, including inside the repo, and the root
  // .gitignore's rule is path-pinned to cra/.keys/. Written after the key, a keydir elsewhere in
  // the tree is briefly a trackable private key.
  writeFileSync(join(P.keyDir, '.gitignore'), '*.key\n');
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  // `mode` only applies to a file this call creates; an overwritten key keeps its old mode until the chmod.
  writeFileSync(priv, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  try { io.chmodSync(priv, 0o600); }
  catch (e) {
    const why = e.code || e.message;
    try { rmSync(priv, { force: true }); }
    catch (rmErr) { throw new Error(`could not restrict ${priv} to 0600 (${why}) and could not remove it (${rmErr.code || rmErr.message}) — a signing key with its old permissions is on disk; delete it by hand`); }
    throw new Error(`could not restrict ${priv} to 0600 (${why}) — removed it rather than leave a signing key readable; fix the keydir's permissions and re-run keygen`);
  }
  writeFileSync(pub, publicKey.export({ type: 'spki', format: 'pem' }));
  return { priv, pub };
}

function cmdKeygen(P, force) {
  let priv, pub;
  try { ({ priv, pub } = keygen(P, { force })); }
  catch (e) { console.error(red(e.message)); process.exit(2); }
  console.log(grn(`  ✓ keypair written`));
  console.log(dim(`    private: ${priv}  (gitignored — keep secret)`));
  console.log(dim(`    public:  ${pub}   (commit this so anyone can verify)`));
  console.log(yel(`  ! ensure ${P.keyDir} is gitignored (this tool wrote a .gitignore there)`));
}

function cmdSign(P, keyPath) {
  const priv = keyPath || join(P.keyDir, ATTEST_KEY);
  if (!existsSync(priv)) { console.error(red(`no private key at ${priv} — run: node cra/attest.mjs keygen`)); process.exit(2); }
  const key = createPrivateKey(readFileSync(priv));
  const arts = evidenceArtifacts(P);
  if (!arts.length) { console.error(red('no evidence artifacts found to sign')); process.exit(2); }
  mkdirSync(P.sigDir, { recursive: true });
  const at = nowISO();
  const items = arts.map((a) => {
    const digest = canonicalDigest(a.path);
    const sig = edSign(null, Buffer.from(digest, 'hex'), key).toString('base64');
    const sigFile = join(P.sigDir, `${a.role}.sig`);
    writeFileSync(sigFile, JSON.stringify({ role: a.role, path: a.path, algo: 'ed25519', digest, signature: sig, at }, null, 2));
    return { role: a.role, path: a.path, digest, signature: sig };
  });
  // Hash-chained attestation over the whole evidence SET at this instant.
  // Read-tail and append are ONE critical section: two appenders that both read the same tail both
  // claim the same predecessor, and verify then reports a chain break on a ledger nobody edited.
  const wrote = withCraStoreLock(P.attestLog, () => {
    let prevHash = null;
    if (existsSync(P.attestLog)) {
      const { lines, torn } = splitAttestLog(readFileSync(P.attestLog, 'utf8'));
      // Appending here would glue the new record onto the torn one and turn a visible tear into a corrupt middle line.
      if (torn) throw new Error(`attestation log ends in an unterminated record (${torn.bytes} bytes) — refusing to append onto a torn tail; \`verify\` reports it, and truncating that record is the repair`);
      if (lines.length) {
        // An UNREADABLE predecessor is not "no predecessor". Swallowing this chained the next
        // attestation to null and manufactured a tamper alarm against a signed record.
        let tail;
        try { tail = JSON.parse(lines[lines.length - 1]); }
        catch (e) { throw new Error(`attestation log tail is unparseable (${e.message.slice(0, 80)}) — refusing to append, because chaining to null would forge a chain break on a signed record`); }
        if (typeof tail.hash !== 'string' || !tail.hash) throw new Error('attestation log tail carries no hash — refusing to append onto an unchainable predecessor');
        prevHash = tail.hash;
      }
    }
    const body = { at, artifacts: items.map(({ role, path, digest }) => ({ role, path, digest })), signatureCount: items.length };
    const ev = { ...body, prevHash };
    ev.hash = chainHash(prevHash, ev);
    ev.setSignature = edSign(null, Buffer.from(ev.hash, 'hex'), key).toString('base64');
    mkdirSync(dirname(P.attestLog), { recursive: true });
    appendFileSync(P.attestLog, JSON.stringify(ev) + '\n');
    return ev;
  }, { label: 'cra-attest' });
  if (!wrote.ok) {
    console.error(red(`  ✗ attestation log is locked by another process (${wrote.target}.lock) — nothing was signed into the chain; retry`));
    process.exitCode = 6;
    return;
  }
  const ev = wrote.value;
  console.log(grn(`  ✓ signed ${items.length} artifact(s)`) + dim(` → ${P.sigDir}/*.sig`));
  for (const it of items) console.log(dim(`    ${it.role.padEnd(12)} ${it.digest.slice(0, 16)}…`));
  console.log(dim(`    attestation ${ev.hash.slice(0, 16)}… appended to ${basename(P.attestLog)}`));
}

function cmdVerify(P, pubPath) {
  const pub = pubPath || join(P.keyDir, ATTEST_PUB);
  if (!existsSync(pub)) { console.error(red(`no public key at ${pub}`)); process.exit(2); }
  const key = createPublicKey(readFileSync(pub));
  let bad = 0, checked = 0;

  // 1) every detached signature: digest recomputes AND signature verifies against current file
  const arts = evidenceArtifacts(P);
  for (const a of arts) {
    const sigFile = join(P.sigDir, `${a.role}.sig`);
    if (!existsSync(sigFile)) { console.log(yel(`  ⊘ ${a.role}: no signature (unsigned)`)); continue; }
    const rec = JSON.parse(readFileSync(sigFile, 'utf8'));
    const now = canonicalDigest(a.path);
    checked++;
    if (now !== rec.digest) { console.log(red(`  ✗ ${a.role}: digest MISMATCH — artifact changed since signing`)); bad++; continue; }
    const ok = edVerify(null, Buffer.from(rec.digest, 'hex'), key, Buffer.from(rec.signature, 'base64'));
    if (!ok) { console.log(red(`  ✗ ${a.role}: signature invalid`)); bad++; continue; }
    console.log(grn(`  ✓ ${a.role}: digest matches + signature valid`));
  }

  // 2) the attestation chain: link order + each set-signature
  let torn = null;
  if (existsSync(P.attestLog)) {
    const log = splitAttestLog(readFileSync(P.attestLog, 'utf8'));
    const { lines } = log;
    torn = log.torn;
    let prev = null;
    for (const [i, line] of lines.entries()) {
      let ev;
      // A complete line that does not parse is corruption, not a torn append; later lines cannot be trusted in order.
      try { ev = JSON.parse(line); }
      catch (e) { console.log(red(`  ✗ attestation ${i}: not JSON (${e.message.slice(0, 60)}) — the log is corrupt from here`)); bad++; break; }
      const { hash, setSignature, ...rest } = ev;
      if (rest.prevHash !== prev) { console.log(red(`  ✗ attestation ${i}: chain break (prevHash)`)); bad++; }
      if (chainHash(rest.prevHash, rest) !== hash) { console.log(red(`  ✗ attestation ${i}: hash mismatch`)); bad++; }
      else if (!edVerify(null, Buffer.from(hash, 'hex'), key, Buffer.from(setSignature, 'base64'))) { console.log(red(`  ✗ attestation ${i}: set-signature invalid`)); bad++; }
      prev = hash;
    }
    console.log(dim(`  attestation chain: ${lines.length} entry(ies)`));
    if (torn) console.log(yel(`  ⚠ attestation log tail is TORN: the final record (${torn.bytes} bytes) has no terminating newline — an append that did not complete. The ${lines.length} complete entr(ies) before it are checked above; sign refuses to append until the torn record is truncated.`));
  }

  if (bad) { console.error(red(`  ${bad} verification failure(s)`)); process.exit(1); }
  if (torn) { console.error(yel('  torn tail: the complete entries verify, the last attestation did not finish writing (exit 3 — not a tamper)')); process.exit(3); }
  console.log(grn(`  ✓ all evidence signatures + chain verified (${checked} artifact(s))`));
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const P = paths2();
  if (cmd === 'keygen') cmdKeygen(P, argv.includes('--force'));
  else if (cmd === 'sign') cmdSign(P, flag('--key'));
  else if (cmd === 'verify') cmdVerify(P, flag('--pub'));
  else {
    console.log(`usage: node cra/attest.mjs <keygen|sign|verify> …
  keygen [--force]     generate an ed25519 keypair (private gitignored, public committable)
  sign   [--key p]     digest + sign each evidence artifact; append a hash-chained set attestation
  verify [--pub p]     recompute digests, verify signatures + the attestation chain
                       (exit 1 on any failure, 3 when the only fault is a torn final record)
env: CW_ATTEST_KEYDIR, CW_ATTEST_LOG override paths; standard CW_* artifact overrides apply`);
    if (cmd) process.exit(2);
  }
}

export { evidenceArtifacts, canonicalDigest };
