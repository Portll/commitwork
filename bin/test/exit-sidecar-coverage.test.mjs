// Every lane that can be read must record its exit code: classifyReport reads `<report.file>.exit`
// beside the report, and a consulted input that nothing supplies is indistinguishable from one
// never consulted. This asserts COVERAGE of the mechanism — a new lane without a sidecar fails here.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANIFEST = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
const CW_SRC = readFileSync(join(REPO, 'bin', 'commitwork.mjs'), 'utf8');

// Lanes that signal failure through their own idiom; each lists the idiom so this stays a set of
// DECISIONS rather than exemptions.
//
// deps-osv LEFT this set: it used to propagate by `exit $rc` alone, which made an empty artifact
// and a crashed tool the same absence, and recorded exit 128 ("no package sources found" — a
// coverage void) as a failed lane. It now writes osv.sarif.exit for every outcome and lets 128
// fall through to the classifier, so it is an ordinary sidecar lane and is counted as one.
//
// jackson-caseinsensitive-guard LEFT it too: its GUARD_FAIL marker was read by nothing, because the
// lane was a 'generic' pass-through. It now writes jackson-guard.txt.exit, which its parser reads.
const OWN_IDIOM = new Map([
  ['yarn-audit', 'no trailing `|| true`; the command ends in a redirect and its status reaches sh directly'],
  ['deps-renovate', 'writes RENOVATE_CONFIG_INVALID into its own report on failure'],
]);

const localOf = (c) => (Array.isArray(c.local) ? c.local : c.local ? [c.local] : []);
const cmdText = (c) => localOf(c).join('\n');

describe('the exit-code sidecar is written by every lane the reader can consult', () => {
  test('the reader still looks for <report.file>.exit — if this moves, the rest of this file is wrong', () => {
    assert.match(CW_SRC, /join\(repoDir, `\$\{check\.report\.file\}\.exit`\)/,
      'classifyReport must resolve the sidecar as `${check.report.file}.exit` beside the report; '
      + 'the manifest commands are written to match that exact name');
  });

  test('every check that publishes a report writes its sidecar, under the name the reader expects', () => {
    const missing = [];
    for (const c of MANIFEST.checks) {
      const file = c.report && c.report.file;
      if (!file || OWN_IDIOM.has(c.id)) continue;
      if (!cmdText(c).includes(`/${file}.exit"`)) missing.push(`${c.id} (report ${file})`);
    }
    assert.deepEqual(missing, [],
      'these lanes publish a report but never write the exit sidecar that classifyReport reads, so an '
      + 'empty artifact from a crashed tool will read as a clean scan:\n  ' + missing.join('\n  '));
  });

  test('the sidecar is written AFTER the tool, not after a `|| true` that would always record 0', () => {
    // `cmd || true; echo $?` records the exit of `true` — the sidecar must replace the `|| true`
    const wrong = [];
    for (const c of MANIFEST.checks) {
      const file = c.report && c.report.file;
      if (!file) continue;
      const txt = cmdText(c);
      if (!txt.includes(`/${file}.exit"`)) continue;
      const i = txt.lastIndexOf('|| true');
      const j = txt.lastIndexOf(`/${file}.exit"`);
      // a `|| true` inside $(...) is fine (it guards a subshell, not the tool); only flag one that
      // sits between the tool and the echo on the same statement chain
      if (i > -1 && i < j && /\|\| true\s*;\s*echo \$\?/.test(txt)) wrong.push(c.id);
    }
    assert.deepEqual(wrong, [],
      'these record the exit status of `true` rather than of the scanner: ' + wrong.join(', '));
  });

  test('the exempt lanes each still signal failure some other way — an exemption is not a hole', () => {
    for (const [id, idiom] of OWN_IDIOM) {
      const c = MANIFEST.checks.find((x) => x.id === id);
      assert.ok(c, `${id} is listed as exempt but no longer exists in the manifest — drop it from the list`);
      const txt = cmdText(c);
      const signals = /exit \$/.test(txt) || /GUARD_FAIL/.test(txt) || /INVALID/.test(txt)
        || !/\|\| true\s*$/.test(txt.split('\n').pop() || '');
      assert.ok(signals, `${id} is exempt on the grounds that it ${idiom} — that idiom is no longer present`);
    }
  });

  test('coverage is stated as a fraction, so a shrinking one is visible rather than merely true', () => {
    const withReport = MANIFEST.checks.filter((c) => c.report && c.report.file);
    const withSidecar = withReport.filter((c) => cmdText(c).includes(`/${c.report.file}.exit"`));
    assert.equal(withSidecar.length + OWN_IDIOM.size, withReport.length,
      `${withSidecar.length} of ${withReport.length} report-publishing lanes write a sidecar, plus `
      + `${OWN_IDIOM.size} exempt by their own idiom — the three numbers must account for every lane`);
  });
});
