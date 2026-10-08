// Every bundled check declares what it reaches. A missing `egress` is a failure here, never a
// default in the runner: the runner leaves an undeclared lane unconfined and writes that on its
// row, and this test is what stops a bundled lane from ever shipping that way.
//
// The docker-lane declaration is held against the command text in both directions, because the
// runner skips the host wrapper for a declared container lane, and a lane declared container that
// runs on the host would run unconfined under a label that says otherwise.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EGRESS_CLASSES } from '../lib/sandbox.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'manifest.schema.json'), 'utf8'));
const profiles = JSON.parse(readFileSync(join(ROOT, 'monitor', 'perf-profiles.json'), 'utf8'));

const manifests = readdirSync(join(ROOT, 'manifests'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ f, doc: JSON.parse(readFileSync(join(ROOT, 'manifests', f), 'utf8')) }))
  .filter(({ doc }) => Array.isArray(doc.checks) && typeof doc.repo === 'string');

// The scripts a command reaches, read so a `docker run` inside bin/depscan-scan.sh counts for the
// lane that calls it.
const reachedText = (check) => {
  const cmd = (check.local || []).join('\n');
  const refs = [...cmd.matchAll(/\$CW_ROOT\/(bin\/[\w.-]+\.(?:sh|mjs))/g)].map((m) => m[1]);
  const bodies = refs.map((p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : ''));
  return [cmd, ...bodies].join('\n');
};
const declaresDocker = (c) => c.requires?.docker === true || (c.requires?.tools || []).includes('docker');

describe('egress is declared on every bundled check', () => {
  test('the schema enum is the code\'s vocabulary, neither ahead nor behind', () => {
    assert.deepEqual(schema.properties.checks.items.properties.egress.enum, [...EGRESS_CLASSES]);
  });

  test('at least the four bundled manifests are in scope', () => {
    assert.ok(manifests.length >= 4, `found ${manifests.length}`);
  });

  for (const { f, doc } of manifests) {
    test(`${f}: every check declares egress from the closed set`, () => {
      const missing = doc.checks.filter((c) => c.egress === undefined).map((c) => c.id);
      const bad = doc.checks.filter((c) => c.egress !== undefined && !EGRESS_CLASSES.includes(c.egress)).map((c) => `${c.id}=${c.egress}`);
      assert.deepEqual(missing, [], `checks without egress (the runner leaves these unconfined): ${missing.join(', ')}`);
      assert.deepEqual(bad, [], `checks outside ${EGRESS_CLASSES.join('|')}: ${bad.join(', ')}`);
    });
  }
});

describe('security-baseline: the declarations agree with the commands', () => {
  const sb = manifests.find((m) => m.f === 'security-baseline.json').doc;

  test('the six lanes the plan names carry the class it names', () => {
    const want = { secrets: 'verifiers', 'secrets-gitleaks': 'verifiers', 'deps-jvm': 'registry', 'posture-scorecard': 'github', 'deps-osv': 'registry', 'cspm-github': 'github' };
    for (const [id, cls] of Object.entries(want)) {
      const c = sb.checks.find((x) => x.id === id);
      assert.ok(c, id);
      assert.equal(c.egress, cls, id);
      assert.match(c.formatNotes || '', new RegExp(`EGRESS: ${cls}\\b`), `${id} formatNotes names what it reaches`);
    }
  });

  test('a lane that names network in its own command or script is not declared none', () => {
    const offenders = [];
    for (const c of sb.checks) {
      if (c.egress !== 'none') continue;
      const text = reachedText(c);
      if (/\bfetch\(|https?:\/\/(api|registry|proxy|ghcr|deps\.dev)/.test(text) && !/--offline|--private|--no-update/.test(text)) offenders.push(c.id);
    }
    assert.deepEqual(offenders, [], `declared none but reach the network: ${offenders.join(', ')}`);
  });

  test('a docker lane is declared in requires AND perf-profiles AND runs docker, or none of the three', () => {
    const rows = [];
    for (const c of sb.checks) {
      const declared = declaresDocker(c);
      const profiled = profiles.scanners?.[c.id]?.container === true;
      const runs = /\bdocker run\b/.test(reachedText(c));
      if (declared !== profiled || declared !== runs) rows.push(`${c.id}: requires=${declared} perf-profiles=${profiled} command=${runs}`);
    }
    assert.deepEqual(rows, [], `docker declarations disagree:\n  ${rows.join('\n  ')}`);
  });

  test('a lane whose command builds or runs the tree declares executesRepoCode', () => {
    const builds = /--build-mode=autobuild|--command=|\bcargo (?:clippy|check|build|test)\b|security\/authz-isolation-test\.sh|vendor\/autoload\.php|bin\/depscan-scan\.sh/;
    const missing = sb.checks.filter((c) => builds.test(reachedText(c)) && c.executesRepoCode !== true).map((c) => c.id);
    assert.deepEqual(missing, [], `build the tree without declaring it: ${missing.join(', ')}`);
    assert.ok(sb.checks.filter((c) => c.executesRepoCode === true).length >= 4, 'the declaration is in use');
  });

  test('sandbox extras use the declared prefixes only', () => {
    const bad = [];
    for (const c of sb.checks) {
      for (const p of [...(c.sandboxExtraReads || []), ...(c.sandboxExtraWrites || [])]) if (!/^(\/|~\/|\.\/|@usercache\/)/.test(p)) bad.push(`${c.id}: ${p}`);
    }
    assert.deepEqual(bad, []);
  });

  // The runner hands the gh session only to a lane that declares ~/.config/gh. A lane that calls gh
  // without the declaration runs anonymously under the sandbox: actions-health did, voiding on every
  // private repo, until 2026-10-04.
  test('every lane that calls gh declares its store and runs no repository code', () => {
    const callsGh = (c) => (c.requires?.tools || []).includes('gh')
      || /\b(?:spawnSync|execFileSync|spawn|execFile)\(\s*['"]gh['"]|\bgh (?:auth|api)\b/.test(reachedText(c));
    const users = sb.checks.filter(callsGh);
    const undeclared = users.filter((c) => !(c.sandboxExtraReads || []).includes('~/.config/gh')).map((c) => c.id);
    const unsafe = users.filter((c) => c.executesRepoCode === true).map((c) => c.id);
    assert.deepEqual(undeclared, [], `call gh without declaring ~/.config/gh: ${undeclared.join(', ')}`);
    assert.deepEqual(unsafe, [], `would hand the gh session to repository code: ${unsafe.join(', ')}`);
    assert.ok(users.length >= 3, `the detector still finds the gh lanes (found ${users.map((c) => c.id).join(', ')})`);
  });
});

describe('the other manifests', () => {
  for (const { f, doc } of manifests.filter((m) => m.f !== 'security-baseline.json')) {
    test(`${f}: a lane that requires docker reaches a script that uses it`, () => {
      const bad = doc.checks.filter((c) => declaresDocker(c) && !/\bdocker\b/.test(reachedText(c))).map((c) => c.id);
      assert.deepEqual(bad, []);
    });
  }
});
