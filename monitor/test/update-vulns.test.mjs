// node --test monitor/test/ — the properties that decide whether this panel can be believed.
//
// The load-bearing one: "what does this update fix" is a SET DIFFERENCE between two runs of the
// same matcher, so the tests drive a fake matcher that answers from a declared version constraint
// and assert the arithmetic — including the two directions that lie. A row nobody could evaluate
// must read UNKNOWN with a reason, never "fixes nothing"; and only the artifact carrying the
// package's OWN version may be rewritten to the target version, because rewriting an embedded
// dependency would claim an upgrade fixes something nobody can see from here.
//
// Every fixture is synthetic. Nothing here names a package installed on any real machine.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  matchesFrom, grypeQuery, rowKey, setDiff, upstreamVersion, cmpVersion, retarget, mergeSbom,
  splitByKey, parseFullInstallers, parseUpdateList, parsePlistXml, parseOfferId, selectOsTargets,
  softwareUpdatePrefs, macosCpe, macosLane, brewLane, npmLane, npmPurl, kegPath, runUpdates,
  grypeDbState, outPath, writeUpdates, rowOrder,
} from '../update-vulns.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-updvuln-')); dirs.push(d); return d; };

// Env is set AFTER the import above, which is the point: a module that read process.env at load
// time would pass every test below while proving nothing about the override.
const withEnv = (kv, fn) => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; if (v === null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally {
    for (const k of Object.keys(kv)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
};

// ── a fake matcher with a declared rule set ────────────────────────────────────────────────────
// `fixedIn` is the version that closes it, so the same function answers both sides and the set
// difference is a property of the versions rather than of the fake.
const DB = [
  { component: 'samplelib', fixedIn: '1.5.0', id: 'CVE-2099-0001', severity: 'High' },
  { component: 'samplelib', fixedIn: '3.0.0', id: 'CVE-2099-0002', severity: 'Critical' },
  { component: 'embeddedlib', fixedIn: '9.9.9', id: 'CVE-2099-0003', severity: 'Medium' },
  { component: 'sample-cli', fixedIn: '2.0.0', id: 'GHSA-aaaa-bbbb-cccc', severity: 'Critical' },
  { component: 'samplemac', fixedIn: null, id: 'CVE-1999-9999', severity: 'Low' },   // no fix recorded, ever
];
const OS_DB = [
  { upto: '26.6.1', id: 'CVE-2099-1001', severity: 'Critical' },
  { upto: '26.6.1', id: 'CVE-2099-1002', severity: 'High' },
  { upto: '27.1', id: 'CVE-2099-1003', severity: 'Medium' },
  { upto: null, id: 'CVE-1999-0590', severity: 'Low' },      // matches every version, fix unknown
];

const match = (id, severity, name, version, type, matchType, fixVersions, artifactId) => ({
  vulnerability: { id, severity, fix: { versions: fixVersions, state: fixVersions.length ? 'fixed' : 'unknown' } },
  artifact: { id: artifactId, name, version, type },
  matchDetails: [{ type: matchType }],
});

function matchArtifact(a) {
  return DB.filter((d) => d.component === a.name && (d.fixedIn === null || cmpVersion(a.version, d.fixedIn) < 0))
    .map((d) => match(d.id, d.severity, a.name, a.version, a.type || 'binary', 'exact-direct-match', d.fixedIn ? [d.fixedIn] : [], a.id));
}

/** Answers grype's three input shapes from files on disk, so the fake never sees the test's intent. */
function fakeGrype(spec) {
  if (spec.startsWith('sbom:')) {
    const doc = JSON.parse(readFileSync(spec.slice(5), 'utf8'));
    return { matches: doc.artifacts.flatMap(matchArtifact) };
  }
  if (spec.startsWith('purl:')) {
    const purls = readFileSync(spec.slice(5), 'utf8').split('\n').filter(Boolean);
    return {
      matches: purls.flatMap((p) => {
        const [name, version] = p.replace('pkg:npm/', '').replace(/%40/g, '@').split('@').length === 3
          ? [`@${p.replace('pkg:npm/%40', '').split('@')[0]}`, p.split('@').pop()]
          : [p.replace('pkg:npm/', '').split('@')[0], p.split('@').pop()];
        return matchArtifact({ id: `purl-${name}`, name, version, type: 'npm' });
      }),
    };
  }
  if (spec.startsWith('cpe:')) {
    const version = spec.split(':')[5];
    return {
      matches: OS_DB.filter((d) => d.upto === null || cmpVersion(version, d.upto) < 0)
        .map((d) => match(d.id, d.severity, 'macos', version, '', 'cpe-match', d.upto ? [d.upto] : [], 'os')),
    };
  }
  return { matches: [] };
}

const runner = ({ dbValid = true, tools = {} } = {}) => (cmd, args) => {
  if (tools[cmd]) return tools[cmd](args);
  if (cmd === 'grype' && args[0] === 'db' && args[1] === 'status') {
    return dbValid
      ? { status: 0, stdout: 'Path: /x\nSchema: v6.1.9\nBuilt: 2099-01-01T00:00:00Z\nStatus:    valid\n', stderr: '', errCode: null }
      : { status: 1, stdout: 'Status: invalid\n', stderr: '', errCode: null };
  }
  if (cmd === 'grype') return { status: 0, stdout: JSON.stringify(fakeGrype(args[0])), stderr: '', errCode: null };
  if (cmd === 'syft') {
    const dir = args[0].replace('dir:', '');
    return { status: 0, stdout: readFileSync(join(dir, '.sbom.json'), 'utf8'), stderr: '', errCode: null };
  }
  if (cmd === 'sw_vers') return { status: 0, stdout: args[0] === '-productVersion' ? '26.4\n' : '25E246\n', stderr: '', errCode: null };
  if (cmd === 'brew' && args[0] === '--prefix') return { status: 0, stdout: '/nonexistent-prefix\n', stderr: '', errCode: null };
  return { status: 0, stdout: '', stderr: '', errCode: null };
};

// A keg on disk, with the syft output the fake syft will hand back for it.
function keg(prefix, { name, version, kind = 'formula', artifacts }) {
  const dir = join(prefix, kind === 'cask' ? 'Caskroom' : 'Cellar', name, version);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, '.sbom.json'), JSON.stringify({
    schema: { version: '16.0.0' }, source: { type: 'directory', name: dir }, distro: {}, descriptor: { name: 'syft' },
    artifacts,
  }));
  return dir;
}

const artifact = (name, version, extra = {}) => ({
  id: `id-${name}-${version}`, name, version, type: 'binary', purl: `pkg:generic/${name}@${version}`,
  cpes: [{ cpe: `cpe:2.3:a:example:${name}:${version}:*:*:*:*:*:*:*`, source: 'nvd-cpe-dictionary' }], ...extra,
});

// ── the arithmetic ─────────────────────────────────────────────────────────────────────────────
describe('the set difference', () => {
  test('fixed = installed − target, keyed on id+component and NEVER on the version', () => {
    const now = [{ id: 'CVE-1', component: 'a', componentVersion: '1.0' }, { id: 'CVE-2', component: 'a', componentVersion: '1.0' }];
    const after = [{ id: 'CVE-2', component: 'a', componentVersion: '2.0' }, { id: 'CVE-3', component: 'a', componentVersion: '2.0' }];
    const d = setDiff(now, after);
    assert.deepEqual(d.fixed.map((m) => m.id), ['CVE-1']);
    assert.deepEqual(d.remaining.map((m) => m.id), ['CVE-2'], 'the same CVE at a different version is the SAME row surviving, not a new one');
    assert.deepEqual(d.introduced.map((m) => m.id), ['CVE-3'], 'upgrading INTO a vulnerability is rare and must be reported');
    assert.equal(rowKey({ id: 'CVE-2', component: 'a', componentVersion: '1.0' }), rowKey({ id: 'CVE-2', component: 'a', componentVersion: '9.9' }));
  });

  test('a version-keyed identity would report everything fixed — the defect this key exists to avoid', () => {
    const now = [{ id: 'CVE-2', component: 'a', componentVersion: '1.0' }];
    const after = [{ id: 'CVE-2', component: 'a', componentVersion: '2.0' }];
    assert.equal(setDiff(now, after).fixed.length, 0);
  });

  test('a brew revision is not an upstream version', () => {
    assert.equal(upstreamVersion('1.11.1_4'), '1.11.1');
    assert.equal(upstreamVersion('0.4.21,2'), '0.4.21');
    assert.equal(upstreamVersion('26.7'), '26.7');
  });
});

describe('matches keep the fix, because a row with no fix cannot be closed by any update', () => {
  test('matchesFrom carries fixVersions and drops rows without an id or component', () => {
    const rows = matchesFrom({ matches: [match('CVE-1', 'High', 'a', '1', 'npm', 'exact-direct-match', ['2']), { vulnerability: {}, artifact: {} }] });
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].fixVersions, ['2']);
  });

  test('a non-zero grype exit is unknown even when stdout parsed', () => {
    const r = grypeQuery('cpe:x', { run: () => ({ status: 2, stdout: '{"matches":[]}', stderr: 'boom', errCode: null }) });
    assert.equal(r.unknownReason, 'tool-failed');
  });

  test('grype json without matches[] is unparseable, never zero findings', () => {
    const r = grypeQuery('cpe:x', { run: () => ({ status: 0, stdout: '{"ok":true}', stderr: '', errCode: null }) });
    assert.equal(r.unknownReason, 'unparseable');
  });
});

// ── the target identity ────────────────────────────────────────────────────────────────────────
describe('only the package\'s OWN artifact may be retargeted', () => {
  test('retarget rewrites version, purl and CPE together', () => {
    const a = retarget(artifact('samplelib', '1.2.3'), '1.2.3', '2.0.0');
    assert.equal(a.version, '2.0.0');
    assert.equal(a.purl, 'pkg:generic/samplelib@2.0.0');
    assert.equal(a.cpes[0].cpe, 'cpe:2.3:a:example:samplelib:2.0.0:*:*:*:*:*:*:*');
  });

  test('a purl with qualifiers keeps them', () => {
    const a = retarget(artifact('x', '1.0', { purl: 'pkg:generic/x@1.0?arch=arm64' }), '1.0', '1.1');
    assert.equal(a.purl, 'pkg:generic/x@1.1?arch=arm64');
  });

  test('mergeSbom rewrites the own artifact on the target side and NOTHING else', () => {
    const prefix = scratch();
    const dir = keg(prefix, { name: 'samplelib', version: '1.2.3', artifacts: [artifact('samplelib', '1.2.3'), artifact('embeddedlib', '0.1.0')] });
    const entries = [{ key: 'brew:formula:samplelib', sbomPath: join(dir, '.sbom.json'), ownVersion: '1.2.3', targetVersion: '2.0.0' }];
    const now = mergeSbom(entries, { installedSide: true });
    const after = mergeSbom(entries, { installedSide: false });
    assert.deepEqual(now.doc.artifacts.map((a) => `${a.name}@${a.version}`), ['samplelib@1.2.3', 'embeddedlib@0.1.0']);
    assert.deepEqual(after.doc.artifacts.map((a) => `${a.name}@${a.version}`), ['samplelib@2.0.0', 'embeddedlib@0.1.0'],
      'an embedded dependency must NOT be rewritten — what the new release bundles is not observable from here');
    assert.deepEqual(now.own.get('brew:formula:samplelib'), ['brew:formula:samplelib#id-samplelib-1.2.3']);
    assert.equal(splitByKey([{ artifactId: 'brew:formula:samplelib#id-x' }]).get('brew:formula:samplelib').length, 1);
  });
});

// ── brew, end to end on a synthetic keg ────────────────────────────────────────────────────────
describe('the brew lane', () => {
  const setup = () => {
    const prefix = scratch();
    keg(prefix, { name: 'samplelib', version: '1.2.3', artifacts: [artifact('samplelib', '1.2.3'), artifact('embeddedlib', '0.1.0')] });
    const outdated = join(scratch(), 'brew.json');
    writeFileSync(outdated, JSON.stringify({
      formulae: [{ name: 'samplelib', installed_versions: ['1.2.3'], current_version: '2.0.0', pinned: false }],
      casks: [],
    }));
    return { prefix, outdated, cacheDir: scratch() };
  };

  test('the formula\'s own rows are measured; the keg\'s other components are UNKNOWN, never fixed', () => {
    const { prefix, outdated, cacheDir } = setup();
    const r = withEnv({ CW_BREW_PREFIX: prefix, CW_BREW_OUTDATED_JSON: outdated, CW_APPVULN_KEV: null, CW_APPVULN_EPSS: null },
      () => brewLane({ run: runner(), dbOk: true, cacheDir, kevSet: null, epss: null }));
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.fixedByUpdate.state, 'measured');
    assert.deepEqual(row.fixedByUpdate.rows.map((x) => x.id), ['CVE-2099-0001'], '1.2.3 → 2.0.0 closes the one fixed in 1.5.0');
    assert.deepEqual(row.remainingAfter.rows.map((x) => x.id), ['CVE-2099-0002'], 'the one fixed in 3.0.0 survives the upgrade');
    assert.equal(row.vulnerableNow.count, 3, 'the row still reports everything the keg matches today');
    assert.ok(row.embedded, 'the keg\'s embedded components are reported');
    assert.equal(row.embedded.state, 'unknown');
    assert.equal(row.embedded.unknownReason, 'unexaminable');
    assert.deepEqual(row.embedded.rows.map((x) => x.id), ['CVE-2099-0003']);
    assert.match(row.embedded.unknownDetail, /not observable until/);
    assert.equal(row.fixedByUpdate.rows[0].publish, 'severity', 'an exact ecosystem match publishes its severity under the F-gate');
  });

  test('a keg syft cannot identify leaves fixedByUpdate UNKNOWN with a reason — never "fixes nothing"', () => {
    const prefix = scratch();
    keg(prefix, { name: 'opaque', version: '1.0.0', artifacts: [artifact('embeddedlib', '0.1.0')] });
    const outdated = join(scratch(), 'brew.json');
    writeFileSync(outdated, JSON.stringify({ formulae: [{ name: 'opaque', installed_versions: ['1.0.0'], current_version: '2.0.0' }], casks: [] }));
    const r = withEnv({ CW_BREW_PREFIX: prefix, CW_BREW_OUTDATED_JSON: outdated },
      () => brewLane({ run: runner(), dbOk: true, cacheDir: scratch(), kevSet: null, epss: null }));
    const row = r.rows[0];
    assert.equal(row.fixedByUpdate.state, 'unknown');
    assert.equal(row.fixedByUpdate.count, 0);
    assert.equal(row.fixedByUpdate.unknownReason, 'unexaminable');
    assert.match(row.fixedByUpdate.unknownDetail, /no artifact in this keg carrying the installed version/);
    assert.equal(row.vulnerableNow.count, 1, 'what it matches TODAY is still reported');
    assert.equal(r.counts.unknown, 1);
  });

  test('a missing keg directory is no-subject, and the update is still listed', () => {
    const outdated = join(scratch(), 'brew.json');
    writeFileSync(outdated, JSON.stringify({ formulae: [{ name: 'ghost', installed_versions: ['1.0.0'], current_version: '2.0.0' }], casks: [] }));
    const r = withEnv({ CW_BREW_PREFIX: join(scratch(), 'empty'), CW_BREW_OUTDATED_JSON: outdated },
      () => brewLane({ run: runner(), dbOk: true, cacheDir: scratch(), kevSet: null, epss: null }));
    assert.equal(r.rows.length, 1, 'the update list does not need a keg to be readable');
    assert.equal(r.rows[0].fixedByUpdate.unknownReason, 'no-subject');
  });

  test('a packaging revision says so rather than claiming an upstream fix', () => {
    const prefix = scratch();
    keg(prefix, { name: 'samplelib', version: '1.2.3_1', artifacts: [artifact('samplelib', '1.2.3_1')] });
    const outdated = join(scratch(), 'brew.json');
    writeFileSync(outdated, JSON.stringify({ formulae: [{ name: 'samplelib', installed_versions: ['1.2.3_1'], current_version: '1.2.3_2' }], casks: [] }));
    const r = withEnv({ CW_BREW_PREFIX: prefix, CW_BREW_OUTDATED_JSON: outdated },
      () => brewLane({ run: runner(), dbOk: true, cacheDir: scratch(), kevSet: null, epss: null }));
    assert.match(r.rows[0].identity.note, /packaging revision/);
    assert.equal(r.rows[0].fixedByUpdate.count, 0, 'the same upstream version cannot have closed an upstream CVE');
  });

  test('a cask version containing a comma is ONE version, not two', () => {
    const prefix = scratch();
    keg(prefix, { name: 'samplecask', version: '0.4.21,2', kind: 'cask', artifacts: [artifact('samplelib', '1.2.3')] });
    const r = kegPath({ name: 'samplecask', kind: 'cask', installed: '0.4.21,2' }, { prefix });
    assert.equal(r.version, '0.4.21,2');
    assert.ok(existsSync(r.path));
  });

  test('brew unreadable is a state, not an empty update list', () => {
    const r = withEnv({ CW_BREW_OUTDATED_JSON: join(scratch(), 'nope.json') },
      () => brewLane({ run: runner(), dbOk: true, cacheDir: scratch(), kevSet: null, epss: null }));
    assert.equal(r.state, 'unavailable');
    assert.equal(r.rows.length, 0);
    assert.ok(r.reason);
  });
});

// ── npm global ─────────────────────────────────────────────────────────────────────────────────
describe('the npm-global lane', () => {
  test('purl on both sides gives a real fixed set; the installed tree stays unknown', () => {
    const treeDir = scratch();
    writeFileSync(join(treeDir, '.sbom.json'), JSON.stringify({
      schema: {}, source: {}, distro: {}, descriptor: {},
      artifacts: [artifact('sample-cli', '1.0.0', { type: 'npm' }), artifact('embeddedlib', '0.1.0', { type: 'npm' })],
    }));
    const outdated = join(scratch(), 'npm.json');
    writeFileSync(outdated, JSON.stringify({ 'sample-cli': { current: '1.0.0', latest: '2.5.0', location: treeDir } }));
    const r = withEnv({ CW_NPM_OUTDATED_JSON: outdated },
      () => npmLane({ run: runner(), dbOk: true, cacheDir: scratch(), kevSet: null, epss: null }));
    assert.equal(r.rows.length, 1);
    const row = r.rows[0];
    assert.equal(row.identity.installedPurl, 'pkg:npm/sample-cli@1.0.0');
    assert.deepEqual(row.fixedByUpdate.rows.map((x) => x.id), ['GHSA-aaaa-bbbb-cccc']);
    assert.equal(row.remainingAfter.count, 0);
    assert.equal(row.embedded.state, 'unknown', 'what the next release bundles is not observable until it is installed');
    assert.deepEqual(row.embedded.rows.map((x) => x.id), ['CVE-2099-0003']);
  });

  test('a scoped name round-trips through the purl', () => {
    assert.equal(npmPurl('@scope/tool', '1.0.0'), 'pkg:npm/%40scope/tool@1.0.0');
  });
});

// ── macOS ──────────────────────────────────────────────────────────────────────────────────────
const FULL_INSTALLERS = `Finding available software
Software Update found the following full installers:
* Title: macOS Example Beta, Version: 27.2, Size: 18112298KiB, Build: 99B0001a, Deferred: NO
* Title: macOS Example, Version: 27.0, Size: 17969056KiB, Build: 99A0002, Deferred: NO
* Title: macOS Sample, Version: 26.7, Size: 17951133KiB, Build: 98G0003, Deferred: NO
* Title: macOS Sample, Version: 26.6, Size: 17942836KiB, Build: 98G0004, Deferred: NO
`;
const UPDATE_LIST = `Software Update Tool

Finding available software
Software Update found the following new or updated software:
* Label: macOS 27.2 Beta-99B0001a
\tTitle: macOS 27.2 Beta, Version: 27.2, Size: 18087936KiB, Recommended: YES, Action: restart,
`;
const PREFS_BETA = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>AutomaticDownload</key><true/>
  <key>CatalogURL</key><string>https://example.invalid/content/catalogs/others/index-27seed-27-26.merged-1.sucatalog.gz</string>
  <key>FirstOfferDateDictionary</key>
  <dict>
    <key>MSU_UPDATE_98G0009_patch_26.5.2_minor</key><date>2099-07-20T06:02:04Z</date>
    <key>MSU_UPDATE_99B0001a_full_27.2_major</key><date>2099-09-17T00:59:31Z</date>
  </dict>
  <key>PrimaryLanguages</key><array><string>en-AU</string></array>
  <key>LastResultCode</key><integer>2</integer>
</dict>
</plist>
`;

describe('the macOS lane', () => {
  test('softwareupdate rows parse, and an unparseable answer is UNKNOWN rather than clean', () => {
    assert.equal(parseFullInstallers(FULL_INSTALLERS).rows.length, 4);
    assert.deepEqual(parseFullInstallers(FULL_INSTALLERS).rows[0], { source: 'full-installer', title: 'macOS Example Beta', version: '27.2', build: '99B0001a', deferred: false, beta: true });
    assert.equal(parseUpdateList(UPDATE_LIST).rows[0].version, '27.2');
    assert.equal(parseUpdateList('No new software available.').rows.length, 0, 'the sentence is the only positive evidence of clean');
    assert.equal(parseUpdateList('Software Update Tool\n\nsomething went sideways\n').unknownReason, 'unparseable');
    assert.equal(parseFullInstallers('garbage').unknownReason, 'unparseable');
  });

  test('the plist reader answers, and a broken plist is a void rather than an empty preference file', () => {
    const p = parsePlistXml(PREFS_BETA);
    assert.match(p.plist.CatalogURL, /27seed/);
    assert.equal(Object.keys(p.plist.FirstOfferDateDictionary).length, 2);
    assert.deepEqual(p.plist.PrimaryLanguages, ['en-AU']);
    assert.equal(p.plist.LastResultCode, 2);
    assert.equal(p.plist.AutomaticDownload, true);
    assert.equal(parsePlistXml('<plist><dict><string>no key here</string></dict></plist>').unknownReason, 'unparseable');
  });

  test('a beta seed catalogue is detected and named, and a missing prefs file is UNKNOWN not "default"', () => {
    const f = join(scratch(), 'prefs.plist');
    writeFileSync(f, PREFS_BETA);
    const r = withEnv({ CW_SW_PREFS: f }, () => softwareUpdatePrefs({ run: runner() }));
    assert.equal(r.seed.state, 'beta-seed');
    assert.equal(r.offers.length, 2);
    assert.deepEqual(parseOfferId('MSU_UPDATE_98G0009_patch_26.5.2_minor'), { build: '98G0009', kind: 'minor', version: '26.5.2' });
    const missing = withEnv({ CW_SW_PREFS: join(scratch(), 'gone.plist') }, () => softwareUpdatePrefs({ run: runner() }));
    assert.equal(missing.unknownReason, 'absent');
  });

  test('targets are the newest per line, beta and release kept apart, and nothing is dropped silently', () => {
    const rows = [...parseFullInstallers(FULL_INSTALLERS).rows, ...parseUpdateList(UPDATE_LIST).rows];
    const { targets, superseded } = selectOsTargets('26.4', rows);
    assert.deepEqual(targets.map((t) => t.version), ['26.7', '27.0', '27.2']);
    assert.ok(superseded.some((s) => s.version === '26.6' && /superseded by 26.7/.test(s.why)));
    assert.equal(targets.find((t) => t.version === '27.2').beta, true);
    const { targets: none } = selectOsTargets('27.9', rows);
    assert.equal(none.length, 0, 'nothing older than what is installed is an update');
  });

  test('every target carries its fixed set, the sets are CPE-tier undetermined, and a fixless row is counted', () => {
    const list = join(scratch(), 'list.txt'); writeFileSync(list, UPDATE_LIST);
    const full = join(scratch(), 'full.txt'); writeFileSync(full, FULL_INSTALLERS);
    const prefs = join(scratch(), 'prefs.plist'); writeFileSync(prefs, PREFS_BETA);
    const r = withEnv({ CW_SOFTWAREUPDATE_LIST: list, CW_SW_FULL_INSTALLERS: full, CW_SW_PREFS: prefs, CW_OS_VERSION: '26.4', CW_OS_BUILD: '98E0001' },
      () => macosLane({ run: runner(), dbOk: true, kevSet: null, epss: null }));
    assert.equal(r.installed.version, '26.4');
    assert.equal(r.seed.state, 'beta-seed');
    assert.equal(r.rows.length, 3);
    const to267 = r.rows.find((x) => x.key === 'macos:26.7');
    assert.deepEqual(to267.fixedByUpdate.rows.map((x) => x.id).sort(), ['CVE-2099-1001', 'CVE-2099-1002']);
    assert.equal(to267.fixedByUpdate.rows[0].publish, 'undetermined', 'CPE is inference tier — the SET is reported, the severity is not published');
    assert.ok(to267.fixedByUpdate.rows[0].originalClaim, 'the claim it was made under is preserved rather than erased');
    assert.equal(to267.remainingAfter.noFixRecorded, 1, 'a row with no fix recorded anywhere is counted, never dropped');
    assert.match(to267.identity.note, /inference tier/);
    assert.equal(r.applyable, false, 'an OS update can force a reboot; there is no apply path here');
    // Offered, newer than what is running, therefore not installed. The beta seed's signature is
    // the FIRST of these: an update Apple stopped listing while a full installer for it still
    // exists — which is a different sentence from "there is nothing to install".
    assert.deepEqual(r.offeredNotInstalled.map((o) => o.version), ['26.5.2', '27.2']);
    const dropped = r.offeredNotInstalled.find((o) => o.version === '26.5.2');
    assert.equal(dropped.stillOffered.updateList, false, 'the minor update is no longer offered while the seed catalogue stands');
    assert.equal(dropped.stillOffered.fullInstaller, false);
    assert.equal(r.offeredNotInstalled.find((o) => o.version === '27.2').stillOffered.updateList, true);
    assert.equal(r.counts.noLongerOffered, 1);
  });

  test('an unreadable softwareupdate leaves the lane unknown rather than up to date', () => {
    const r = withEnv({ CW_SOFTWAREUPDATE_LIST: join(scratch(), 'x.txt'), CW_SW_FULL_INSTALLERS: join(scratch(), 'y.txt'), CW_OS_VERSION: '26.4' },
      () => macosLane({ run: runner(), dbOk: true, kevSet: null, epss: null }));
    assert.equal(r.state, 'unknown');
    assert.equal(r.sources.list.state, 'unknown');
    assert.equal(r.rows.length, 0);
  });

  test('the CPE is the identity the box actually has', () => {
    assert.equal(macosCpe('26.4'), 'cpe:2.3:o:apple:macos:26.4:*:*:*:*:*:*:*');
  });
});

// ── the DB gate and the whole payload ──────────────────────────────────────────────────────────
describe('the reference DB bounds everything below it', () => {
  test('an invalid DB is unknown for the vulnerability half, while the update LIST still reports', () => {
    const list = join(scratch(), 'list.txt'); writeFileSync(list, UPDATE_LIST);
    const full = join(scratch(), 'full.txt'); writeFileSync(full, FULL_INSTALLERS);
    const outdated = join(scratch(), 'brew.json');
    writeFileSync(outdated, JSON.stringify({ formulae: [{ name: 'samplelib', installed_versions: ['1.2.3'], current_version: '2.0.0' }], casks: [] }));
    const r = withEnv({
      CW_SOFTWAREUPDATE_LIST: list, CW_SW_FULL_INSTALLERS: full, CW_OS_VERSION: '26.4',
      CW_BREW_OUTDATED_JSON: outdated, CW_NPM_OUTDATED_JSON: join(scratch(), 'none.json'),
      CW_UPDATES_CACHE: scratch(), CW_NOW: '2099-01-02T03:04:05Z',
    }, () => runUpdates({ run: runner({ dbValid: false }) }));
    assert.equal(r.state, 'unknown');
    assert.equal(r.grypeDb.state, 'unknown');
    assert.equal(r.grypeDb.unknownReason, 'no-reference');
    const brew = r.managers.find((m) => m.manager === 'brew');
    assert.equal(brew.rows.length, 1, 'what can be applied needs no vulnerability database');
    assert.equal(brew.rows[0].fixedByUpdate.state, 'unknown');
    assert.equal(brew.rows[0].fixedByUpdate.unknownReason, 'no-reference');
    assert.notEqual(brew.rows[0].fixedByUpdate.count, undefined);
    assert.equal(r.counts.fixing, 0);
    assert.equal(r.counts.unknown, r.counts.updates, 'every row is unknown, and none of them says "fixes nothing"');
  });

  test('the DB metadata travels with the answer', () => {
    const d = grypeDbState({ run: runner() });
    assert.equal(d.state, 'valid');
    assert.equal(d.built, '2099-01-01T00:00:00Z');
    assert.equal(d.schema, 'v6.1.9');
  });
});

describe('the payload', () => {
  const build = (extra = {}) => {
    const prefix = scratch();
    keg(prefix, { name: 'samplelib', version: '1.2.3', artifacts: [artifact('samplelib', '1.2.3'), artifact('embeddedlib', '0.1.0')] });
    const brewJson = join(scratch(), 'brew.json');
    writeFileSync(brewJson, JSON.stringify({ formulae: [{ name: 'samplelib', installed_versions: ['1.2.3'], current_version: '2.0.0' }], casks: [] }));
    const list = join(scratch(), 'list.txt'); writeFileSync(list, UPDATE_LIST);
    const full = join(scratch(), 'full.txt'); writeFileSync(full, FULL_INSTALLERS);
    const prefsF = join(scratch(), 'prefs.plist'); writeFileSync(prefsF, PREFS_BETA);
    const npmJson = join(scratch(), 'npm.json'); writeFileSync(npmJson, JSON.stringify({}));
    return {
      CW_BREW_PREFIX: prefix, CW_BREW_OUTDATED_JSON: brewJson, CW_NPM_OUTDATED_JSON: npmJson,
      CW_SOFTWAREUPDATE_LIST: list, CW_SW_FULL_INSTALLERS: full, CW_SW_PREFS: prefsF,
      CW_OS_VERSION: '26.4', CW_OS_BUILD: '98E0001', CW_UPDATES_CACHE: scratch(),
      // Absent by default: the repo default monitor/data/kev.json exists once anybody has fetched
      // the catalogue, and the unchecked case then read this machine's list.
      CW_APPVULN_KEV: join(scratch(), 'no-kev.json'), CW_APPVULN_EPSS: join(scratch(), 'no-epss.json'),
      CW_NOW: '2099-01-02T03:04:05Z', ...extra,
    };
  };

  test('same inputs, byte-identical output — and CW_NOW is honoured', () => {
    const e = build();
    const a = withEnv(e, () => runUpdates({ run: runner() }));
    const b = withEnv(e, () => runUpdates({ run: runner() }));
    assert.equal(a.at, '2099-01-02T03:04:05.000Z');
    assert.equal(JSON.stringify(a), JSON.stringify(b));
  });

  test('the env is read at CALL time — the output path is whatever it says when the write happens', () => {
    const out = join(scratch(), 'nested', 'updates.json');
    const e = build({ CW_UPDATES_OUT: out });
    withEnv(e, () => {
      assert.equal(outPath(), out);
      const p = writeUpdates(runUpdates({ run: runner() }));
      assert.equal(p, out);
    });
    const doc = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(doc.generator, 'monitor/update-vulns.mjs');
    assert.ok(doc.managers.length >= 2);
  });

  test('KEV sorts first, and an unchecked KEV list is null rather than false', () => {
    const e = build();
    const plain = withEnv(e, () => runUpdates({ run: runner() }));
    assert.equal(plain.kevChecked, false, 'no KEV list here — unchecked, which is not "not on the list"');
    const brewRow = plain.managers.find((m) => m.manager === 'brew').rows[0];
    assert.equal(brewRow.fixedByUpdate.rows[0].kev, null);

    const kev = join(scratch(), 'kev.json');
    writeFileSync(kev, JSON.stringify({ vulnerabilities: [{ cveID: 'CVE-2099-0001' }] }));
    const withKev = withEnv({ ...e, CW_APPVULN_KEV: kev }, () => runUpdates({ run: runner() }));
    assert.equal(withKev.kevChecked, true);
    assert.deepEqual(withKev.kev, ['CVE-2099-0001']);
    assert.equal(withKev.managers.find((m) => m.manager === 'brew').rows[0].fixedByUpdate.rows[0].kev, true);
  });

  test('rowOrder puts KEV first, then the weight of what the update fixes', () => {
    const row = (key, kev, crit) => ({ key, fixedByUpdate: { kev, published: { Critical: crit }, undetermined: 0 }, vulnerableNow: { kev: [] } });
    const sorted = [row('c', [], 0), row('a', ['CVE-1'], 0), row('b', [], 5)].sort(rowOrder);
    assert.deepEqual(sorted.map((r) => r.key), ['a', 'b', 'c']);
  });

  test('--only narrows the managers and nothing else', () => {
    const e = build();
    const r = withEnv(e, () => runUpdates({ run: runner(), only: 'macos' }));
    assert.deepEqual(r.managers.map((m) => m.manager), ['macos']);
  });
});
