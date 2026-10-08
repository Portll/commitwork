import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { classify, partition, inheritUndetermined, isSemver, ecosystemOf, SECURITY_HOLDER } from '../advisory-reach.mjs';

afterEach(() => { delete process.env.CW_ADVISORY_REACH; });

// Version strings taken VERBATIM from osv.sarif message text in
// sweep-20260823125546-100randomrepos (osv-scanner run under docker 29.6.2, probed
// 2026-08-23T15:21:48Z). The grammar is `Package '<name>@<version>' is vulnerable to '<id>'`.
// If a future osv-scanner resolves git dependencies to their package.json version instead of a
// commit-ish, the non-semver detector silently stops firing — these two rows are the tripwire.
const REAL = {
  firebase: { id: 'MAL-2026-276', package: 'closure-net', version: '6f48f578', path: 'file:///src/yarn.lock' },
  logseq: { id: 'MAL-2025-21003', package: 'fs', version: '0.0.1-security', path: 'file:///src/pnpm-lock.yaml' },
};

describe('advisory-reach — could the advisory have reached the installed version', () => {
  test('the measured firebase case: a git-pinned commit-ish is not an npm version', () => {
    const c = classify(REAL.firebase);
    assert.equal(c.reachable, false);
    assert.equal(c.code, 'non-semver');
    assert.match(c.reason, /SEMVER range cannot have matched/);
  });

  test('the reason never claims the package is safe — only that the advisory does not reach it', () => {
    const c = classify(REAL.firebase);
    assert.match(c.reason, /says nothing about whether the installed source is safe/,
      'a git dependency can be compromised at its source; this file has no opinion on that');
  });

  test('a demoted row resolves through unknown.mjs to the RIGHT reason', async () => {
    // Without the shared fields, LEGACY_STATE_TO_REASON's `undetermined` entry resolved a demoted
    // row to 'not-adjudicated' — "the analyser ran and declined to determine this one". The
    // analyser did not decline; it asserted a critical, and this file determined the assertion
    // describes a different artifact. A wrong reason under a shared vocabulary is worse than a
    // private word, because it aggregates.
    const { unknownReasonOf, UNKNOWN_REASONS } = await import('../unknown.mjs');
    const c = classify(REAL.firebase);
    assert.equal(c.unknown, true);
    assert.equal(c.unknownReason, 'subject-mismatch');
    assert.ok(UNKNOWN_REASONS['subject-mismatch'], 'the reason must be in the closed set, not coined here');
    assert.equal(unknownReasonOf({ undetermined: true, ...c }), 'subject-mismatch');
  });

  test('the measured logseq case: 0.0.1-security is the takedown, not the malware', () => {
    const c = classify(REAL.logseq);
    assert.equal(c.reachable, false);
    assert.equal(c.code, 'security-holder');
  });
});

describe('advisory-reach — real malware STAYS crit', () => {
  // A fix that demotes real malware is worse than the defect it corrects.
  for (const [pkg, version, id] of [
    ['flatmap-stream', '0.1.1', 'MAL-2025-20690'],   // the 2018 event-stream attack
    ['@ctrl/tinycolor', '4.1.1', 'MAL-2025-47141'],  // Shai-Hulud, cited in rollup.mjs
    ['event-stream', '3.3.6', 'MAL-2025-20690'],
    ['fsevents', '1.2.4', 'MAL-2023-462'],
  ]) {
    test(`${pkg}@${version} is a plain semver and is left exactly as published`, () => {
      const c = classify({ id, package: pkg, version, path: 'file:///src/package-lock.json' });
      assert.equal(c.reachable, true);
      assert.equal(c.code, null);
    });
  }
});

describe('advisory-reach — fail closed', () => {
  test('an ABSENT version does not demote: a parse failure is not a demotion', () => {
    // isSemver('') is false, so a naive !isSemver would turn every unparsed message into a
    // silent demotion. The row stays exactly as the scanner published it.
    for (const version of ['', '   ', undefined, null]) {
      const c = classify({ id: 'MAL-2026-276', package: 'closure-net', version, path: 'file:///src/yarn.lock' });
      assert.equal(c.reachable, true, `version ${JSON.stringify(version)} must not demote`);
    }
  });

  test('a non-string version does not demote', () => {
    assert.equal(classify({ id: 'MAL-2026-276', version: 123, path: 'file:///src/yarn.lock' }).reachable, true);
  });

  test('an empty or malformed row does not demote', () => {
    assert.equal(classify({}).reachable, true);
    assert.equal(classify(null).reachable, true);
    assert.equal(classify(undefined).reachable, true);
  });
});

describe('advisory-reach — the security-holder suffix is forgeable, the literal is not', () => {
  test(`only the exact literal ${SECURITY_HOLDER} demotes`, () => {
    assert.equal(classify({ id: 'MAL-2026-276', version: SECURITY_HOLDER, path: 'file:///src/package-lock.json' }).reachable, false);
  });

  test('a forged -security prerelease does NOT demote', () => {
    // -security is an ordinary semver prerelease tag and npm does not reserve it. A loose
    // /-security$/ would let an attacker demote their own malware by choosing a version.
    for (const version of ['9.9.9-security', '1.0.0-security', '0.0.2-security', '0.0.1-security.1']) {
      const c = classify({ id: 'MAL-2026-276', version, path: 'file:///src/package-lock.json' });
      assert.equal(c.reachable, true, `${version} must not demote — the suffix is attacker-choosable`);
    }
  });
});

describe('advisory-reach — scope', () => {
  test('a scored CVE is never touched, whatever its version looks like', () => {
    const c = classify({ id: 'CVE-2023-44487', version: '6f48f578', path: 'file:///src/yarn.lock' });
    assert.equal(c.reachable, true, 'this rule is about blanket introduced:0 malware records only');
  });

  test('a GHSA id is never touched', () => {
    assert.equal(classify({ id: 'GHSA-9vx9-5r47-4mxj', version: '6f48f578', path: 'file:///src/yarn.lock' }).reachable, true);
  });

  test('a non-npm ecosystem is left alone — Packagist dev-master is a legitimate version', () => {
    const c = classify({ id: 'MAL-2026-276', version: 'dev-master', path: 'file:///src/composer.lock' });
    assert.equal(c.reachable, true, 'a rule written for npm would demote every Composer finding');
  });

  test('every non-npm ecosystem in the map is exempt', () => {
    for (const [file, eco] of Object.entries({
      'composer.lock': 'Packagist', 'Gemfile.lock': 'RubyGems', 'go.sum': 'Go',
      'Cargo.lock': 'crates.io', 'pom.xml': 'Maven', 'requirements.txt': 'PyPI',
    })) {
      assert.equal(ecosystemOf(`file:///src/${file}`), eco);
      assert.equal(classify({ id: 'MAL-2026-276', version: 'abcdef1', path: `file:///src/${file}` }).reachable, true);
    }
  });

  test('all three npm lockfile formats are in scope', () => {
    for (const file of ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml']) {
      assert.equal(ecosystemOf(`file:///src/${file}`), 'npm');
      assert.equal(classify({ id: 'MAL-2026-276', version: '6f48f578', path: `file:///src/${file}` }).reachable, false);
    }
  });

  test('an unknown lockfile yields no ecosystem and is left alone', () => {
    assert.equal(ecosystemOf('file:///src/deno.lock'), '');
    assert.equal(classify({ id: 'MAL-2026-276', version: 'abcdef1', path: 'file:///src/deno.lock' }).reachable, true);
  });

  test('ecosystem is read from the basename at any depth', () => {
    assert.equal(ecosystemOf('file:///src/e2e/smoke-tests/yarn.lock'), 'npm');
    assert.equal(ecosystemOf('yarn.lock'), 'npm');
    assert.equal(ecosystemOf(''), '');
  });
});

describe('advisory-reach — isSemver is the actual predicate, not a hex shape', () => {
  test('npm versions are semver and are never demoted', () => {
    for (const v of ['0.0.0', '1.2.3', '10.0.0-beta.1', '1.0.0+build.5', '0.0.1-alpha', '1.2.3-rc.1+exp.sha.5114f85']) {
      assert.equal(isSemver(v), true, `${v} is a valid npm version`);
    }
  });

  test('a commit-ish at any length is not semver — 7, 8, 40 characters alike', () => {
    for (const v of ['6f48f57', '6f48f578', '6f48f578d3e80fe7a85e530a5d95b9351433d135', 'master', 'v1', 'main']) {
      assert.equal(isSemver(v), false, `${v} was never resolved from the npm registry`);
    }
  });

  test('a version that merely CONTAINS a commit-ish is still semver', () => {
    // Go pseudo-versions have this shape. The npm gate exempts them anyway, but the predicate
    // must not be fooled into demoting one if the ecosystem map ever widens.
    assert.equal(isSemver('0.0.0-20210101000000-abcdef123456'), true);
  });

  test('a non-string is never semver', () => {
    for (const v of [null, undefined, 123, {}, []]) assert.equal(isSemver(v), false);
  });
});

describe('advisory-reach — the env override restores the prior output exactly', () => {
  test('CW_ADVISORY_REACH=off makes every row reachable again', () => {
    process.env.CW_ADVISORY_REACH = 'off';
    for (const row of Object.values(REAL)) {
      const c = classify(row);
      assert.equal(c.reachable, true);
      assert.equal(c.code, null);
    }
  });

  test('the env is read at CALL time, not at module load', () => {
    // A `const X = process.env.Y` at import silently defeats the override for any test that sets
    // it afterwards — the test passes while proving nothing.
    assert.equal(classify(REAL.firebase).reachable, false);
    process.env.CW_ADVISORY_REACH = 'off';
    assert.equal(classify(REAL.firebase).reachable, true);
    delete process.env.CW_ADVISORY_REACH;
    assert.equal(classify(REAL.firebase).reachable, false);
  });

  test('any other value leaves classification ON — only the literal "off" disables it', () => {
    process.env.CW_ADVISORY_REACH = 'on';
    assert.equal(classify(REAL.firebase).reachable, false);
    process.env.CW_ADVISORY_REACH = '';
    assert.equal(classify(REAL.firebase).reachable, false);
  });
});

describe('advisory-reach — the two lanes must not disagree about one package', () => {
  // The measured shape: osv sees closure-net@6f48f578 from yarn.lock and demotes it; npm audit
  // reports the same advisory under its GHSA alias with version 0.0.0 — valid semver, so the
  // non-semver rule is blind to it. Without the join, firebase reads undetermined in one lane
  // and critical in the other.
  const osvRow = { tool: 'osv', id: 'MAL-2026-276', package: 'closure-net', version: '6f48f578',
    aliases: ['MAL-2026-276', 'GHSA-9vx9-5r47-4mxj'], severity: 'unknown', undetermined: true,
    undeterminedCode: 'non-semver', undeterminedReason: 'version is not a semver' };
  const npmRow = { tool: 'npm', id: 'GHSA-9vx9-5r47-4mxj', package: 'closure-net', version: '', severity: 'crit' };

  test('the npm twin follows its osv row out of crit', () => {
    const [n] = inheritUndetermined([osvRow], [npmRow]);
    assert.equal(n.severity, 'unknown');
    assert.equal(n.undetermined, true);
    assert.equal(n.claimedSeverity, 'crit', 'the original claim is preserved, not erased');
    assert.match(n.undeterminedReason, /carried from MAL-2026-276/);
  });

  test('the join needs BOTH the package name and the alias — a name match alone is not enough', () => {
    const other = { tool: 'npm', id: 'GHSA-different-advisory', package: 'closure-net', severity: 'crit' };
    assert.equal(inheritUndetermined([osvRow], [other])[0].severity, 'crit',
      'two lanes reporting one package under unrelated advisories stay independent');
    const wrongPkg = { tool: 'npm', id: 'GHSA-9vx9-5r47-4mxj', package: 'something-else', severity: 'crit' };
    assert.equal(inheritUndetermined([osvRow], [wrongPkg])[0].severity, 'crit');
  });

  test('an osv row that was NOT demoted carries nothing across', () => {
    const live = { ...osvRow, severity: 'crit', undetermined: undefined, undeterminedCode: undefined };
    assert.equal(inheritUndetermined([live], [npmRow])[0].severity, 'crit');
  });

  test('an osv row with no alias group carries nothing across', () => {
    const noAliases = { ...osvRow, aliases: undefined };
    assert.equal(inheritUndetermined([noAliases], [npmRow])[0].severity, 'crit');
  });

  test('the override disables the join too', () => {
    process.env.CW_ADVISORY_REACH = 'off';
    assert.equal(inheritUndetermined([osvRow], [npmRow])[0].severity, 'crit');
  });

  test('it tolerates empty and absent inputs, and never drops a row', () => {
    assert.deepEqual(inheritUndetermined([], []), []);
    assert.deepEqual(inheritUndetermined(null, null), []);
    assert.equal(inheritUndetermined([osvRow], [npmRow, { tool: 'npm', id: 'X', package: 'y' }]).length, 2);
  });
});

describe('advisory-reach — partition classifies, never drops', () => {
  const rows = [
    REAL.firebase,
    REAL.logseq,
    { id: 'MAL-2025-20690', package: 'flatmap-stream', version: '0.1.1', path: 'file:///src/yarn.lock' },
    { id: 'CVE-2023-44487', package: 'golang.org/x/net', version: '0.7.0', path: 'file:///src/go.sum' },
  ];

  test('nothing is lost: kept + undetermined accounts for every row', () => {
    const { kept, undetermined, report } = partition(rows);
    assert.equal(kept.length + undetermined.length, rows.length);
    assert.equal(report.total, rows.length);
  });

  test('an undetermined row keeps its original claim, and says why', () => {
    const { undetermined } = partition(rows);
    const fb = undetermined.find((r) => r.package === 'closure-net');
    assert.equal(fb.id, 'MAL-2026-276');
    assert.equal(fb.version, '6f48f578');
    assert.equal(fb.path, 'file:///src/yarn.lock');
    assert.equal(fb.undetermined, true);
    assert.equal(fb.undeterminedCode, 'non-semver');
    assert.ok(fb.undeterminedReason.length > 40, 'a demotion with no reason is a silent edit of the evidence');
  });

  test('the residue is MEASURED, not assumed to be zero', () => {
    // Two shapes are detected. unclassified counts the MAL rows that matched neither, so the
    // next sweep contradicts "these are the only two" instead of nobody ever asking.
    const { report } = partition(rows);
    assert.equal(report.malicious, 3);
    assert.equal(report.undetermined, 2);
    assert.equal(report.unclassified, 1, 'flatmap-stream is a real MAL row that stays published');
    assert.deepEqual(report.byCode, { 'non-semver': 1, 'security-holder': 1 });
  });

  test('the note states the scope limit and never asserts safety', () => {
    const { report } = partition(rows);
    assert.match(report.note, /never whether the installed source is safe/);
    assert.match(report.note, /CW_ADVISORY_REACH=off/);
  });

  test('no undetermined rows means no note — an empty claim is not published', () => {
    const { report } = partition([rows[2], rows[3]]);
    assert.equal(report.undetermined, 0);
    assert.equal(report.note, '');
  });

  test('a demotion only ever produces a severity the totals NAME', () => {
    // The invariant this guards: crit/high/med/low have never summed to the row count — 980 rows
    // fleet-wide already sit at `unknown`. cveTotals now names `unknown` and `undetermined`, so a
    // demoted row is counted somewhere. A demotion to any OTHER value would land in no bucket at
    // all and read as clean, which is the defect this file exists to remove, inverted.
    const COUNTED = new Set(['crit', 'high', 'med', 'low', 'unknown']);
    const osvRow = { tool: 'osv', id: 'MAL-2026-276', package: 'closure-net', version: '6f48f578',
      aliases: ['MAL-2026-276', 'GHSA-9vx9-5r47-4mxj'], severity: 'unknown', undetermined: true,
      undeterminedCode: 'non-semver', undeterminedReason: 'x' };
    for (const n of inheritUndetermined([osvRow], [{ tool: 'npm', id: 'GHSA-9vx9-5r47-4mxj', package: 'closure-net', severity: 'crit' }])) {
      assert.ok(COUNTED.has(n.severity), `${n.severity} is counted by no bucket`);
    }
  });

  test('partition tolerates an empty or absent list', () => {
    for (const input of [[], null, undefined]) {
      const { kept, undetermined, report } = partition(input);
      assert.deepEqual(kept, []);
      assert.deepEqual(undetermined, []);
      assert.equal(report.total, 0);
    }
  });

  test('with the override off, partition sets nothing aside', () => {
    process.env.CW_ADVISORY_REACH = 'off';
    const { kept, undetermined, report } = partition(rows);
    assert.equal(kept.length, rows.length);
    assert.equal(undetermined.length, 0);
    assert.equal(report.enabled, false);
    assert.equal(report.unclassified, 3, 'every MAL row is unclassified when the detector is off');
  });
});
