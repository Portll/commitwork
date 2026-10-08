// node --test monitor/test/ — the Semgrep Pro licence cap.
//
// WHY THIS FILE EXISTS. Semgrep Pro is licensed for a bounded number of repositories and this fleet
// resolves to 119. Every other cap in this repo is a house rule we chose and could relax; this one
// is a promise made to somebody else, so the failure mode is not a worse report — it is a breach
// carried out automatically, once per sweep, by a machine that nobody is watching.
//
// WHAT IT ASSERTS, AND WHY THESE PARTICULAR THINGS. The cheap version of this file would check that
// SEMGREP_PRO_MAX is 10 and that a checkbox exists. Both would pass against a fleet running Pro on
// all 119 repos. Each test below instead names a way the cap could be TRUE IN THE DECLARATION AND
// ABSENT IN EFFECT — which is the only kind of failure that matters here, because the declaration
// is the part everyone reads and the effect is the part the licensor counts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(ROOT, 'manifests', 'security-baseline.json'), 'utf8'));
const SAST = MANIFEST.checks.find((c) => c.id === 'sast');
const SWEEP = readFileSync(join(ROOT, 'monitor', 'sweep.mjs'), 'utf8');

const fixture = (n) => ({
  reportsRoot: 'reports',
  areas: [{ slug: 'a', label: 'A' }],
  projects: Array.from({ length: n }, (_, i) => ({
    name: `r${String(i + 1).padStart(2, '0')}`, path: `/tmp/r${i + 1}`,
    manifest: 'manifests/security-baseline.json', area: 'a',
  })),
});
const names = (n) => Array.from({ length: n }, (_, i) => `r${String(i + 1).padStart(2, '0')}`);

describe('the cap is enforced where no consumer can disagree with it', () => {
  test('a registry naming more repositories than the licence permits does not validate', async () => {
    const { validateRegistry, SEMGREP_PRO_MAX } = await import('../registry.mjs');
    assert.equal(typeof SEMGREP_PRO_MAX, 'number', 'the bound is not exported, so nothing can state it');
    // THE NUMBER ITSELF IS ASSERTED, and deliberately so. Every other test in this file measures
    // the mechanism against SEMGREP_PRO_MAX, so all of them keep passing if someone raises it to
    // 119 — the cap would be perfectly enforced and completely wrong. This is the one line that
    // makes widening the allowance a decision somebody has to make on purpose. If the licence
    // really changed, change it here and say so in the commit; do not delete the assertion.
    assert.equal(SEMGREP_PRO_MAX, 10,
      'the Semgrep Pro allowance was changed. That is a licence term, not a tuning knob — confirm the entitlement actually changed before editing this line');

    const ok = validateRegistry({ ...fixture(20), semgrepPro: { repos: names(SEMGREP_PRO_MAX) } });
    assert.equal(ok.errors.length, 0, `exactly ${SEMGREP_PRO_MAX} must be allowed: ${ok.errors.join('; ')}`);

    const over = validateRegistry({ ...fixture(20), semgrepPro: { repos: names(SEMGREP_PRO_MAX + 1) } });
    assert.ok(over.errors.length, 'a registry over the licence bound validated — the cap is decorative');
    // A refusal that does not name the count leaves the operator guessing which box to untick. The
    // number is the actionable part, so its absence is a failure of the guard, not of its wording.
    assert.ok(over.errors.some((e) => e.includes(String(SEMGREP_PRO_MAX + 1)) && e.includes(String(SEMGREP_PRO_MAX))),
      `the refusal names neither the count nor the bound: ${over.errors.join('; ')}`);
  });

  test('it is an ERROR, not a warning — a warning is a breach that loads', async () => {
    const { validateRegistry } = await import('../registry.mjs');
    const v = validateRegistry({ ...fixture(20), semgrepPro: { repos: names(11) } });
    assert.equal(v.warnings.filter((w) => /semgrepPro/.test(w)).length, 0,
      'the over-cap state is reported as a warning; warnings do not stop a load, so the sweep would run it');
  });

  test('a duplicate cannot buy two seats with one repository', async () => {
    const { validateRegistry } = await import('../registry.mjs');
    const v = validateRegistry({ ...fixture(20), semgrepPro: { repos: ['r01', 'r01'] } });
    assert.ok(v.errors.some((e) => /more than once/.test(e)),
      'a duplicated name validated — 11 entries could then be spelled as 10 distinct seats plus a repeat');
  });
});

describe('a refused save changes nothing', () => {
  test('the registry is byte-identical after an over-cap write is refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-pro-'));
    const path = join(dir, 'projects.json');
    writeFileSync(path, JSON.stringify({ ...fixture(20), semgrepPro: { repos: names(3) } }, null, 2) + '\n');
    const prev = process.env.CW_REGISTRY;
    process.env.CW_REGISTRY = path;
    try {
      const { setSemgrepPro } = await import('../../admin/routes/projects-view.mjs');
      const before = readFileSync(path, 'utf8');
      const r = setSemgrepPro({ repos: names(11) });
      assert.equal(r.ok, false, 'an over-cap allocation was accepted by the write path');
      assert.equal(readFileSync(path, 'utf8'), before,
        'the registry changed despite the refusal — a rejected save must leave nothing behind');
    } finally { if (prev === undefined) delete process.env.CW_REGISTRY; else process.env.CW_REGISTRY = prev; }
  });
});

describe('the flag reaches the engine only where a seat was granted', () => {
  test('the sast command does not carry an unconditional --pro-intrafile', () => {
    const cmd = (SAST.local || []).join(' ');
    assert.ok(/--pro-intrafile/.test(cmd), 'the Pro flag is gone from sast entirely — no repo can get the engine');
    // THE REGRESSION THIS CATCHES is someone "simplifying" the conditional back to a bare flag.
    // That reads as a tidy-up and is a licence breach on every repo in the fleet, with no error,
    // no failed scan, and a better-looking report.
    assert.ok(/\$\{\w+:\+\s*--pro-intrafile\s*\}/.test(cmd),
      'the Pro flag is unconditional: every repository would run Pro regardless of the allocation');
  });

  test('an unallocated repo is given an EMPTY value, not left to inherit the environment', () => {
    // Source-level because sweep.mjs executes its whole run on import. The property under test is
    // an ordering one: the registry's decision must be spread AFTER ...process.env, and the
    // negative branch must WRITE '' rather than omit the key. Omitting it would let an exported
    // CW_SEMGREP_PRO=1 buy a seat the registry never granted — a cap any shell can step around.
    const env = /const env = \{[\s\S]{0,600}?\};/.exec(SWEEP);
    assert.ok(env, 'the per-repo child env literal in sweep.mjs could not be located');
    const src = env[0];
    assert.ok(/CW_SEMGREP_PRO:/.test(src), 'the sweep does not pass CW_SEMGREP_PRO — the allocation reaches nothing');
    assert.ok(src.indexOf('...process.env') < src.indexOf('CW_SEMGREP_PRO'),
      'CW_SEMGREP_PRO is set before ...process.env spreads over it: an ambient value would win over the registry');
    assert.ok(/CW_SEMGREP_PRO:[^,}]*:\s*''/.test(src),
      "the unallocated branch does not write '' — an inherited CW_SEMGREP_PRO would grant an ungranted seat");
  });

  test('the shell expansion actually produces the flag, and actually withholds it', () => {
    // The two witnesses for the line above. `${VAR:+x}` is easy to typo into `${VAR:-x}`, which
    // inverts it: every unallocated repo would get Pro and every allocated one would not.
    const one = execFileSync('sh', ['-c', 'echo "[${CW_SEMGREP_PRO:+--pro-intrafile}]"'],
      { env: { ...process.env, CW_SEMGREP_PRO: '1' }, encoding: 'utf8' }).trim();
    const none = execFileSync('sh', ['-c', 'echo "[${CW_SEMGREP_PRO:+--pro-intrafile}]"'],
      { env: { ...process.env, CW_SEMGREP_PRO: '' }, encoding: 'utf8' }).trim();
    assert.equal(one, '[--pro-intrafile]', 'an allocated repo does not get the flag');
    assert.equal(none, '[]', 'an unallocated repo still gets the flag — the expansion is inverted or wrong');
  });
});

describe('what the manifest claims about the engine stays true', () => {
  test('scan-scope reports the engine as per-repo, and does NOT claim Pro for everyone', async () => {
    // THE TRAP: `${CW_SEMGREP_PRO:+--pro-intrafile}` CONTAINS the literal `--pro-intrafile`, so the
    // pre-existing regex matches it and would publish 'runs the Pro engine' as a coverage bound on
    // every repo in the fleet — including the ones that ran OSS. A declaration derived from text
    // that merely looks like the flag is exactly what this module exists to refuse.
    const { scanScopes } = await import('../scan-scope.mjs');
    const s = scanScopes().sastSemgrep;
    assert.ok(s && s.known, `the sast scope could not be derived: ${s && (s.reason || '')} ${s && (s.detail || '')}`);
    const notes = (s.notes || []).join('\n');
    assert.ok(/allocated per repo/.test(notes),
      'the published bound does not say the engine is allocated per repository');
    // The fixed-engine note's own opening words. Its presence would tell every reader that Pro ran
    // on a repo that ran OSS — the narrower engine reported as the wider one.
    assert.equal(/runs the Pro engine, intra-file/.test(notes), false,
      'the fixed-engine bound is still published: every repo would be described as running Pro');
    // The reader is told where the ANSWER lives, not just that the question is open. A bound that
    // says "it varies" and stops is not checkable by anybody.
    assert.ok(/driver\.name/.test(notes),
      'the bound does not say where the engine that actually ran is recorded, so nobody can check it');
  });

  test('the derived bound and the manifest\'s declared scopeNotes agree', async () => {
    // THIS IS THE WITNESS FOR THE DERIVED KEY, which scanScopes() does not expose. commandScope
    // cross-checks derived keys against the manifest's declared scopeNotes in BOTH directions and
    // returns known:false with reason 'scope-drift' on any mismatch. So known:true, combined with
    // the manifest declaring engine-per-repo below, is proof that the key derived from the command
    // is engine-per-repo — established by the cross-check rather than asserted from outside it.
    const { scanScopes } = await import('../scan-scope.mjs');
    const s = scanScopes().sastSemgrep;
    assert.notEqual(s.reason, 'scope-drift',
      `declared scopeNotes no longer match the command: ${s.detail || ''}`);
    assert.equal(s.known, true, `the sast scope is not derivable (${s.reason || '?'}) — the cross-check cannot vouch for the key`);
    assert.ok((SAST.scopeNotes || []).includes('engine-per-repo'),
      'the manifest still declares a fixed engine in scopeNotes while the command allocates per repo');
    assert.equal((SAST.scopeNotes || []).includes('engine-pro-intrafile'), false,
      'the manifest declares the fixed-engine bound alongside the per-repo one');
  });
});
