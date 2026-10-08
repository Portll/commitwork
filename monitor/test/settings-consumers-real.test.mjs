// A DECLARED CONSUMER MUST ACTUALLY CONSUME. Every entry in SETTING_KEYS carries
// `consumers: ['monitor/sweep.mjs', ...]` — a claim about which files read that setting. Nothing
// checked the claim, and it was false.
//
// Measured 2026-08-26: scanDepth and scanIntensity both named monitor/sweep.mjs as a consumer, and
// sweep.mjs imported settings.mjs nowhere and mentioned neither key nor either env var. The panel
// resolved a hardware profile into a recommended slot count, wrote it to the store, and the sweep
// used a constant. The knob was connected to nothing and the registry said it was connected.
//
// ── WHY THIS GATE IS NARROWER THAN IT FIRST LOOKED ────────────────────────────────────────────
// The obvious predicate — "the consumer file mentions the key or its env var" — failed 8 of 17
// declarations on its first run. At 47% that is a defect signature in the PREDICATE, not a fleet in
// crisis, and publishing eight unverified rows as failures would be the over-reporting half of the
// house rule (unsupported findings). The cause is that `consumers` conflates relations:
//
//   reads-from-store      the file calls getSetting/getAllSettings — textually visible
//   receives-as-argument  the file is handed the VALUE by a caller and never names the key.
//                         monitor/perf-tuning.mjs is the clean example: resolveTuning({depth,
//                         intensity, overrides}) consumes all three and can never mention them.
//   reads-via-resolver    the file calls a resolver that reads the key (repoLevels → repoTuning).
//   receives-over-HTTP    a page script is sent a route's projection of the value, renamed.
//
// Separating those in the registry is the real fix and belongs to that file's owner. Until then
// this gate proves the half it can and DECLARES the half it cannot, each with a reason, so a NEW
// false declaration still fails while a real indirect relation is not restated as a finding.
//
// ── ADOPTED 2026-09-27 ─────────────────────────────────────────────────────────────────────────
// This file sat untracked in one checkout from 2026-09-06, guarding nothing a clone could run. On
// adoption it failed on repoTuning → admin/routes/perf.mjs, a route that never reads that key, and
// its five UNVERIFIED exemptions were checked against the code rather than carried: three were FALSE
// declarations (sweepKillMs → monitor/sweep.mjs; sweepCadenceMs → liveness.mjs and freshness.mjs)
// and two named the page that loads the consumer rather than the consumer. All were corrected in
// monitor/settings.mjs. An exemption is a claim that the relation is REAL; a relation that is not
// real is fixed at the declaration, never listed here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTING_KEYS } from '../settings.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Declarations that are NOT textually verifiable, each with the reason it is exempt — every reason
// verified against the code on 2026-09-27. A new unverifiable declaration is NOT covered by this
// list and fails; an entry that stops being needed fails too (the last test below).
const INDIRECT = new Map([
  ['scanDepth::monitor/perf-tuning.mjs', 'receives-as-argument: resolveTuning({depth}) and lanePlan(id, {depth}) consume the value; the key name never appears'],
  ['scanIntensity::monitor/perf-tuning.mjs', 'receives-as-argument: resolveTuning({intensity}) and lanePlan(id, {intensity})'],
  ['scannerOverrides::monitor/perf-tuning.mjs', 'receives-as-argument: resolveTuning({overrides}) → normalizeOverrides'],
  ['repoTuning::bin/commitwork.mjs', 'reads-via-resolver: depthGate() calls repoLevels(repo) from monitor/repo-tuning.mjs, which reads the key, and runs each lane at the depth and intensity it returns'],
  ['sweepKillMs::monitor/sweep-health.mjs', 'receives-as-argument: admin/routes/settings.mjs reads the key and calls sweepHealth({killMs}) → classify(marker, {killMs}), which marks a sweep kill-eligible'],
  ['learningMode::admin/static/learning.js', 'receives-over-HTTP: GET /api/learning (admin/routes/learning.mjs state()) sends the key as `on`; the page script renders that field'],
  ['learningDismissed::admin/static/learning.js', 'receives-over-HTTP: state() sends the key as `dismissed` and filters `visible` by it; the page script posts dismissals back as {dismiss: id}'],
]);

const pairs = [];
for (const [key, spec] of Object.entries(SETTING_KEYS)) {
  for (const rel of (spec.consumers || [])) pairs.push({ key, spec, rel, id: `${key}::${rel}` });
}

describe('settings — every declared consumer references the setting', () => {
  test('each consumers entry names a file that exists', () => {
    assert.ok(pairs.length, 'no setting declared any consumer — the assertion never ran');
    for (const { key, rel } of pairs) {
      assert.ok(fs.existsSync(path.join(ROOT, rel)),
        `${key} declares consumer ${rel}, which is not on disk — the claim cannot be true`);
    }
  });

  test('every consumer either names the setting, or is a declared indirect one', () => {
    const undeclared = [];
    for (const { key, spec, rel, id } of pairs) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (src.includes(key) || (spec.envVar && src.includes(spec.envVar))) continue;
      if (INDIRECT.has(id)) continue;
      undeclared.push(`${key} declares ${rel} as a consumer; that file names neither "${key}" nor `
        + `${spec.envVar}, and there is no INDIRECT entry saying why. Wire it, drop the claim, or `
        + 'add an entry with a real reason.');
    }
    assert.deepEqual(undeclared, [], undeclared.join('\n'));
  });

  test('the setting wired on 2026-08-26 is named by its consumer — the regression pin', () => {
    // The specific break this file exists for. Textual, direct, and not exemptible.
    const sweep = fs.readFileSync(path.join(ROOT, 'monitor', 'sweep.mjs'), 'utf8');
    for (const key of ['scanDepth', 'scanIntensity', 'perfProfile']) {
      assert.ok(sweep.includes(key),
        `monitor/sweep.mjs no longer reads ${key} — the tuning panel is disconnected from the sweep again`);
    }
    assert.ok(/resolveTuning\(/.test(sweep),
      'monitor/sweep.mjs no longer calls resolveTuning — the recommendation is computed and unused again');
  });

  test('every INDIRECT entry is still needed — a stale exemption is itself a failure', () => {
    // Mirrors the repo's tmp-exception rule: an exemption that no longer fires is a lie about the
    // state of the code and must die when the thing it excused is fixed.
    const stale = [];
    for (const [id, reason] of INDIRECT) {
      const [key, rel] = id.split('::');
      const spec = SETTING_KEYS[key];
      if (!spec || !(spec.consumers || []).includes(rel)) { stale.push(`${id} — no such declaration any more`); continue; }
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      if (src.includes(key) || (spec.envVar && src.includes(spec.envVar))) {
        stale.push(`${id} — now names the setting directly, so the exemption ("${reason}") is spent`);
      }
    }
    assert.deepEqual(stale, [], stale.join('\n'));
  });

  test('no exemption is a placeholder — each states the relation it rests on', () => {
    // Five entries this file carried before adoption said UNVERIFIED; three of them covered
    // declarations that were simply false. A reason that does not name its relation cannot be checked.
    for (const [id, reason] of INDIRECT) {
      assert.match(reason, /^(receives-as-argument|reads-via-resolver|receives-over-HTTP): /,
        `${id}: "${reason}" names no relation`);
    }
  });
});
