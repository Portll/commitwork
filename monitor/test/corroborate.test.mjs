import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { markCorroboration, corroborationReport, isAdvisoryId, markSastPlaceCorroboration, sastCorroborationReport } from '../corroborate.mjs';

afterEach(() => { delete process.env.CW_CORROBORATE; });

// The measured pair: AlkaidLab_foundation-sunshine's body-parser is CVE-2026-12590 to osv and
// GHSA-v422-hmwv-36x6 to npm, and osv publishes the alias group in rule.deprecatedIds.
const pair = () => ([
  { tool: 'osv', id: 'CVE-2026-12590', package: 'body-parser', path: 'file:///src/yarn.lock',
    aliases: ['CVE-2026-12590', 'GHSA-v422-hmwv-36x6'], severity: 'high',
    key: 'AlkaidLab_foundation-sunshine|osv|CVE-2026-12590|body-parser|file:///src/yarn.lock' },
  { tool: 'npm', id: 'GHSA-v422-hmwv-36x6', package: 'body-parser', path: 'package-lock.json',
    severity: 'high', key: 'AlkaidLab_foundation-sunshine|npm|GHSA-v422-hmwv-36x6|body-parser|package-lock.json' },
]);

describe('corroborate — additive, because a vanished key reads as FIXED', () => {
  test('NOTHING is removed and no identity field moves', () => {
    const rows = pair();
    const before = rows.map((r) => ({ key: r.key, tool: r.tool, id: r.id, package: r.package, path: r.path }));
    const out = markCorroboration(rows);
    assert.equal(out.length, 2, 'a collapse here would delete a key, and the ledger reads that as remediated');
    out.forEach((r, i) => {
      assert.equal(r.key, before[i].key);
      assert.equal(r.tool, before[i].tool);
      assert.equal(r.id, before[i].id);
      assert.equal(r.package, before[i].package);
      assert.equal(r.path, before[i].path);
    });
  });

  test('each row points at the other, and both say two tools saw it', () => {
    const [osv, npm] = markCorroboration(pair());
    assert.deepEqual(osv.corroboratedBy, [{ tool: 'npm', id: 'GHSA-v422-hmwv-36x6', path: 'package-lock.json' }]);
    assert.deepEqual(npm.corroboratedBy, [{ tool: 'osv', id: 'CVE-2026-12590', path: 'file:///src/yarn.lock' }]);
    assert.equal(osv.tools, 2);
    assert.equal(npm.tools, 2);
  });

  test('the join needs the ALIAS — same package under unrelated advisories stays independent', () => {
    const rows = pair();
    rows[1].id = 'GHSA-unrelated-advisory';
    const [osv, npm] = markCorroboration(rows);
    assert.equal(osv.corroboratedBy, undefined);
    assert.equal(npm.corroboratedBy, undefined);
  });

  test('a different PACKAGE is never corroboration, even under the same id', () => {
    const rows = pair();
    rows[1].package = 'something-else';
    assert.equal(markCorroboration(rows)[0].corroboratedBy, undefined);
  });

  test('a different REPO is never corroboration', () => {
    const rows = pair();
    rows[1].key = 'other_repo|npm|GHSA-v422-hmwv-36x6|body-parser|package-lock.json';
    assert.equal(markCorroboration(rows)[0].corroboratedBy, undefined);
  });

  test('one tool matching its OWN alias group is not a second witness', () => {
    const rows = [
      { tool: 'osv', id: 'CVE-1', package: 'p', aliases: ['CVE-1', 'GHSA-x'], key: 'r|osv|CVE-1|p|a' },
      { tool: 'osv', id: 'GHSA-x', package: 'p', aliases: ['CVE-1', 'GHSA-x'], key: 'r|osv|GHSA-x|p|a' },
    ];
    const out = markCorroboration(rows);
    assert.equal(out[0].corroboratedBy, undefined, 'one scanner is one witness however many ids it prints');
  });

  test('a sole witness is left unmarked — absence of a twin is not a defect', () => {
    const rows = [pair()[0]];
    assert.equal(markCorroboration(rows)[0].corroboratedBy, undefined);
    assert.equal(markCorroboration(rows)[0].tools, undefined);
  });
});

describe('corroborate — a row that cites no advisory is not advisory-backed', () => {
  // npm audit's parent rollups: `via` holds only strings, so parseNpm's no-advisory branch sets
  // `id` to the PACKAGE NAME. Measured: less, discord.js, @discordjs/rest — rendering at high/med
  // while citing nothing anyone can look up. osv has no row for them because the vulnerability is
  // in the child, which osv attributes to the child.
  test('the three measured parent rollups are marked', () => {
    for (const name of ['less', 'discord.js', '@discordjs/rest']) {
      const [r] = markCorroboration([{ tool: 'npm', id: name, package: name, severity: 'high', key: `x|npm|${name}|${name}|p` }]);
      assert.equal(r.citesNoAdvisory, true, `${name} names no advisory`);
      assert.equal(r.attribution, 'parent-rollup');
    }
  });

  test('a real advisory id is never marked', () => {
    for (const r of markCorroboration(pair())) {
      assert.equal(r.citesNoAdvisory, undefined);
      assert.equal(r.attribution, undefined);
    }
  });

  test('isAdvisoryId knows the prefixes the fleet actually carries', () => {
    for (const id of ['CVE-2026-12590', 'GHSA-v422-hmwv-36x6', 'MAL-2026-276', 'GO-2024-1', 'PYSEC-2021-1', 'RUSTSEC-2020-1']) {
      assert.equal(isAdvisoryId(id), true, id);
    }
    for (const id of ['less', 'discord.js', '@discordjs/rest', '', null, undefined, 42]) {
      assert.equal(isAdvisoryId(id), false, String(id));
    }
  });
});

describe('corroborate — the report', () => {
  test('counts witnesses, and says why the rows are still two', () => {
    const r = corroborationReport(markCorroboration(pair()));
    assert.equal(r.total, 2);
    assert.equal(r.corroborated, 2);
    assert.equal(r.soleWitness, 0);
    assert.match(r.note, /the ledger reads as FIXED|reads as FIXED/);
    assert.match(r.note, /never an edit/);
  });

  test('no corroboration means no note — an empty claim is not published', () => {
    assert.equal(corroborationReport(markCorroboration([pair()[0]])).note, '');
  });

  test('the override disables the marking, and the report says so', () => {
    process.env.CW_CORROBORATE = 'off';
    const out = markCorroboration(pair());
    assert.equal(out[0].corroboratedBy, undefined);
    assert.equal(corroborationReport(out).enabled, false);
  });

  test('empty and absent inputs are tolerated', () => {
    for (const input of [[], null, undefined]) {
      assert.deepEqual(markCorroboration(input) || [], []);
      assert.equal(corroborationReport(input).total, 0);
    }
  });
});

describe('markSastPlaceCorroboration — meta-SAST, keyed on repo|file, tightened by CWE', () => {
  test('two tools on the SAME file, no shared CWE: corroborated, unlabelled (place only)', () => {
    const byCategory = {
      sastSemgrep: [{ repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: '', cwe: '', corroboratedBy: '' }],
      sastCodeql: [{ repo: 'r1', rule: 'js/xss', file: 'src/a.js', line: 9, sev: 'high', message: '', cwe: '', corroboratedBy: '' }],
    };
    markSastPlaceCorroboration(byCategory);
    assert.equal(byCategory.sastSemgrep[0].corroboratedBy, 'sastCodeql:js/xss');
    assert.equal(byCategory.sastCodeql[0].corroboratedBy, 'sastSemgrep:js.xss');
  });

  test('two tools, same file, SHARED CWE: labelled [cwe] — the tighter claim', () => {
    const byCategory = {
      sastSemgrep: [{ repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: '', cwe: 'CWE-79', corroboratedBy: '' }],
      sastCodeql: [{ repo: 'r1', rule: 'js/xss', file: 'src/a.js', line: 9, sev: 'high', message: '', cwe: 'CWE-79', corroboratedBy: '' }],
    };
    markSastPlaceCorroboration(byCategory);
    assert.equal(byCategory.sastSemgrep[0].corroboratedBy, 'sastCodeql:js/xss [cwe]');
  });

  test('same tool, same file: not corroboration — the SCA rule about a tool matching itself carries over', () => {
    const byCategory = {
      sastSemgrep: [
        { repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: '', cwe: '', corroboratedBy: '' },
        { repo: 'r1', rule: 'js.sqli', file: 'src/a.js', line: 2, sev: 'high', message: '', cwe: '', corroboratedBy: '' },
      ],
    };
    markSastPlaceCorroboration(byCategory);
    assert.equal(byCategory.sastSemgrep[0].corroboratedBy, '', 'two findings from the SAME tool in one file are not cross-tool evidence');
  });

  test('different repos with the same file path do not cross-corroborate — the key is repo|file', () => {
    const byCategory = {
      sastSemgrep: [{ repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: '', cwe: '', corroboratedBy: '' }],
      sastCodeql: [{ repo: 'r2', rule: 'js/xss', file: 'src/a.js', line: 9, sev: 'high', message: '', cwe: '', corroboratedBy: '' }],
    };
    markSastPlaceCorroboration(byCategory);
    assert.equal(byCategory.sastSemgrep[0].corroboratedBy, '');
    assert.equal(byCategory.sastCodeql[0].corroboratedBy, '');
  });

  test('identity fields (rule, file) are never touched — additive only', () => {
    const byCategory = {
      sastSemgrep: [{ repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: 'm', cwe: '', corroboratedBy: '' }],
      sastGo: [{ repo: 'r1', rule: 'G101', file: 'src/a.js', line: 5, sev: 'med', message: 'm2', cwe: '', corroboratedBy: '' }],
    };
    const before = JSON.parse(JSON.stringify(byCategory));
    markSastPlaceCorroboration(byCategory);
    for (const key of ['sastSemgrep', 'sastGo']) {
      const b = before[key][0]; const a = byCategory[key][0];
      assert.equal(a.rule, b.rule); assert.equal(a.file, b.file); assert.equal(a.line, b.line);
      assert.equal(a.sev, b.sev); assert.equal(a.message, b.message);
    }
  });

  test('a lint category (lintGo) is not in SAST_JOIN_KEYS — a linter never earns a corroborated-SAST signal', async () => {
    const { SAST_JOIN_KEYS } = await import('../corroborate.mjs');
    assert.ok(!SAST_JOIN_KEYS.includes('lintGo'), 'lintGo is hygiene, not-a-vulnerability — see extractors.mjs LANE_KINDS');
  });

  test('CW_CORROBORATE=off disables the SAST join too', () => {
    process.env.CW_CORROBORATE = 'off';
    const byCategory = {
      sastSemgrep: [{ repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: '', cwe: '', corroboratedBy: '' }],
      sastCodeql: [{ repo: 'r1', rule: 'js/xss', file: 'src/a.js', line: 9, sev: 'high', message: '', cwe: '', corroboratedBy: '' }],
    };
    markSastPlaceCorroboration(byCategory);
    assert.equal(byCategory.sastSemgrep[0].corroboratedBy, '', 'untouched while disabled — still the rowsFor default, not a fresh empty assignment');
  });

  test('sastCorroborationReport counts total, corroborated and the cwe-tightened subset', () => {
    const byCategory = {
      sastSemgrep: [{ repo: 'r1', rule: 'js.xss', file: 'src/a.js', line: 1, sev: 'high', message: '', cwe: 'CWE-79', corroboratedBy: '' }],
      sastCodeql: [{ repo: 'r1', rule: 'js/xss', file: 'src/a.js', line: 9, sev: 'high', message: '', cwe: 'CWE-79', corroboratedBy: '' }],
      sastGo: [{ repo: 'r1', rule: 'G101', file: 'src/other.go', line: 1, sev: 'low', message: '', cwe: '', corroboratedBy: '' }],
    };
    markSastPlaceCorroboration(byCategory);
    const rep = sastCorroborationReport(byCategory);
    assert.equal(rep.total, 3);
    assert.equal(rep.corroborated, 2);
    assert.equal(rep.withCweMatch, 2);
    assert.equal(rep.soleWitness, 1);
    assert.match(rep.note, /2 of 3 SAST findings/);
  });

  test('empty and absent inputs are tolerated', () => {
    assert.deepEqual(markSastPlaceCorroboration({}), {});
    assert.equal(markSastPlaceCorroboration(null), null);
    assert.equal(sastCorroborationReport(null).total, 0);
    assert.equal(sastCorroborationReport({}).total, 0);
  });
});
