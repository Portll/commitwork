// node --test cra/test/  — fixture-driven suite for the CRA module + runner hardening.
// No network, no external tools; everything runs against cra/test/fixtures in a tmp dir.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, cpSync, utimesSync, statSync, chmodSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { registryPathFor, craProductsPathFor } from '../../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');          // the commitwork checkout under test
const FIX = join(HERE, 'fixtures');
const NOW = '2026-07-20T00:00:00.000Z';

let T; // scratch root for this run
before(() => { T = mkdtempSync(join(tmpdir(), 'cra-test-')); });

function craEnv(extra = {}) {
  return {
    ...process.env,
    CW_CRA_ROOT: T,                       // keep every default path away from the checkout
    CW_ROLLUP: join(FIX, 'rollup.json'),
    CW_KEV: join(FIX, 'kev.json'),
    CW_EPSS: join(FIX, 'epss.json'),
    CW_PRODUCTS: join(FIX, 'products.json'),
    CW_LEDGER: join(FIX, 'ledger.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'),
    CW_CASES: join(T, 'cases.json'),
    CW_CRA_OUT: join(T, 'out'),
    CW_CRA_NOW: NOW,
    CW_ESCALATE: '0', // watch tests assert clock exit codes; the pager is covered by escalate.test.mjs
    ...extra,
  };
}

function runWatch(args = ['watch'], env = {}) {
  return spawnSync('node', [join(REPO, 'cra', 'watch.mjs'), ...args], { env: craEnv(env), encoding: 'utf8' });
}

// ── watch: case opening, scoping, clocks ─────────────────────────────────────

test('watch opens cases on EVERY product; locale decides the track, never whether the clock runs', () => {
  const r = runWatch();
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const doc = JSON.parse(readFileSync(join(T, 'cases.json'), 'utf8'));
  const ids = Object.keys(doc.cases).sort();
  // repo-a (EU product): CVE-2026-11111 via KEV, CVE-2026-22222 via EPSS 0.91.
  // CVE-2026-33333 (epss null) must NOT trigger (unknown ≠ 0, and below warn anyway).
  // repo-b's KEV CVE-2026-44444 is a NON-EU product: it opens a case too, on the bestpractice
  // track — the Art. 14 timeline is followed as discipline where no advisory body is delegated.
  // repo-c is unmapped to any product → advisory, still no case.
  assert.deepEqual(ids, ['prod-eu--cve-2026-11111', 'prod-eu--cve-2026-22222',
    'prod-eu--cve-2026-88888', 'prod-noneu--cve-2026-44444']);
  // CVE-2026-88888 is cvss 9.5 with kev:false and epss 0.01 — critical, NOT known-exploited.
  // It opens on the INTERNAL track: our own policy clock, never an Art. 14 obligation.
  assert.equal(doc.cases['prod-eu--cve-2026-88888'].clocks.track, 'internal');
  assert.equal(doc.cases['prod-eu--cve-2026-88888'].trigger, 'crit');
  assert.equal(doc.cases['prod-eu--cve-2026-88888'].clocks.earlyWarningDue, undefined,
    'an internal case must not carry an Art. 14 clock key at all');
  const k = doc.cases['prod-eu--cve-2026-11111'];
  assert.equal(k.trigger, 'kev');
  assert.equal(k.firstDetectedAt, NOW);
  assert.equal(k.clocks.track, 'article14');
  assert.deepEqual(k.reporting.bodies.length > 0, true);
  assert.equal(k.clocks.earlyWarningDue, '2026-07-21T00:00:00.000Z');
  assert.equal(k.clocks.notificationDue, '2026-07-23T00:00:00.000Z');
  assert.equal(k.clocks.finalDue, '2026-08-03T00:00:00.000Z');
  assert.equal(doc.cases['prod-eu--cve-2026-22222'].trigger, 'epss');

  // The non-EU case runs the SAME clocks on the bestpractice track and names the gap.
  const nb = doc.cases['prod-noneu--cve-2026-44444'];
  assert.equal(nb.clocks.track, 'bestpractice');
  assert.deepEqual(nb.reporting.bodies, [], 'no body may be invented for an undeclared locale');
  assert.equal(nb.clocks.earlyWarningDue, '2026-07-21T00:00:00.000Z', 'same 24h clock as the regulatory track');
  assert.match(nb.clocks.regime, /BEST PRACTICE/);
  assert.match(nb.clocks.regime, /nothing is filed/i);

  assert.match(r.stdout, /NO ADVISORY BODY DELEGATED/);
  assert.match(r.stdout, /not mapped to any product/);
});

test('watch is idempotent: second run appends no events and is byte-identical', () => {
  const before1 = readFileSync(join(T, 'cases.json'), 'utf8');
  const r = runWatch();
  assert.equal(r.status, 0, r.stderr);
  const after = readFileSync(join(T, 'cases.json'), 'utf8');
  assert.equal(after, before1);
  const doc = JSON.parse(after);
  // DERIVED, not pinned: one case-opened per case and nothing else. A hard-coded count here went
  // stale the moment the track split opened a third case, and a stale count fails for a reason
  // that has nothing to do with idempotency — which is what this test is actually for.
  const opened = doc.events.filter((e) => e.type === 'case-opened');
  assert.equal(opened.length, Object.keys(doc.cases).length);
  assert.equal(doc.events.length, opened.length, 'a second run must append NO further events');
});

test('hash chain verifies, and a tampered event is detected', () => {
  assert.equal(runWatch(['verify']).status, 0);
  const p = join(T, 'cases.json');
  const doc = JSON.parse(readFileSync(p, 'utf8'));
  const copy = structuredClone(doc);
  copy.events[0].data.vulnId = 'CVE-1999-0000';
  writeFileSync(p, JSON.stringify(copy, null, 2));
  const r = runWatch(['verify']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /chain broken/);
  writeFileSync(p, JSON.stringify(doc, null, 2) + '\n'); // restore
  assert.equal(runWatch(['verify']).status, 0);
});

test('drafts contain manufacturer, product, clocks, and the DRAFT banner', () => {
  const dir = join(T, 'out', 'cases', 'prod-eu--cve-2026-11111');
  const ew = readFileSync(join(dir, 'early-warning.md'), 'utf8');
  assert.match(ew, /DRAFT — NOT SUBMITTED/);
  assert.match(ew, /Portll Test GmbH/);
  assert.match(ew, /Product EU 1\.4\.0/);
  assert.match(ew, /CVE-2026-11111/);
  assert.match(ew, /2026-07-21T00:00:00\.000Z/);
  const fin = readFileSync(join(dir, 'final-report.md'), 'utf8');
  assert.match(fin, /no verified fix in the remediation ledger yet/); // weak evidence excluded
  const no = JSON.parse(readFileSync(join(dir, 'notification.json'), 'utf8'));
  assert.equal(no.draft, true);
  assert.equal(no.product.id, 'prod-eu');
});

test('ack re-bases clocks to acknowledged awareness', () => {
  const r = runWatch(['ack', 'prod-eu--cve-2026-11111', '--at', '2026-07-20T05:00:00.000Z']);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(readFileSync(join(T, 'cases.json'), 'utf8'));
  const k = doc.cases['prod-eu--cve-2026-11111'];
  assert.equal(k.status, 'acknowledged');
  assert.equal(k.clocks.earlyWarningDue, '2026-07-21T05:00:00.000Z');
  assert.match(k.clocks.basis, /acknowledged awareness/);
  assert.equal(runWatch(['verify']).status, 0); // chain still intact after mutation
});

test('measure re-bases the final-report clock to measure time + 14d', () => {
  const r = runWatch(['measure', 'prod-eu--cve-2026-11111', '--detail', 'hotfix 1.4.1 released', '--at', '2026-07-21T00:00:00.000Z']);
  assert.equal(r.status, 0, r.stderr);
  const doc = JSON.parse(readFileSync(join(T, 'cases.json'), 'utf8'));
  const k = doc.cases['prod-eu--cve-2026-11111'];
  assert.equal(k.clocks.finalDue, '2026-08-04T00:00:00.000Z');
  assert.match(k.clocks.finalBasis, /corrective measure available/);
});

test('overdue clocks exit 3', () => {
  const r = runWatch(['watch'], { CW_CRA_NOW: '2026-07-23T12:00:00.000Z' }); // past both 24h clocks
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.match(r.stdout + r.stderr, /OVERDUE/);
});

test('watch wires the pager (W3): an overdue clock with no resolvable CRA_WEBHOOK_URL escalates the exit to 5', () => {
  // Same overdue setup, but escalation ON and no reachable pager → the deadline can page no one,
  // which is louder than "overdue" (3): cra/escalate.mjs raises the watch exit to 5.
  const r = runWatch(['watch'], { CW_CRA_NOW: '2026-07-23T12:00:00.000Z', CW_ESCALATE: '1', CRA_WEBHOOK_URL: '' });
  assert.equal(r.status, 5, r.stdout + r.stderr);
});

// ── severe-incident cases (Art. 14 second trigger) ──────────────────────────

test('incident: declared case gets Art.14 clocks with the 1-month final rule; submit re-bases it', () => {
  const env = { CW_CASES: join(T, 'inc-cases.json'), CW_CRA_OUT: join(T, 'inc-out') };
  const dec = runWatch(['incident', '--product', 'prod-eu', '--title', 'Data exfil via gateway', '--summary', 'auth bypass'], env);
  assert.equal(dec.status, 0, dec.stderr);
  const doc = JSON.parse(readFileSync(join(T, 'inc-cases.json'), 'utf8'));
  const id = Object.keys(doc.cases)[0];
  const k = doc.cases[id];
  assert.equal(k.kind, 'incident');
  assert.equal(k.vulnId, null);
  assert.equal(k.clocks.earlyWarningDue, '2026-07-21T00:00:00.000Z');
  assert.equal(k.clocks.notificationDue, '2026-07-23T00:00:00.000Z');
  assert.equal(k.clocks.finalDue, '2026-08-23T00:00:00.000Z'); // notification due + 1 calendar month
  // drafts render incident framing, never a literal "null" from a missing vulnId
  const ew = readFileSync(join(T, 'inc-out', 'cases', id, 'early-warning.md'), 'utf8');
  assert.match(ew, /severe incident/);
  assert.match(ew, /Data exfil via gateway/);
  assert.ok(!/\bnull\b/.test(ew), 'incident draft must not leak a null vulnId');
  const fin = readFileSync(join(T, 'inc-out', 'cases', id, 'final-report.md'), 'utf8');
  assert.match(fin, /one month after notification/);
  // submit notification → final clock re-bases to submission + 1 month
  const sub = runWatch(['submit', id, '--stage', 'notification', '--at', '2026-07-22T09:00:00.000Z'], env);
  assert.equal(sub.status, 0, sub.stderr);
  const k2 = JSON.parse(readFileSync(join(T, 'inc-cases.json'), 'utf8')).cases[id];
  assert.equal(k2.clocks.finalDue, '2026-08-22T09:00:00.000Z');
  assert.equal(runWatch(['verify'], env).status, 0); // chain still intact
});

// ── stale-evidence guard ─────────────────────────────────────────────────────

test('stale evidence is flagged loudly and exits 4 (fresh evidence does not)', () => {
  // fixture rollup.generated = 2026-07-19T17:00Z; at default NOW (07-20) it is ~7h old = fresh
  const fresh = runWatch(['list'], { CW_CASES: join(T, 'fresh-cases.json') });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /fresh/);
  // five days later the same slice is ~127h old (> 26h) = stale ⇒ exit 4, no open cases to make it overdue
  const stale = runWatch(['list'], { CW_CASES: join(T, 'stale-cases.json'), CW_CRA_NOW: '2026-07-25T00:00:00.000Z' });
  assert.equal(stale.status, 4, stale.stdout + stale.stderr);
  assert.match(stale.stdout, /STALE EVIDENCE/);
});

// ── vex mapping (direct import) ──────────────────────────────────────────────

test('vex maps lifecycle → analysis states; weak ledger evidence never claims resolved', async () => {
  const { buildVex } = await import(pathToFileURL(join(REPO, 'cra', 'vex.mjs')).href);
  const products = JSON.parse(readFileSync(join(FIX, 'products.json'), 'utf8'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const doc = buildVex(products.products[0], products.manufacturer, rollup, ledger.entries, anns, NOW);
  const byId = Object.fromEntries(doc.vulnerabilities.map((v) => [v.id, v.analysis.state]));
  assert.equal(byId['CVE-2026-11111'], 'exploitable');
  assert.equal(byId['CVE-2026-22222'], 'exploitable');
  assert.equal(byId['CVE-2026-33333'], 'false_positive');   // annotation applied as-of NOW
  assert.equal(byId['CVE-2026-55555'], 'resolved');          // strong ledger evidence
  assert.equal(byId['CVE-2026-66666'], undefined);           // weak evidence: excluded entirely
  assert.equal(byId['CVE-2026-44444'], undefined);           // other product's repo
  assert.match(doc.serialNumber, /^urn:uuid:[0-9a-f-]{36}$/);
  // determinism: same inputs, same serial
  const doc2 = buildVex(products.products[0], products.manufacturer, rollup, ledger.entries, anns, NOW);
  assert.equal(doc.serialNumber, doc2.serialNumber);
});

// ── sbom merge (direct import) ───────────────────────────────────────────────

test('sbom merge dedupes by purl, tags repos, drops vendored reference/ components', async () => {
  const { mergeProductSbom } = await import(pathToFileURL(join(REPO, 'cra', 'sbom.mjs')).href);
  const mk = (name, version, path) => ({
    name, version, type: 'library', purl: `pkg:npm/${name}@${version}`,
    properties: [{ name: 'syft:location:0:path', value: path }],
  });
  const repoSboms = [
    { repo: 'repo-a', doc: { components: [mk('shared', '1.0.0', 'package-lock.json'), mk('vendored', '0.1.0', 'reference/internal-b-dev/package.json')] } },
    { repo: 'repo-b', doc: { components: [mk('shared', '1.0.0', 'package-lock.json'), mk('only-b', '2.0.0', 'yarn.lock')] } },
  ];
  const product = { id: 'p', name: 'P', version: '1.0', repos: ['repo-a', 'repo-b'] };
  const { doc, dropped } = mergeProductSbom(product, { name: 'M' }, repoSboms, NOW);
  assert.equal(dropped, 1);
  assert.equal(doc.components.length, 2);
  const shared = doc.components.find((c) => c.name === 'shared');
  const repos = shared.properties.filter((p) => p.name === 'commitwork:repo').map((p) => p.value).sort();
  assert.deepEqual(repos, ['repo-a', 'repo-b']);
  assert.ok(!doc.components.some((c) => c.name === 'vendored'));
});

// ── pack crosswalk (direct import) ───────────────────────────────────────────

test('pack emits the full Annex I Part II crosswalk and honest [HUMAN] flags', async () => {
  const { buildPack } = await import(pathToFileURL(join(REPO, 'cra', 'pack.mjs')).href);
  const products = JSON.parse(readFileSync(join(FIX, 'products.json'), 'utf8'));
  const baseline = JSON.parse(readFileSync(join(REPO, 'manifests', 'security-baseline.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const files = buildPack(products.products[0], products.manufacturer, baseline, ledger.entries,
    { out: join(T, 'out'), ledger: join(FIX, 'ledger.json') }, NOW);
  assert.deepEqual(Object.keys(files).sort(),
    ['advisories.md', 'cvd-policy.md', 'index.md', 'remediation-log.md', 'vulnerability-handling.md']);
  for (let i = 1; i <= 8; i++) assert.match(files['index.md'], new RegExp(`\\(${i}\\)`));
  assert.match(files['index.md'], /\[HUMAN\]/);
  assert.match(files['remediation-log.md'], /CVE-2026-55555.*strong/);
  assert.ok(!/CVE-2026-66666/.test(files['remediation-log.md'].split('Full ledger')[0])); // weak excluded from table
  assert.match(files['vulnerability-handling.md'], /explicit uncertainty/i);
});

// ── preflight validator ──────────────────────────────────────────────────────

test('validateProducts: advises on every placeholder manufacturer field, not just name and contact', async () => {
  // address, euRepresentative and csirtMemberState were unchecked, so three TODOs reached Annex I
  // Part II and the OSCAL output unremarked. csirtMemberState routes the Art. 14 notification.
  const { validateProducts } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const { advisories } = validateProducts({
    manufacturer: {
      name: 'Real GmbH',
      contact: 'psirt@real.test',
      address: 'TODO',
      euRepresentative: 'TODO if placing on the EU market from outside the EU',
      csirtMemberState: 'TODO',
    },
    products: [{ id: 'p', name: 'P', version: '1.0.0', repos: ['r'], market: { eu: true } }],
  });
  for (const field of ['address', 'euRepresentative', 'csirtMemberState']) {
    assert.ok(advisories.some((a) => a.startsWith(`manufacturer.${field}`)), `no advisory for ${field}`);
  }
});

test('validateProducts: euRepresentative/csirtMemberState are gated on market.eu, not on being non-empty', async () => {
  // A real placeholder-free answer ("N/A", a non-EU state) is CORRECT while nothing ships to the EU
  // and non-compliant the moment something does. PLACEHOLDER never sees it either way.
  const { validateProducts } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const man = { name: 'Commitwork', contact: 'dev@portll.test', address: 'Address Withheld',
    euRepresentative: 'N/A', csirtMemberState: 'Australia', establishedInEU: false };
  const prod = (eu) => [{ id: 'p', name: 'P', version: '1.0.0', repos: ['r'], market: { eu } }];

  const off = validateProducts({ manufacturer: man, products: prod(false) }).advisories;
  assert.equal(off.filter((a) => /euRepresentative|csirtMemberState/.test(a)).length, 0,
    'silent while euCount is 0 — "N/A" is the honest answer, not a defect');

  const on = validateProducts({ manufacturer: man, products: prod(true) }).advisories;
  assert.ok(on.some((a) => /euRepresentative.*Art\. 18/.test(a)), 'Art. 18 needs an EU representative');
  assert.ok(on.some((a) => /csirtMemberState.*not an EU member state/.test(a)), 'Art. 14 routing needs a member state');

  const ok = validateProducts({ manufacturer: { ...man, euRepresentative: 'Rep BV, Amsterdam', csirtMemberState: 'Netherlands' },
    products: prod(true) }).advisories;
  assert.equal(ok.filter((a) => /euRepresentative|csirtMemberState/.test(a)).length, 0,
    'a real representative and a real member state clear it');

  // Art. 18 binds only a manufacturer outside the EU. An EU-established one needs no representative,
  // and firing on it would be the check asserting a fact it cannot know.
  const eu = validateProducts({ manufacturer: { ...man, establishedInEU: true }, products: prod(true) }).advisories;
  assert.equal(eu.filter((a) => /euRepresentative/.test(a)).length, 0, 'an EU manufacturer needs no representative');
  const unknown = validateProducts({ manufacturer: { name: 'Real GmbH', contact: 'psirt@real.example' }, products: prod(true) }).advisories;
  assert.equal(unknown.filter((a) => /euRepresentative|csirtMemberState/.test(a)).length, 0,
    'establishment unstated is UNKNOWN, and unknown is not a violation');
});

test('validateProducts: blocks structural errors, advises on placeholder/seeded state', async () => {
  const { validateProducts } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  // hard errors
  const bad = validateProducts({ products: [{ id: 'X_bad', market: {} }] });
  assert.ok(bad.errors.some((e) => /manufacturer/.test(e)));
  assert.ok(bad.errors.some((e) => /id must match/.test(e)));
  assert.ok(bad.errors.some((e) => /market\.eu/.test(e)));
  // seeded placeholder state → advisories, not errors
  const seeded = validateProducts({
    manufacturer: { name: 'Portll (TODO)', contact: 'security@portll.example' },
    products: [{ id: 'p', name: 'P', version: '0.0.0-set-me', repos: ['r'], market: { eu: false } }],
  });
  assert.equal(seeded.errors.length, 0);
  assert.ok(seeded.advisories.some((a) => /market\.eu=true/.test(a)));
  assert.ok(seeded.advisories.some((a) => /placeholder/.test(a)));
  // An EU product with no support period and no CVD policy is NOT clean — both are CRA
  // obligations, and the validator was silent about them until schema-drift.test.mjs found that
  // five schema-declared fields were checked by nothing at all.
  const bare = validateProducts({
    manufacturer: { name: 'Real GmbH', contact: 'psirt@real.example' },
    products: [{ id: 'p', name: 'P', version: '1.0.0', repos: ['r'], market: { eu: true } }],
  });
  assert.deepEqual(bare.errors, []);
  assert.ok(bare.advisories.some((a) => /supportEndsAt/.test(a)), 'an undeclared CRA support period must be advised');
  assert.ok(bare.advisories.some((a) => /cvdPolicyUrl/.test(a)), 'Annex I Part II requires a CVD policy');

  // fully configured → clean
  const ok = validateProducts({
    manufacturer: { name: 'Real GmbH', contact: 'psirt@real.example' },
    products: [{
      id: 'p', name: 'P', version: '1.0.0', repos: ['r'], market: { eu: true },
      supportEndsAt: '2099-01-01', cvdPolicyUrl: 'https://real.example/security',
      advisoriesUrl: 'https://real.example/advisories', reporting: { locale: 'DE' },
    }],
  });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.advisories, []);
});

test('validateProducts: a lapsed support period and a misspelt locale are both caught', async () => {
  const { validateProducts } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const r = validateProducts({
    manufacturer: { name: 'Real GmbH', contact: 'psirt@real.example' },
    products: [{
      id: 'p', name: 'P', version: '1.0.0', repos: ['r'], market: { eu: true },
      supportEndsAt: '2020-01-01', cvdPolicyUrl: 'https://real.example/security', reporting: { locale: 'de' },
    }],
  });
  assert.ok(r.advisories.some((a) => /in the PAST/.test(a)), 'a lapsed support period is a live obligation gap');
  assert.ok(r.errors.some((e) => /reporting\.locale/.test(e)), "a lowercase locale resolves to 'unrecognised' and files nothing — block it at config time");
});

test('preflight: fixtures are ready, cross-check flags orphan repos, exit 0 with advisories', async () => {
  const { preflight } = await import(pathToFileURL(join(REPO, 'cra', 'preflight.mjs')).href);
  const paths = {
    products: join(FIX, 'products.json'), rollup: join(FIX, 'rollup.json'),
    kev: join(FIX, 'kev.json'), epss: join(FIX, 'epss.json'),
    reportsRoot: join(T, 'no-sweeps-here'),
  };
  // The fixture has an EU-market product, so R2's preflight gate needs a resolvable pager target.
  const savedHook = process.env.CRA_WEBHOOK_URL;
  process.env.CRA_WEBHOOK_URL = 'https://hooks.example/cra';
  const r = preflight(paths, NOW);
  if (savedHook === undefined) delete process.env.CRA_WEBHOOK_URL; else process.env.CRA_WEBHOOK_URL = savedHook;
  assert.equal(r.ready, true, JSON.stringify(r.errors));
  // repo-b (non-EU) and repo-c (unmapped) are scanned but not mapped to a product → orphan advisory
  assert.ok(r.advisories.some((a) => /mapped to no product/.test(a)));
  // fixture products.json has 1 EU product, so this is NOT the zero-EU advisory
  assert.ok(!r.advisories.some((a) => /ZERO Art\. 14 cases/.test(a)));
  assert.ok(r.info.some((i) => /EU-scoped triggers/.test(i)));
});

test('preflight: an EU-market product with no resolvable CRA_WEBHOOK_URL is a hard error (R2 unpageable clock)', async () => {
  const { preflight } = await import(pathToFileURL(join(REPO, 'cra', 'preflight.mjs')).href);
  const paths = {
    products: join(FIX, 'products.json'), rollup: join(FIX, 'rollup.json'),
    kev: join(FIX, 'kev.json'), epss: join(FIX, 'epss.json'), reportsRoot: join(T, 'no-sweeps-here'),
  };
  const savedHook = process.env.CRA_WEBHOOK_URL;
  delete process.env.CRA_WEBHOOK_URL; // fixture has an EU product; with no pager target the gate must fail closed
  let r;
  try { r = preflight(paths, NOW); } finally { if (savedHook !== undefined) process.env.CRA_WEBHOOK_URL = savedHook; }
  assert.equal(r.ready, false);
  assert.ok(r.errors.some((e) => /CRA_WEBHOOK_URL is not resolvable/.test(e)), JSON.stringify(r.errors));
});

test('preflight: stale rollup is a hard error (not ready)', async () => {
  const { preflight } = await import(pathToFileURL(join(REPO, 'cra', 'preflight.mjs')).href);
  const paths = {
    products: join(FIX, 'products.json'), rollup: join(FIX, 'rollup.json'),
    kev: join(FIX, 'kev.json'), epss: join(FIX, 'epss.json'), reportsRoot: T,
  };
  const r = preflight(paths, '2026-08-01T00:00:00.000Z'); // ~13 days after the fixture slice
  assert.equal(r.ready, false);
  assert.ok(r.errors.some((e) => /stale/.test(e)));
});

// ── control coverage ─────────────────────────────────────────────────────────

test('coverage: evidenced only when a mapping check provably ran; explicit uncertainty for un-run controls', async () => {
  const { coverageFor, loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const product = { id: 'prod-eu', name: 'Product EU', version: '1.4.0', repos: ['repo-a'] };
  const cov = coverageFor(product, controls, rollup, ledger.entries, anns);
  const nist = Object.fromEntries(cov.frameworks.nist80053.rows.map((r) => [r.control, r]));
  // repo-a fixture ran: secrets, sastSemgrep, supplyChain, maliciousPackages (NOT iac, NOT depsJvm)
  assert.equal(nist['RA-5'].status, 'evidenced');   // deps-osv (maliciousPackages) / npm-audit (supplyChain) ran
  // SI-3 (malicious code protection) is evidenced by deps-osv's MAL- lane, NOT by supply-chain-socket:
  // a category is proven by the check that WRITES the artifact it reads (osv.sarif ← deps-osv), so
  // OSV no longer inherits its run provenance from socket.json — including socket.json's {ok:false} husk.
  assert.equal(nist['SI-3'].status, 'evidenced');
  assert.ok(nist['SI-3'].evidencingChecks.includes('deps-osv'));
  assert.equal(nist['IA-5'].status, 'evidenced');   // secrets ran
  assert.equal(nist['SA-11'].status, 'evidenced');  // sast (sastSemgrep) ran
  assert.equal(nist['CM-6'].status, 'mapped');      // iac did NOT run → explicit uncertainty
  assert.equal(nist['AC-3'].status, 'mapped');      // authz has no run signal
  assert.equal(nist['SI-2'].status, 'evidenced');   // remediation-ledger source (repo-a strong entry)
  assert.equal(nist['CA-5'].status, 'evidenced');   // annotations source (repo-a fp annotation)
  // evidenced controls name the checks/sources that prove them
  assert.ok(nist['RA-5'].evidencingChecks.includes('deps-osv'));
  assert.ok(nist['RA-5'].repos.includes('repo-a'));
  // framework tallies are internally consistent
  for (const fw of ['cra', 'soc2', 'nist80053']) {
    const f = cov.frameworks[fw];
    assert.equal(f.evidenced, f.rows.filter((r) => r.status === 'evidenced').length);
    assert.ok(f.total >= f.evidenced);
  }
});

test('coverage: a DEGRADED artifact evidences nothing — ran:true alone is not proof', async () => {
  // The rollup's extractors set ran:true whenever an artifact exists at the expected path, then
  // qualify it: `unparseable` (corrupt) or `nosrc` (empty, or the scanner's own artifact says it did
  // not run — Socket's {ok:false} husk, a cspm self-gate, a schemathesis run whose spec never
  // loaded). Crediting those was evidencing a control from a file nobody could read; measured on the
  // real fleet, 15 per-repo entries did exactly that.
  //
  // The runner already agreed it was not a scan: every empty SARIF on disk carries
  // `noscan (ran — no source matched)` in checks-status, never `pass`. This pins the rollup to the
  // same answer.
  const { coverageFor, loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const base = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const product = { id: 'prod-eu', name: 'Product EU', version: '1.4.0', repos: ['repo-a'] };

  // Degrade the two categories that evidence RA-5 / SI-3, leaving everything else untouched.
  const degraded = JSON.parse(JSON.stringify(base));
  const repoA = degraded.repos.find((r) => r.name === 'repo-a');
  repoA.scanners.maliciousPackages = { ran: true, total: 0, unparseable: true };
  repoA.scanners.supplyChain = { ran: true, total: 0, nosrc: true };

  const rows = (r) => Object.fromEntries(
    coverageFor(product, controls, r, ledger.entries, anns).frameworks.nist80053.rows.map((x) => [x.control, x]));
  const before = rows(base), after = rows(degraded);

  // 1. THE CHECK-BASED CLAIM IS WITHDRAWN. Both controls stop naming the degraded checks as proof.
  assert.deepEqual(before['SI-3'].evidencingChecks, ['deps-osv', 'supply-chain-socket']);
  assert.deepEqual(after['SI-3'].evidencingChecks, [], 'a degraded artifact may not be named as proof');
  assert.deepEqual(after['RA-5'].evidencingChecks, [], 'nor for a control with several degraded mappings');

  // 2. A CONTROL EVIDENCED ONLY BY THOSE CHECKS GOES GREY. This is the whole point: SI-3 rested on
  // deps-osv and supply-chain-socket alone, so with both unreadable it has nothing left.
  assert.equal(before['SI-3'].status, 'evidenced');
  assert.equal(after['SI-3'].status, 'mapped', 'malicious-code protection is explicit uncertainty, when nothing readable proves it');

  // 3. SOURCE-BASED EVIDENCE IS UNTOUCHED. RA-5 keeps `evidenced` via the remediation ledger,
  // annotations and KEV/EPSS — those are independent of any scanner artifact, so withdrawing the
  // check claim must not withdraw theirs. The gate narrows what counts as proof; it does not
  // invalidate other proof.
  assert.equal(after['RA-5'].status, 'evidenced');
  assert.ok(after['RA-5'].evidencingSources.includes('remediation-ledger'));

  // 4. TARGETED, NOT BLANKET. Categories that read cleanly still evidence exactly as before.
  assert.equal(after['IA-5'].status, 'evidenced', 'secrets still read cleanly and still evidences');
  assert.deepEqual(after['SA-11'].evidencingChecks, before['SA-11'].evidencingChecks);
});

test('coverage: a ZERO-RULES run evidences nothing — vacuous is not proof (BACKLOG P, CRA half)', async () => {
  // norules is the mirror of the degraded states above: the artifact is readable and the scan
  // executed — with zero rules loaded, so it could not have found anything by construction. A
  // scanner incapable of failing must not evidence a control any more than one nobody could read;
  // semgrep's --config-auto-without-metrics incident produced exactly this shape fleet-wide.
  const { coverageFor, loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const base = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const product = { id: 'prod-eu', name: 'Product EU', version: '1.4.0', repos: ['repo-a'] };

  const vacuous = JSON.parse(JSON.stringify(base));
  vacuous.repos.find((r) => r.name === 'repo-a').scanners.sastSemgrep = { ran: true, total: 0, norules: true };

  const rows = (r) => Object.fromEntries(
    coverageFor(product, controls, r, ledger.entries, anns).frameworks.nist80053.rows.map((x) => [x.control, x]));
  const before = rows(base), after = rows(vacuous);

  // SA-15 rests on sast ALONE in this fixture; SA-11 is also secrets-mapped, so it demonstrates
  // the narrower property — the vacuous check's CLAIM is withdrawn without disturbing other proof.
  assert.equal(before['SA-15'].status, 'evidenced', 'fixture control: sast alone evidences SA-15 when it really ran');
  assert.equal(after['SA-15'].status, 'mapped', 'a zero-rules SAST run is explicit uncertainty — nothing could have been found');
  assert.ok(before['SA-11'].evidencingChecks.includes('sast'));
  assert.ok(!after['SA-11'].evidencingChecks.includes('sast'), 'the vacuous check may not be NAMED as proof anywhere');
  assert.equal(after['SA-11'].status, 'evidenced', 'withdrawal is per-check: secrets still proves SA-11');
  assert.equal(after['IA-5'].status, 'evidenced', 'targeted: secrets still evidences; the withdrawal is per-category');
});

test('coverage: runtime controls become evidenced when their scanner ran (checks-status), stay mapped when skipped', async () => {
  const { coverageFor, loadControls, ranChecksFromSweep } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const product = { id: 'p', name: 'P', version: '1', repos: ['repo-a'] };

  // fixture sweep: repo-a ran tls-headers + dast-authz-bola (pass), skipped authz-test + api-fuzz
  const ran = ranChecksFromSweep(join(FIX, 'sweep'), ['repo-a']);
  const withRun = coverageFor(product, controls, rollup, ledger.entries, anns, ran);
  const nist = Object.fromEntries(withRun.frameworks.nist80053.rows.map((r) => [r.control, r]));
  const soc2 = Object.fromEntries(withRun.frameworks.soc2.rows.map((r) => [r.control, r.status]));
  assert.equal(nist['SC-8'].status, 'evidenced');    // tls-headers ran → transport encryption
  assert.equal(nist['SC-13'].status, 'evidenced');
  assert.equal(nist['AC-3'].status, 'evidenced');    // dast-authz-bola ran → access enforcement
  assert.equal(soc2['CC6.7'], 'evidenced');
  assert.equal(soc2['CC6.3'], 'evidenced');
  assert.ok(nist['SC-8'].evidencingChecks.includes('tls-headers'));
  assert.ok(nist['SC-8'].repos.includes('repo-a'));

  // WITHOUT the run signal (the old behaviour) these are honestly still mapped
  const noRun = coverageFor(product, controls, rollup, ledger.entries, anns);
  const nist2 = Object.fromEntries(noRun.frameworks.nist80053.rows.map((r) => [r.control, r.status]));
  assert.equal(nist2['SC-8'], 'mapped');
  assert.equal(nist2['AC-3'], 'mapped');

  // a skipped runtime check is NOT evidence (repo-b only skipped tls-headers)
  const ranB = ranChecksFromSweep(join(FIX, 'sweep'), ['repo-b']);
  assert.ok(!ranB.has('repo-b'), 'a repo whose only checks were skipped yields no run evidence');
});

test('coverage: scope metadata (catalog denominator) + expanded monitoring/audit/kev-epss sources', async () => {
  const { coverageFor, loadControls, ranChecksFromSweep } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const ran = ranChecksFromSweep(join(FIX, 'sweep'), ['repo-a']);
  const cov = coverageFor({ id: 'p', name: 'P', version: '1', repos: ['repo-a'] }, controls, rollup, ledger.entries, anns, ran);
  // scope honesty: the framework catalogue denominator travels with the result so N/M ≠ framework %
  const nist = cov.frameworks.nist80053;
  assert.equal(nist.catalog, 1007);
  assert.equal(nist.baselineModerate, 323);
  assert.ok(nist.mapped >= 20 && nist.mapped < 50, 'maps a technical subset, not the catalogue');
  assert.match(nist.scope, /organizational/i);
  assert.equal(cov.frameworks.cra.catalog, 8);
  // expanded evidence sources evidence real controls
  const byId = Object.fromEntries(nist.rows.map((r) => [r.control, r]));
  assert.equal(byId['SI-4'].status, 'evidenced');   // monitoring-program: a slice covers the product
  assert.equal(byId['CA-7'].status, 'evidenced');
  assert.equal(byId['AU-12'].status, 'evidenced');  // audit-records: checks-status.json present
  assert.equal(byId['RA-3'].status, 'evidenced');   // kev-epss: enrichment on findings
  assert.ok(byId['SI-4'].evidencingSources.includes('monitoring-program'));
  assert.ok(byId['AU-12'].evidencingSources.includes('audit-records'));
});

test('oscal: valid component-definition — lowercase control-ids, implementation-status, deterministic uuid', async () => {
  const { buildOscal } = await import(pathToFileURL(join(REPO, 'cra', 'oscal.mjs')).href);
  const { coverageFor, loadControls, ranChecksFromSweep } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const anns = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const ran = ranChecksFromSweep(join(FIX, 'sweep'), ['repo-a']);
  const cov = coverageFor({ id: 'p', name: 'P', version: '1.0', repos: ['repo-a'] }, controls, rollup, ledger.entries, anns, ran);
  cov.slice = 'sweep-test';
  const doc = buildOscal(cov, controls, NOW);
  const cd = doc['component-definition'];
  assert.equal(cd.metadata['oscal-version'], '1.1.2');
  assert.match(cd.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/); // bare uuid, not urn:
  const reqs = cd.components[0]['control-implementations'][0]['implemented-requirements'];
  assert.ok(reqs.length >= 20);
  assert.ok(reqs.every((r) => r['control-id'] === r['control-id'].toLowerCase()), 'OSCAL control-ids are lowercase');
  assert.ok(reqs.every((r) => ['implemented', 'planned'].includes(r.props[0].value)));
  assert.equal(reqs.find((r) => r['control-id'] === 'ac-3').props[0].value, 'implemented'); // authz-test ran
  assert.match(cd.components[0]['control-implementations'][0].description, /of ~1007/); // denominator stated
  assert.equal(buildOscal(cov, controls, NOW)['component-definition'].uuid, cd.uuid); // deterministic
});

test('controls.json crosswalk is well-formed: every referenced control id exists in its framework', async () => {
  const { loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const ids = {
    cra: new Set(Object.keys(controls.frameworks.cra.items)),
    soc2: new Set(Object.keys(controls.frameworks.soc2.controls)),
    nist80053: new Set(Object.keys(controls.frameworks.nist80053.controls)),
  };
  const sources = [...Object.entries(controls.checks), ...Object.entries(controls.evidenceSources)];
  for (const [name, def] of sources) {
    for (const fw of ['cra', 'soc2', 'nist80053']) {
      for (const id of def[fw] || []) assert.ok(ids[fw].has(id), `${name} references unknown ${fw} control ${id}`);
    }
  }
});

test('dashboard: buildData + html produce a self-contained page with the coverage + advisory', async () => {
  const { buildData, html } = await import(pathToFileURL(join(REPO, 'cra', 'dashboard.mjs')).href);
  const paths = {
    controls: join(REPO, 'cra', 'controls.json'), products: join(FIX, 'products.json'),
    rollup: join(FIX, 'rollup.json'), ledger: join(FIX, 'ledger.json'),
    annotations: join(FIX, 'annotations.json'), cases: join(T, 'no-cases.json'),
    kev: join(FIX, 'kev.json'), epss: join(FIX, 'epss.json'),
    out: join(T, 'dash-out'), reportsRoot: join(T, 'no-sweeps'),
  };
  const data = buildData(paths, NOW);
  assert.ok(data.products.length >= 1);
  assert.ok(data.products[0].coverage.nist80053.total > 0);
  const page = html(data);
  assert.match(page, /^<!doctype html>/);
  assert.ok(!/https?:\/\/[^"']*\.(css|js)/.test(page), 'must not reference external assets');
  assert.match(page, /Advisory/);
  assert.match(page, /CRA Readiness/);
});

// ── POA&M export (discovery-date SLA, finding→800-53, deviations) ────────────

test('poamData: discovery-date SLA, severity mapping, finding→NIST, deviations, closed from ledger', async () => {
  const { poamData } = await import(pathToFileURL(join(REPO, 'cra', 'poam.mjs')).href);
  const { loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const annDoc = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const kev = JSON.parse(readFileSync(join(FIX, 'kev.json'), 'utf8'));
  const epss = JSON.parse(readFileSync(join(FIX, 'epss.json'), 'utf8'));
  const product = { id: 'prod-eu', name: 'Product EU', version: '1.4.0', repos: ['repo-a'] };
  const d = poamData(product, { rollup, ledger, annDoc, controls, kev, epss }, NOW);

  assert.equal(d.summary.open, 4);       // repo-a: 11111, 22222, 33333, 88888 (crit, not exploited)
  assert.equal(d.summary.closed, 1);     // CVE-2026-55555 strong; 66666 weak EXCLUDED
  assert.equal(d.summary.deviations, 1); // 33333 is annotated false-positive
  assert.equal(d.summary.overdue, 1);    // 11111 crit, discovery 2026-06-01 + 30d = 2026-07-01 < NOW
  assert.equal(d.summary.noDiscoveryDate, 0);
  assert.ok(!d.closed.some((r) => r.sourceIdentifier === 'CVE-2026-66666'), 'weak ledger evidence must not appear in closed');

  const crit = d.open.find((r) => r.sourceIdentifier === 'CVE-2026-11111');
  assert.equal(crit.severity, 'Critical');
  assert.equal(crit.slaDays, 30);                              // Critical/High → 30
  assert.deepEqual(crit.controls, ['RA-5', 'SR-3', 'SI-3']);   // osv → deps-osv → NIST (SI-3: the MAL- lane)
  assert.equal(crit.discoveryDate, '2026-06-01T00:00:00.000Z');
  assert.equal(crit.scheduledCompletionDate, '2026-07-01T00:00:00.000Z');
  assert.equal(crit.overdue, true);
  assert.match(crit.status, /PAST DUE/);
  assert.ok(crit.kev);                                         // KEV-listed → prioritized

  const med = d.open.find((r) => r.sourceIdentifier === 'CVE-2026-22222');
  assert.equal(med.severity, 'Moderate');
  assert.equal(med.slaDays, 90);                               // Moderate → 90
  assert.equal(med.overdue, false);

  const fp = d.open.find((r) => r.sourceIdentifier === 'CVE-2026-33333');
  assert.equal(fp.deviation.kind, 'FP');
  assert.equal(fp.overdue, false);                             // a requested deviation is not counted past-due
  assert.equal(d.deviations[0].needsAOApproval, true);        // FP requires AO approval
});

test('poamData: every scanner finding from the issue store, undetermined severity on no clock (D23)', async () => {
  const { poamData } = await import(pathToFileURL(join(REPO, 'cra', 'poam.mjs')).href);
  const { loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const row = (id, extra) => ({ id, repo: 'repo-a', kind: 'code', state: 'open', createdAt: '2026-06-15T00:00:00.000Z',
    source: { kind: 'scanner-row', key: `sc:${id}`, tool: 'sastSemgrep', rule: 'js.eval' }, severity: 'high', title: `t ${id}`, ...extra });
  const issues = { issues: {
    'ISS-1': row('ISS-1', { anchor: { file: 'src/a.js' } }),
    'ISS-2': row('ISS-2', { severity: 'unknown' }),
    'ISS-3': row('ISS-3', { state: 'closed', closedAs: 'fixed', updatedAt: '2026-07-01T00:00:00.000Z', evidence: [{ tier: 'strong', detail: 'line gone' }] }),
    'ISS-4': row('ISS-4', { state: 'closed', closedAs: 'refuted' }),
    'ISS-5': row('ISS-5', { repo: 'repo-other' }),
    'ISS-6': row('ISS-6', { kind: 'vuln', source: { kind: 'finding', key: 'g:repo-a|x', tool: 'osv' } }),
  } };
  const product = { id: 'prod-eu', name: 'Product EU', version: '1.4.0', repos: ['repo-a'] };
  const without = poamData(product, { rollup, ledger: { entries: [] }, annDoc: {}, controls }, NOW);
  const d = poamData(product, { rollup, ledger: { entries: [] }, annDoc: {}, controls, issues }, NOW);

  assert.equal(d.summary.open, without.summary.open + 2, 'two open scanner rows join the dependency rows');
  assert.deepEqual(d.summary.bySource.scanner, { open: 2, closed: 1 });
  assert.equal(d.summary.bySource.dependency.open, without.summary.open);
  assert.equal(without.summary.bySource.scanner.note, 'no issue store was given');
  assert.ok(!d.open.some((r) => ['ISS-5', 'ISS-6'].includes(r.issueId)), 'other repos and vulnerability issues stay out');

  const high = d.open.find((r) => r.issueId === 'ISS-1');
  assert.equal(high.origin, 'scanner');
  assert.equal(high.weaknessSource, 'sast');
  assert.deepEqual(high.controls, ['SA-11', 'SA-15']);
  assert.equal(high.asset, 'repo-a / src/a.js');
  assert.equal(high.sourceIdentifier, 'js.eval');
  assert.equal(high.scheduledCompletionDate, '2026-07-15T00:00:00.000Z');
  assert.equal(high.overdue, true);

  const unknown = d.open.find((r) => r.issueId === 'ISS-2');
  assert.equal(unknown.severity, 'Undetermined');
  assert.equal(unknown.slaDays, null);
  assert.equal(unknown.scheduledCompletionDate, null);
  assert.equal(unknown.overdue, false, 'no clock runs on a severity nobody stated');
  assert.match(unknown.status, /undetermined/);
  assert.equal(d.summary.undeterminedSeverity, 1);

  assert.equal(d.closed.filter((r) => r.origin === 'scanner').length, 1, 'fixed closes; refuted does not');
});

test('controlsForTool: known tool maps via check; unknown vuln tool falls back to RA-5', async () => {
  const { loadControls, controlsForTool } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  // osv carries SI-3 (malicious code protection) on top of RA-5/SR-3: osv.sarif delivers the OpenSSF
  // MAL- feed, so an OSV finding can be a confirmed-malicious package, not only a scored CVE.
  assert.deepEqual(controlsForTool('osv', controls), ['RA-5', 'SR-3', 'SI-3']);
  assert.deepEqual(controlsForTool('npm', controls), ['RA-5', 'SR-3']);
  assert.deepEqual(controlsForTool('gitleaks', controls), ['IA-5', 'SA-11']);
  assert.deepEqual(controlsForTool('some-unknown-scanner', controls), ['RA-5']); // never empty for a finding
});

test('sweepStampToISO derives discovery date, or null when no stamp', async () => {
  const { sweepStampToISO } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  assert.equal(sweepStampToISO('sweep-20260719170004'), '2026-07-19T17:00:04.000Z');
  assert.equal(sweepStampToISO('v0-20260702064632'), '2026-07-02T06:46:32.000Z');
  assert.equal(sweepStampToISO('adhoc-no-stamp'), null);
  assert.equal(sweepStampToISO(null), null);
});

// ── SOC 2 evidence packets ───────────────────────────────────────────────────

test('soc2 cadence: detects gaps beyond threshold, including an open-ended trailing gap', async () => {
  const { cadence } = await import(pathToFileURL(join(REPO, 'cra', 'soc2.mjs')).href);
  const history = JSON.parse(readFileSync(join(FIX, 'history.json'), 'utf8'));
  // period covers all rows; "now" is 2026-07-07 so no trailing gap
  const c1 = cadence(history, '2026-06-01T00:00:00.000Z', '2026-07-07T00:00:00.000Z');
  assert.equal(c1.runs, 4);
  assert.equal(c1.gaps.length, 1);                       // the 07-02 → 07-06 gap (4d > 2d)
  assert.equal(c1.gaps[0].days, 4);
  assert.ok(!c1.gaps[0].openEnded);
  // "now" well after the last run → an open-ended trailing gap is flagged
  const c2 = cadence(history, '2026-06-01T00:00:00.000Z', '2026-07-20T00:00:00.000Z');
  assert.ok(c2.gaps.some((g) => g.openEnded), 'must flag no-run-since-last as open gap');
});

test('soc2Packet: criteria keyed to TSC, honest exceptions, MTTR from ledger', async () => {
  const { soc2Packet } = await import(pathToFileURL(join(REPO, 'cra', 'soc2.mjs')).href);
  const { loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(FIX, 'ledger.json'), 'utf8'));
  const annDoc = JSON.parse(readFileSync(join(FIX, 'annotations.json'), 'utf8'));
  const history = JSON.parse(readFileSync(join(FIX, 'history.json'), 'utf8'));
  // product includes repo-ghost which is NOT in the rollup → CC7.1 completeness exception
  const product = { id: 'prod-eu', name: 'Product EU', version: '1.4.0', repos: ['repo-a', 'repo-ghost'] };
  const pk = soc2Packet(product, { controls, rollup, ledger, annDoc, cases: { cases: {} }, history }, { at: NOW, periodDays: 365 });
  assert.deepEqual(Object.keys(pk.criteria), ['CC7.1', 'CC7.2', 'CC7.4', 'CC7.5', 'CC8.1']);
  assert.ok(pk.criteria['CC7.1'].exceptions.some((e) => /repo-ghost/.test(e)), 'repo-ghost not in slice → completeness gap');
  assert.ok(pk.criteria['CC7.5'].evidenced);             // one strong ledger entry for repo-a
  assert.equal(pk.summary.verifiedRemediations, 1);      // weak entry excluded
  assert.ok(pk.mttr.high && pk.mttr.high.n === 1);       // CVE-2026-55555 high, strong
  assert.match(pk.criteria['CC8.1'].evidence, /\[HUMAN\]/); // PR approvals not held by commitwork
});

test('soc2Packet: CC7.4 is evidenced only by a response record, and a missed clock stays an exception', async () => {
  const { soc2Packet } = await import(pathToFileURL(join(REPO, 'cra', 'soc2.mjs')).href);
  const { loadControls } = await import(pathToFileURL(join(REPO, 'cra', 'controls.mjs')).href);
  const controls = loadControls(join(REPO, 'cra', 'controls.json'));
  const rollup = JSON.parse(readFileSync(join(FIX, 'rollup.json'), 'utf8'));
  const history = JSON.parse(readFileSync(join(FIX, 'history.json'), 'utf8'));
  const product = { id: 'prod-quiet', name: 'Quiet', version: '1.0.0', repos: ['repo-quiet'] };
  const inputs = { controls, rollup, ledger: { entries: [] }, annDoc: { annotations: [] }, history };
  const none = soc2Packet(product, { ...inputs, cases: { cases: {} } }, { at: NOW, periodDays: 365 });
  assert.equal(none.criteria['CC7.4'].evidenced, false, 'no case and no risk decision is not evidence of response');
  assert.match(none.criteria['CC7.4'].evidence, /no record/);
  const overdue = { caseId: 'c-1', productId: 'prod-quiet', status: 'open', clocks: { earlyWarningDue: '2000-01-01T00:00:00.000Z' } };
  const one = soc2Packet(product, { ...inputs, cases: { cases: { 'c-1': overdue } } }, { at: NOW, periodDays: 365 });
  assert.equal(one.criteria['CC7.4'].evidenced, true);
  assert.deepEqual(one.criteria['CC7.4'].exceptions, ['case c-1 past its early-warning clock']);
  assert.equal(one.summary.evidenced - none.summary.evidenced, 1);
});

// ── signed evidence (attest) ─────────────────────────────────────────────────

test('canonicalDigest is stable across JSON formatting, sensitive to value changes', async () => {
  const { canonicalDigest } = await import(pathToFileURL(join(REPO, 'cra', 'attest.mjs')).href);
  const a = join(T, 'a.json'), b = join(T, 'b.json'), c = join(T, 'c.json');
  writeFileSync(a, '{"x":1,"y":[2,3]}');
  writeFileSync(b, '{ "y": [2, 3],\n  "x": 1 }');   // same data, different formatting + key order
  writeFileSync(c, '{"x":1,"y":[2,4]}');             // one value changed
  assert.equal(canonicalDigest(a), canonicalDigest(b), 'formatting/key-order must not change the digest');
  assert.notEqual(canonicalDigest(a), canonicalDigest(c), 'a value change must change the digest');
});

test('attest: sign then verify passes; tampering a signed artifact fails verify (exit 1)', () => {
  const kd = join(T, 'attest-keys');
  const rollup = join(T, 'att-rollup.json'), ledger = join(T, 'att-ledger.json');
  cpSync(join(FIX, 'rollup.json'), rollup);
  cpSync(join(FIX, 'ledger.json'), ledger);
  const env = (extra = {}) => ({
    ...process.env, CW_CRA_ROOT: T, CW_ATTEST_KEYDIR: kd, CW_ATTEST_LOG: join(T, 'att', 'attestations.jsonl'),
    CW_CRA_OUT: join(T, 'att'), CW_ROLLUP: rollup, CW_LEDGER: ledger,
    CW_PRODUCTS: join(FIX, 'products.json'), CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_CASES: join(T, 'att-cases.json'),
    ...extra,
  });
  const run = (args, extra) => spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), ...args], { env: env(extra), encoding: 'utf8' });

  assert.equal(run(['keygen']).status, 0);
  assert.equal(run(['sign']).status, 0);
  const v = run(['verify']);
  assert.equal(v.status, 0, v.stdout + v.stderr);
  assert.match(v.stdout, /chain verified/);

  // tamper the ledger after signing → verify must fail
  const led = JSON.parse(readFileSync(ledger, 'utf8'));
  led.entries[0].toVersion = '9.9.9-EVIL';
  writeFileSync(ledger, JSON.stringify(led));
  const v2 = run(['verify']);
  assert.equal(v2.status, 1);
  assert.match(v2.stdout, /digest MISMATCH/);
});

// ── runtime scanner targeting ────────────────────────────────────────────────

test('resolveTargets: only services with a URL become runtime targets; overrides + --only work', async () => {
  const { resolveTargets } = await import(pathToFileURL(join(REPO, 'cra', 'runtime.mjs')).href);
  const reg = {
    projects: [
      { name: 'client-a', path: '/x/services', manifest: ['security-baseline'], expand: 'children',
        urls: { 'app-api-gateway': 'http://127.0.0.1:8080', 'app-goods-service': 'http://127.0.0.1:8093' } },
      { name: 'internal-b', path: '/a', manifest: 'internal-b-dev' },          // no URL → not a target
      { name: 'standalone', path: '/s', manifest: 'security-baseline', url: 'https://s.example' },
    ],
  };
  const all = resolveTargets(reg, {});
  assert.deepEqual(all.map((t) => t.name).sort(), ['app-api-gateway', 'app-goods-service', 'standalone']);
  const gw = all.find((t) => t.name === 'app-api-gateway');
  assert.equal(gw.url, 'http://127.0.0.1:8080');
  // NATIVE, via join() — this is a PATH, not an identity. resolveTargets builds it with join() and
  // runtime.mjs then calls existsSync(t.path) and passes it as `--repo` to a spawned process, so a
  // POSIX-normalised value would be wrong on Windows in the one direction that matters. The rule
  // this cycle recorded holds: stored identity is POSIX, a path or an argv is native — and applying
  // either to the other case produces a bug that looks exactly like the one just fixed.
  assert.equal(gw.path, join('/x/services', 'app-api-gateway'));
  assert.ok(!all.some((t) => t.name === 'internal-b'), 'a service with no URL is not a runtime target');

  // --only narrows; a CLI url map can add/override a target
  const one = resolveTargets(reg, { only: 'app-goods-service' });
  assert.deepEqual(one.map((t) => t.name), ['app-goods-service']);
  const overridden = resolveTargets(reg, { only: 'app-api-gateway', urls: { 'app-api-gateway': 'https://staging:8443' } });
  assert.equal(overridden[0].url, 'https://staging:8443');
});

test('unconfiguredServices: scanned services with no runtime URL are surfaced as the wiring gap', async () => {
  const { unconfiguredServices, resolveTargets } = await import(pathToFileURL(join(REPO, 'cra', 'runtime.mjs')).href);
  const reg = { projects: [{ name: 'x', path: '/x', expand: 'children', urls: { 'app-api-gateway': 'http://a' } }] };
  const scanned = ['app-api-gateway', 'app-crm-service', 'web-site'];
  const gaps = unconfiguredServices(scanned, resolveTargets(reg, {}));
  assert.deepEqual(gaps, ['app-crm-service', 'web-site']); // the two without a URL
});

// ── runner hardening (subprocess) ────────────────────────────────────────────

function makeFixtureRepo() {
  const repo = join(T, 'fixture-repo');
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'package.json'), '{"name":"fixture"}\n');
  return repo;
}

test('runner: explicit manifest runs end-to-end and writes checks-status provenance', () => {
  const repo = makeFixtureRepo();
  const manifest = join(T, 'fixture-manifest.json');
  writeFileSync(manifest, JSON.stringify({
    repo: 'fixture', repoPath: repo,
    groups: { all: ['ok-check', 'echo-check'] },
    checks: [
      { id: 'ok-check', local: ['node -e "process.exit(0)"'] },
      { id: 'echo-check', local: ['node -e "console.log(1)"'] },
    ],
  }));
  const reportDir = join(T, 'fixture-reports');
  const r = spawnSync('node', [join(REPO, 'bin', 'commitwork.mjs'), 'run', 'all', '--manifest', manifest],
    { env: { ...process.env, CW_REPORT_DIR: reportDir }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const status = JSON.parse(readFileSync(join(reportDir, 'checks-status.json'), 'utf8'));
  assert.deepEqual(status.map((s) => [s.check, s.status]), [['ok-check', 'pass'], ['echo-check', 'pass']]);
});

test('runner: invalid manifest dies with structural errors before anything executes', () => {
  const manifest = join(T, 'bad-manifest.json');
  writeFileSync(manifest, JSON.stringify({ checks: [{ id: 'Bad_ID!', local: 'not-an-array' }] }));
  const r = spawnSync('node', [join(REPO, 'bin', 'commitwork.mjs'), 'list', '--manifest', manifest], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /repo \(string\) is required/);
  assert.match(r.stderr, /id must match/);
  assert.match(r.stderr, /local must be an array/);
});

test('runner: repo-local commitwork.json is untrusted — refuses, dry-runs, then runs with consent', () => {
  const repo = makeFixtureRepo();
  const marker = join(repo, 'PWNED');
  // FORWARD SLASHES INSIDE THE EMBEDDED LITERAL. `marker` lands inside a single-quoted JavaScript
  // string that a nested `node -e` parses, so on Windows every backslash is read as an ESCAPE:
  // C:\Users\jhancock\…\fixture-repo\PWNED became C:UsersjhancockAppData…ixture-repoPWNED — `\U`
  // and `\j` dropped their backslash, `\f` became a literal formfeed and ate the f of "fixture",
  // and `C:` followed by a now-relative path is DRIVE-relative, so the implant wrote itself under
  // the cwd instead of where the assertion looked. The security property was never in doubt; the
  // payload simply could not land, which would have made the last two assertions vacuous the day
  // the guard broke. Node accepts forward slashes on Windows, and the assertions below keep the
  // native `marker` so they still check a real path.
  const embedded = marker.replace(/\\/g, '/');
  writeFileSync(join(repo, 'commitwork.json'), JSON.stringify({
    repo: 'evil', repoPath: repo,
    checks: [{ id: 'implant', local: [`node -e "require('fs').writeFileSync('${embedded}','x')"`] }],
  }));
  const run = (args, env = {}) => spawnSync('node', [join(REPO, 'bin', 'commitwork.mjs'), ...args],
    { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8' });

  const refused = run(['run', 'all']);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /refusing to execute commands from repo-local manifest/);
  assert.ok(!existsSync(marker), 'untrusted manifest must not execute');

  const dry = run(['run', 'all', '--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /PWNED/);           // command is SHOWN
  assert.ok(!existsSync(marker), 'dry-run must not execute');

  const trusted = run(['run', 'all', '--trust-repo-manifest']);
  assert.equal(trusted.status, 0, trusted.stderr);
  assert.ok(existsSync(marker), 'explicit consent executes');
  rmSync(marker, { force: true });

  const viaEnv = run(['run', 'all'], { COMMITWORK_TRUST_REPO_MANIFEST: '1' });
  assert.equal(viaEnv.status, 0, viaEnv.stderr);
  assert.ok(existsSync(marker));
});

test('runner: bundled security-baseline manifest validates with no errors and only the known silent-green warnings', () => {
  const r = spawnSync('node', [join(REPO, 'bin', 'commitwork.mjs'), 'list', '--manifest', 'security-baseline', '--repo', T], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  // No hard errors, ever.
  assert.ok(!/manifest error/.test(r.stderr), `unexpected errors:\n${r.stderr}`);
  // The bundled manifest now carries ZERO silent-green warnings: nuclei was the last format
  // without a parseReport handler and it has one. Pinning zero turns any NEW silent-green format
  // RED the moment it is introduced — a check that scores green regardless of findings is the
  // worst failure this repo can ship, so the bar is none, not a known-list.
  const warns = r.stderr.split('\n').filter((l) => /manifest warning/.test(l));
  const silentGreen = warns.filter((w) => /silent-green/.test(w));
  const other = warns.filter((w) => !/silent-green/.test(w));
  assert.equal(other.length, 0, `unexpected non-silent-green warnings:\n${other.join('\n')}`);
  assert.equal(silentGreen.length, 0, `no format may score green regardless of findings; got ${silentGreen.length}:\n${silentGreen.join('\n')}`);
});

// ── full evidence pipeline (refresh) ─────────────────────────────────────────

test('refresh: whole pipeline runs, signs, catalogues artifacts with digests, verifies', () => {
  const out = join(T, 'refresh-out'), keys = join(T, 'refresh-keys');
  const env = {
    ...process.env, CW_CRA_ROOT: T,
    CW_ROLLUP: join(FIX, 'rollup.json'), CW_LEDGER: join(FIX, 'ledger.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_PRODUCTS: join(FIX, 'products.json'),
    CW_KEV: join(FIX, 'kev.json'), CW_EPSS: join(FIX, 'epss.json'),
    CW_CONTROLS: join(REPO, 'cra', 'controls.json'), CW_HISTORY: join(FIX, 'history.json'),
    CW_CASES: join(T, 'refresh-cases.json'), CW_CRA_OUT: out,
    CW_ATTEST_KEYDIR: keys, CW_ATTEST_LOG: join(out, 'attestations.jsonl'), CW_CRA_NOW: NOW,
    CW_ESCALATE: '0', // refresh test asserts the pipeline exit; paging is covered by escalate.test.mjs
    CRA_WEBHOOK_URL: 'https://hooks.example/cra', // EU products need a resolvable pager for the preflight gate (R2)
  };
  assert.equal(spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), 'keygen'], { env, encoding: 'utf8' }).status, 0);
  // --no-xlsx keeps the test node-only (no LibreOffice recalc dependency)
  const r = spawnSync('node', [join(REPO, 'cra', 'refresh.mjs'), '--no-xlsx'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const idx = JSON.parse(readFileSync(join(out, 'evidence-index.json'), 'utf8'));
  assert.equal(idx.signed, true);
  assert.ok(idx.artifactCount > 5, `expected several artifacts, got ${idx.artifactCount}`);
  assert.ok(idx.steps.length > 0, 'the evidence index records no steps — artifactCount does not constrain them, so the exit check below would pass over none');
  // every non-optional step succeeded (sbom is optional — no sweep dir in the fixture env)
  for (const s of idx.steps) if (s.step !== 'sbom') assert.equal(s.exit, 0, `${s.step} exited ${s.exit}`);
  // every catalogued artifact carries a real sha256
  assert.ok(idx.artifacts.every((a) => /^[0-9a-f]{64}$/.test(a.sha256)));
  // the signed durable evidence verifies independently
  assert.equal(spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), 'verify'], { env, encoding: 'utf8' }).status, 0);
});

// refresh's keyPresent probe and attest's keyDir used to answer "which directory" differently:
// attest treated CW_ATTEST_KEYDIR as an override, refresh OR-ed it with the default. A key at the
// default path plus an env dir with none made refresh schedule a sign step that attest could only
// fail — and evidence-index.json still published signed:true over zero signatures, which is the
// unsupported pass shape this module exists to refuse.
test('refresh: keyPresent probes the keydir attest will actually read, never the default OR the override', () => {
  const out = join(T, 'kd-out'), envKeys = join(T, 'kd-empty-keys');
  mkdirSync(envKeys, { recursive: true });         // exists, holds no key
  const base = {
    ...process.env, CW_CRA_ROOT: T,
    CW_ROLLUP: join(FIX, 'rollup.json'), CW_LEDGER: join(FIX, 'ledger.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_PRODUCTS: join(FIX, 'products.json'),
    CW_KEV: join(FIX, 'kev.json'), CW_EPSS: join(FIX, 'epss.json'),
    CW_CONTROLS: join(REPO, 'cra', 'controls.json'), CW_HISTORY: join(FIX, 'history.json'),
    CW_CASES: join(T, 'kd-cases.json'), CW_CRA_OUT: out,
    CW_ATTEST_LOG: join(out, 'attestations.jsonl'), CW_CRA_NOW: NOW,
    CW_ESCALATE: '0', CRA_WEBHOOK_URL: 'https://hooks.example/cra',
  };
  // a real key at the DEFAULT location (CW_ATTEST_KEYDIR unset → cra/.keys under CW_CRA_ROOT)
  const kg = spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), 'keygen'], { env: base, encoding: 'utf8' });
  assert.equal(kg.status, 0, kg.stdout + kg.stderr);
  const defaultKey = join(T, 'cra', '.keys', 'attest-ed25519.key'); // gitleaks:allow — a filename, not key material
  assert.ok(existsSync(defaultKey), `default keydir got no key — the premise of this test is gone (looked at ${defaultKey})`);

  // now point the override at a keyless dir: attest would read ONLY this, so refresh must not sign
  const r = spawnSync('node', [join(REPO, 'cra', 'refresh.mjs'), '--no-xlsx'],
    { env: { ...base, CW_ATTEST_KEYDIR: envKeys }, encoding: 'utf8' });
  const idx = JSON.parse(readFileSync(join(out, 'evidence-index.json'), 'utf8'));
  assert.equal(idx.signed, false, 'evidence-index claims signed with no key in the keydir attest reads');
  assert.ok(!idx.steps.some((s) => s.step === 'sign'), 'scheduled a sign step attest could only fail');
  assert.match(r.stdout, /signing skipped/, 'no key in the resolved keydir must be reported, not silently dropped');

  // and the mirror: key in the override dir, default ignored — signing is still reached
  const kg2 = spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), 'keygen'], { env: { ...base, CW_ATTEST_KEYDIR: envKeys }, encoding: 'utf8' });
  assert.equal(kg2.status, 0, kg2.stdout + kg2.stderr);
  const r2 = spawnSync('node', [join(REPO, 'cra', 'refresh.mjs'), '--no-xlsx'],
    { env: { ...base, CW_ATTEST_KEYDIR: envKeys }, encoding: 'utf8' });
  const idx2 = JSON.parse(readFileSync(join(out, 'evidence-index.json'), 'utf8'));
  assert.equal(idx2.signed, true, r2.stdout + r2.stderr);
  assert.ok(idx2.steps.some((s) => s.step === 'sign' && s.exit === 0), 'sign step missing or failed');
});

// keygen writes the keydir's own .gitignore BEFORE the private key: CW_ATTEST_KEYDIR can point
// inside a repo, where the root .gitignore's path-pinned cra/.keys/*.key rule does not reach.
test('attest keygen: the keydir .gitignore covers the key, and is written before it', () => {
  const kd = join(T, 'keygen-order-keys');
  const env = { ...process.env, CW_CRA_ROOT: T, CW_ATTEST_KEYDIR: kd, CW_CRA_OUT: join(T, 'keygen-order-out') };
  const r = spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), 'keygen'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const gi = join(kd, '.gitignore');
  assert.ok(existsSync(gi), 'keygen left the keydir with no .gitignore');
  assert.match(readFileSync(gi, 'utf8'), /\*\.key/);
  // ordering, from the filesystem rather than from reading the source: the ignore rule must not be
  // newer than the key it covers, or there is a window where the key is trackable.
  const { mtimeMs: giAt } = statSync(gi), { mtimeMs: keyAt } = statSync(join(kd, 'attest-ed25519.key'));
  assert.ok(giAt <= keyAt, `.gitignore (${giAt}) is newer than the key it covers (${keyAt})`);
});

// The chmod used to sit in `try { … } catch {}`: a key that could not be restricted was written,
// reported as a success, and left readable. A refusal the caller cannot see is not a refusal.
test('attest keygen: a key that cannot be restricted to 0600 is an error, and is not left on disk', async () => {
  const { keygen } = await import(pathToFileURL(join(REPO, 'cra', 'attest.mjs')).href);
  const kd = join(T, 'chmod-refused-keys');
  const refuse = () => { throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' }); };
  assert.throws(() => keygen({ keyDir: kd }, { io: { chmodSync: refuse } }), /could not restrict .* to 0600 \(EPERM\)/);
  assert.ok(!existsSync(join(kd, 'attest-ed25519.key')), 'an unrestricted private key survived the refusal');
  assert.ok(!existsSync(join(kd, 'attest-ed25519.pub')), 'a public key was published for a keypair that was refused');
});

test('attest keygen --force restricts an existing key file, whose old mode writeFileSync keeps', { skip: process.platform === 'win32' }, async () => {
  const { keygen } = await import(pathToFileURL(join(REPO, 'cra', 'attest.mjs')).href);
  const kd = join(T, 'chmod-force-keys');
  mkdirSync(kd, { recursive: true });
  const priv = join(kd, 'attest-ed25519.key');
  writeFileSync(priv, 'old key');
  chmodSync(priv, 0o644);
  keygen({ keyDir: kd }, { force: true });
  assert.equal(statSync(priv).mode & 0o777, 0o600);
});

// A torn final record is its own verdict — not a pass, not a tamper — and sign refuses to build on
// it, the posture monitor/history-chain.mjs takes for the history log.
test('attest verify: a torn final record is reported as torn (exit 3), distinct from valid and tampered', () => {
  const kd = join(T, 'torn-keys'), out = join(T, 'torn-out'), log = join(out, 'attestations.jsonl');
  const rollup = join(T, 'torn-rollup.json'), ledger = join(T, 'torn-ledger.json');
  cpSync(join(FIX, 'rollup.json'), rollup);
  cpSync(join(FIX, 'ledger.json'), ledger);
  const env = {
    ...process.env, CW_CRA_ROOT: T, CW_ATTEST_KEYDIR: kd, CW_ATTEST_LOG: log, CW_CRA_OUT: out,
    CW_ROLLUP: rollup, CW_LEDGER: ledger, CW_PRODUCTS: join(FIX, 'products.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_CASES: join(T, 'torn-cases.json'),
  };
  const run = (args) => spawnSync('node', [join(REPO, 'cra', 'attest.mjs'), ...args], { env, encoding: 'utf8' });
  assert.equal(run(['keygen']).status, 0);
  assert.equal(run(['sign']).status, 0);
  assert.equal(run(['sign']).status, 0);
  const whole = readFileSync(log, 'utf8');
  const ok = run(['verify']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);

  // the last append lost its tail bytes, newline included
  writeFileSync(log, whole.slice(0, whole.length - 40));
  const torn = run(['verify']);
  assert.equal(torn.status, 3, torn.stdout + torn.stderr);
  assert.match(torn.stdout, /tail is TORN/);
  assert.doesNotMatch(torn.stdout, /chain break|hash mismatch|set-signature invalid|not JSON/, 'the complete prefix must still verify');

  const before = readFileSync(log);
  const s = run(['sign']);
  assert.notEqual(s.status, 0, 'sign appended onto a torn tail');
  assert.match(s.stderr, /unterminated record/);
  assert.ok(before.equals(readFileSync(log)), 'a refused sign must leave the log byte-identical');

  // complete JSON with no newline is still an append that did not finish
  writeFileSync(log, whole.slice(0, -1));
  assert.equal(run(['verify']).status, 3);

  // a tamper stays a tamper, even beside a torn tail
  const [first, second] = whole.trim().split('\n');
  const edited = { ...JSON.parse(first), at: '1999-01-01T00:00:00.000Z' };
  writeFileSync(log, `${JSON.stringify(edited)}\n${second.slice(0, 30)}`);
  const t = run(['verify']);
  assert.equal(t.status, 1, t.stdout + t.stderr);
  assert.match(t.stdout, /hash mismatch/);
  assert.match(t.stdout, /tail is TORN/);

  // and a complete line that does not parse is corruption, not a tear
  writeFileSync(log, `${first}\n{not json\n${second}\n`);
  const c = run(['verify']);
  assert.equal(c.status, 1, c.stdout + c.stderr);
  assert.match(c.stdout, /not JSON/);
});

// The whole module's path tree hangs off craRoot(). As `export const ROOT = process.env.… ? …` it
// froze at import, so every CW_CRA_ROOT-isolated test in this file was passing on a value it had
// not actually set — in-process. (The spawned tests were unaffected; that is exactly what made it
// survive.) Set the env AFTER import, which is the only ordering that can tell the two apart.
test('env is read at call time: CW_CRA_ROOT set after import still takes effect', async () => {
  const { craRoot, resolvePaths } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const before = process.env.CW_CRA_ROOT;
  const scratch = join(T, 'late-root');
  mkdirSync(join(scratch, 'monitor'), { recursive: true });
  try {
    delete process.env.CW_CRA_ROOT;
    assert.equal(craRoot(), REPO, 'with no override craRoot() is the checkout');
    process.env.CW_CRA_ROOT = scratch;                       // set AFTER import — a frozen const misses this
    assert.equal(craRoot(), scratch, 'CW_CRA_ROOT set after import did not take effect');
    // and it must reach the paths built from it, not just the accessor
    assert.match(resolvePaths().annotations, new RegExp(`^${scratch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      'resolvePaths() still resolved against the import-time root');
  } finally {
    if (before === undefined) delete process.env.CW_CRA_ROOT; else process.env.CW_CRA_ROOT = before;
  }
});

// ── MCP server (stdio JSON-RPC) ──────────────────────────────────────────────

test('mcp: stdio protocol — initialize, tools/list, coverage tool, guarded run_checks, resources', () => {
  const env = {
    ...process.env, CW_CRA_ROOT: T,
    CW_ROLLUP: join(FIX, 'rollup.json'), CW_LEDGER: join(FIX, 'ledger.json'),
    CW_ANNOTATIONS: join(FIX, 'annotations.json'), CW_PRODUCTS: join(FIX, 'products.json'),
    CW_KEV: join(FIX, 'kev.json'), CW_EPSS: join(FIX, 'epss.json'),
    CW_CONTROLS: join(REPO, 'cra', 'controls.json'), CW_CASES: join(T, 'mcp-cases.json'),
    CW_CRA_OUT: join(T, 'mcp-out'),
  };
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },   // notification → no response
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'coverage', arguments: { product: 'prod-eu', framework: 'nist80053' } } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_checks', arguments: { repo: T, manifest: 'not-a-bundled-manifest' } } },
    { jsonrpc: '2.0', id: 5, method: 'resources/list' },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nope' } },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync('node', [join(REPO, 'mcp', 'server.mjs')], { input, env, encoding: 'utf8' });
  const byId = {};
  for (const line of (r.stdout || '').trim().split('\n')) { if (line.trim()) { const m = JSON.parse(line); byId[m.id] = m; } }

  assert.equal(byId[1].result.serverInfo.name, 'commitwork');
  assert.equal(byId[1].result.protocolVersion, '2024-11-05');
  const tools = byId[2].result.tools.map((t) => t.name);
  // THE SET, NOT THE COUNT — and this one has a dated reason. It pinned `tools.length === 12` until
  // the three codegraph tools were added, and then failed with `15 !== 12`: a message saying a
  // number moved, and not WHICH tool, which is the whole question when a protocol surface changes.
  // A count also cannot separate an addition from a simultaneous add-and-remove, and a `>=` floor
  // would miss a removal entirely — on the tool list of an MCP server, a tool silently disappearing
  // is the more expensive direction.
  //
  // Measured 2026-09-04, and worth recording because it is the sharpest example this cycle: the
  // count went stale DURING a full-suite run. caf72da landed at 16:37:11 and the run finished at
  // 16:37:10, so one measurement of this tree saw 12 tools and the next saw 15 — with no commit of
  // mine between them. On a tree eight sessions share, "the code under test did not move" is an
  // assumption, not a fact.
  assert.deepEqual(tools.slice().sort(), [
    'code_about', 'code_blast_radius', 'code_dead_exports',
    'coverage', 'findings',
    'issue_claim', 'issue_close', 'issue_dispositions', 'issue_judge', 'issues_ready',
    'list_products', 'open_cases', 'poam', 'readiness', 'run_checks', 'run_checks_result', 'run_checks_start',
    'turn_efficiency',
  ], 'the MCP tool surface changed — add or remove the name here deliberately, never re-pin a number');
  assert.ok(tools.includes('run_checks') && tools.includes('coverage') && tools.includes('poam'));
  // the issue-tracker trio (read + two store-only writes; issue_close refuses 'fixed' for auto-source issues)
  assert.ok(tools.includes('issues_ready') && tools.includes('issue_claim') && tools.includes('issue_close'));
  // the return path: read a finding's judgement state, then push a judgement back at it
  // (monitor/ingest-external.mjs owns every rule; these two handlers are adapters)
  assert.ok(tools.includes('issue_dispositions') && tools.includes('issue_judge'));
  // coverage returns scope-honest data (catalogue denominator travels with it)
  const cov = JSON.parse(byId[3].result.content[0].text);
  assert.equal(cov.summary.nist80053.catalog, 1007);
  assert.ok(cov.summary.nist80053.mapped >= 20);
  // run_checks refuses an unbundled/untrusted manifest → isError, message mentions bundled
  assert.equal(byId[4].result.isError, true);
  assert.match(byId[4].result.content[0].text, /bundled/);
  // resources expose config + produced artifacts
  assert.ok(byId[5].result.resources.some((x) => /config\/controls\.json$/.test(x.uri)));
  // unknown tool → JSON-RPC error (not a crash)
  assert.ok(byId[6].error && /unknown tool/.test(byId[6].error.message));
  // notification produced no response line
  assert.equal(byId.undefined, undefined);
});

// ── report-parser harness (gap #5): severity normalization through the real CLI ──

test('parsers: reindex normalizes SARIF/npm-audit/trivy/trufflehog/sbom severities correctly', () => {
  const manifest = join(T, 'parser-manifest.json');
  writeFileSync(manifest, JSON.stringify({
    repo: 'parser-fixture',
    checks: [
      { id: 'sast', local: ['true'], report: { file: 'semgrep.sarif', format: 'sarif' } },
      { id: 'deps', local: ['true'], report: { file: 'npm-audit.json', format: 'npm-audit' } },
      { id: 'jvm', local: ['true'], report: { file: 'trivy.json', format: 'trivy' } },
      { id: 'secrets', local: ['true'], report: { file: 'th.json', format: 'trufflehog' } },
      { id: 'sbom', local: ['true'], report: { file: 'sbom.json', format: 'sbom' } },
    ],
  }));
  const runDir = join(T, 'parser-run');
  const hi = join(runDir, 'repo-hi'), lo = join(runDir, 'repo-lo');
  mkdirSync(hi, { recursive: true }); mkdirSync(lo, { recursive: true });

  // repo-hi — every parser should read a HIGH/critical severity
  writeFileSync(join(hi, 'semgrep.sarif'), JSON.stringify({ runs: [{ results: [{ level: 'error', ruleId: 'x' }, { level: 'warning', ruleId: 'y' }] }] }));
  writeFileSync(join(hi, 'npm-audit.json'), JSON.stringify({ metadata: { vulnerabilities: { critical: 2, high: 1, moderate: 0, low: 0 } } }));
  writeFileSync(join(hi, 'trivy.json'), JSON.stringify({ Results: [{ Vulnerabilities: [{ Severity: 'CRITICAL' }, { Severity: 'HIGH' }, { Severity: 'MEDIUM' }] }] }));
  writeFileSync(join(hi, 'th.json'), JSON.stringify({ DetectorName: 'AWS', Verified: true }) + '\n' + JSON.stringify({ DetectorName: 'GCP', Verified: false }));
  writeFileSync(join(hi, 'sbom.json'), JSON.stringify({ components: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] }));

  // repo-lo — clean/absent: empty SARIF (no sources), zero npm vulns, trivy report MISSING
  writeFileSync(join(lo, 'semgrep.sarif'), '');
  writeFileSync(join(lo, 'npm-audit.json'), JSON.stringify({ metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 0, low: 0 } } }));
  // (no trivy.json, no th.json, no sbom.json)

  const r = spawnSync('node', [join(REPO, 'bin', 'commitwork.mjs'), 'reindex', '--manifest', manifest, '--out', runDir], { encoding: 'utf8' });
  assert.equal(r.status ?? 0, 0, r.stderr);
  const idx = readFileSync(join(runDir, 'index.md'), 'utf8');

  // SARIF: an error-level result → HIGH (this is the severity path the 627→all-medium bug lived on)
  assert.match(idx, /repo-hi[\s\S]*🔴/);
  // npm-audit critical count string preserved verbatim (2c/1h/0m/0l), not flattened
  assert.match(idx, /2c\/1h\/0m\/0l/);
  // trivy critical+high present
  assert.match(idx, /1c\/1h\/1m\/0l/);
  // trufflehog: exactly the verified/unverified split
  assert.match(idx, /1 verified \/ 1 unverified/);
  // sbom component count
  assert.match(idx, /3 components/);
  // repo-lo empty SARIF is NOT reported as a finding; missing reports are n/a, never a false green
  const loRow = idx.split('\n').find((l) => l.includes('repo-lo')) || '';
  assert.ok(!/🔴/.test(loRow), 'clean repo must not show high findings');
});

// ── R22: per-area evidence merge, per-repo sweep selection, per-product manifests ───────────
// A self-contained fixture tree shaped like the real checkout (the private registry and product
// registry + reports/<out>/ + manifests/), because these tests exercise
// resolvePaths()'s own area/manifest resolution rather than the flat CW_ROLLUP/CW_LEDGER
// single-file overrides the rest of this suite uses. Two areas: 'primary' (the ambient
// default, monitorOutput) holding an expand:children repo, and 'other' (non-ambient) holding a
// standalone repo with REAL findings + a REAL ledger entry — reports/clientA-monorepo has
// neither on the live checkout today, which is exactly the gap R22 closes.
function makeAreaFixture() {
  const R = mkdtempSync(join(tmpdir(), 'cra-area-'));
  mkdirSync(join(R, 'monitor', 'data'), { recursive: true });
  mkdirSync(join(R, 'manifests'), { recursive: true });
  mkdirSync(join(R, 'cra'), { recursive: true });
  mkdirSync(join(R, 'reports', 'primary-out'), { recursive: true });
  mkdirSync(join(R, 'reports', 'other-area'), { recursive: true });
  // expand:children only needs a real SUBDIRECTORY to exist, not a git checkout.
  mkdirSync(join(R, 'src', 'expandable', 'primary-child'), { recursive: true });

  // Through the resolver, not a literal: the registry moved to monitor/private/ and cra/lib.mjs
  // defaults a missing one to {}, so a fixture written to the old path stops being read WITHOUT
  // failing — the probe keeps answering and the assertions quietly change meaning.
  mkdirSync(dirname(registryPathFor(R, { ambient: false })), { recursive: true });
  writeFileSync(registryPathFor(R, { ambient: false }), JSON.stringify({
    reportsRoot: 'reports', monitorOutput: 'primary-out',
    defaultManifest: 'security-baseline',
    areas: [
      { slug: 'primary', label: 'Primary', out: 'primary-out', primary: true, members: ['primary-child'] },
      { slug: 'other', label: 'Other', out: 'other-area', members: ['other-repo'] },
    ],
    projects: [
      { name: 'expandable', area: 'primary', path: join(R, 'src', 'expandable'), manifest: ['security-baseline', 'build-health'], expand: 'children' },
      { name: 'other-repo', area: 'other', path: join(R, 'src', 'other-repo'), manifest: 'custom-manifest' },
    ],
  }, null, 2));

  writeFileSync(join(R, 'reports', 'primary-out', 'rollup.json'), JSON.stringify({
    generated: '2026-07-25T00:00:00.000Z', sliceId: 'sweep-20260725000000',
    repos: [{ name: 'primary-child', findings: [] }],
  }));
  writeFileSync(join(R, 'reports', 'other-area', 'rollup.json'), JSON.stringify({
    generated: '2026-07-20T00:00:00.000Z', sliceId: 'sweep-20260720000000',
    repos: [{ name: 'other-repo', findings: [{ tool: 'osv', id: 'CVE-2099-00001', severity: 'high', kev: false, epss: null, state: 'persisting' }] }],
  }));
  writeFileSync(join(R, 'reports', 'other-area', 'remediation-ledger.json'), JSON.stringify({
    entries: [{
      repo: 'other-repo', vulnId: 'CVE-2099-00002', package: 'some-pkg', fromVersion: '1.0.0', toVersion: '1.0.1',
      evidence: { tier: 'strong', detail: 'fixed via patch' }, bornSlice: 'sweep-20260710000000', resolvedSlice: 'sweep-20260720000000',
    }],
  }));

  writeFileSync(join(R, 'manifests', 'security-baseline.json'), JSON.stringify({ checks: [
    { id: 'secrets', description: 'secrets scan', groups: ['all'] },
    { id: 'sast', description: 'sast scan', groups: ['all'] },
  ] }));
  writeFileSync(join(R, 'manifests', 'build-health.json'), JSON.stringify({ checks: [
    { id: 'deadcode', description: 'deadcode scan', groups: ['all'] },
  ] }));
  writeFileSync(join(R, 'manifests', 'custom-manifest.json'), JSON.stringify({ checks: [
    { id: 'custom-check', description: 'a check only this manifest has', groups: ['all'] },
  ] }));

  // Through the resolver as well: the product registry is a private record (monitor/private/).
  writeFileSync(craProductsPathFor(R, { ambient: false }), JSON.stringify({
    manufacturer: { name: 'Fixture Co', contact: 'sec@fixture.example' },
    products: [
      { id: 'prod-primary', name: 'Primary Product', version: '1.0.0', repos: ['primary-child'], market: { eu: true } },
      { id: 'prod-other', name: 'Other Product', version: '1.0.0', repos: ['other-repo'], market: { eu: true } },
      { id: 'prod-multi', name: 'Multi-area Product', version: '1.0.0', repos: ['primary-child', 'other-repo'], market: { eu: false } },
    ],
  }, null, 2));

  return R;
}

test('areasForRepos + resolveEvidenceForRepos: groups by declared area, merges rollup+ledger across them, and is honest about an area with no evidence at all', async () => {
  const { areasForRepos, resolveEvidenceForRepos } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const R = makeAreaFixture();
  const projects = JSON.parse(readFileSync(registryPathFor(R, { ambient: false }), 'utf8'));

  const grouped = areasForRepos(['primary-child', 'other-repo', 'ghost-repo'], projects);
  assert.deepEqual([...grouped.keys()].sort(), ['ghost-repo', 'other', 'primary']);
  assert.deepEqual(grouped.get('other'), ['other-repo']);

  const paths = { projects, reportsRoot: join(R, 'reports') };
  const evidence = resolveEvidenceForRepos(['primary-child', 'other-repo', 'ghost-repo'], paths);
  const byArea = Object.fromEntries(evidence.areas.map((a) => [a.area, a]));

  // 'other' (non-ambient) area: real rollup + ledger — found, not missing.
  assert.equal(byArea.other.hasRollup, true);
  assert.deepEqual(byArea.other.found, ['other-repo']);
  assert.equal(byArea.other.missing.length, 0);
  // 'ghost-repo' (own-name fallback, never declared or scanned): no rollup — REPORTED, never
  // silently folded into "zero findings".
  assert.equal(byArea['ghost-repo'].hasRollup, false);
  assert.deepEqual(byArea['ghost-repo'].missing, ['ghost-repo']);
  assert.deepEqual(evidence.missing, ['ghost-repo']);
  // merged rollup carries BOTH areas' real repos — the single hardwired directory this replaces
  // could only ever have surfaced 'primary-child'.
  assert.deepEqual(evidence.rollup.repos.map((r) => r.name).sort(), ['other-repo', 'primary-child']);
  // merged ledger carries the OTHER area's real entry — the ambient area has no ledger file at
  // all in this fixture (mirrors the live checkout: reports/clientA-monorepo has none either).
  assert.equal(evidence.ledgerEntries.length, 1);
  assert.equal(evidence.ledgerEntries[0].vulnId, 'CVE-2099-00002');
  // freshness of the merge = the OLDEST contributing slice (other-area's 07-20 predates
  // primary's 07-25) — evidence is only as fresh as its stalest source.
  assert.equal(evidence.rollup.generated, '2026-07-20T00:00:00.000Z');
});

test('resolvePaths({area}) resolves a DECLARED area\'s own directory; resolvePaths() with no args is unchanged (ambient default)', () => {
  const R = makeAreaFixture();
  const script = `
    import { resolvePaths } from ${JSON.stringify(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href)};
    const ambient = resolvePaths();
    const other = resolvePaths({ area: 'other' });
    console.log(JSON.stringify({ ambientRollup: ambient.rollup, otherRollup: other.rollup, otherArea: other.area, ambientArea: ambient.area }));
  `;
  const r = spawnSync('node', ['--input-type=module', '-e', script], { env: { ...process.env, CW_CRA_ROOT: R }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.ambientRollup, join(R, 'reports', 'primary-out', 'rollup.json'));
  assert.equal(out.otherRollup, join(R, 'reports', 'other-area', 'rollup.json'));
  assert.equal(out.otherArea, 'other');
  assert.equal(out.ambientArea, null);
});

test('latestSweepDir: with no repos filter, newest by name (unchanged); with a filter, the newest batch that actually covers them — never a newer unrelated one', async () => {
  const { latestSweepDir } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const R = makeAreaFixture();
  const root = join(R, 'reports');
  const older = join(root, 'sweep-20260101000000');
  const newerDecoy = join(root, 'sweep-20260228000000-decoy');
  const newestAdhoc = join(root, 'sweep-20260301000000-adhoc'); // no batch-manifest.json at all

  mkdirSync(join(older, 'primary-child'), { recursive: true });
  writeFileSync(join(older, 'batch-manifest.json'), JSON.stringify({ kind: 'sweep', sliceId: 'sweep-20260101000000', scope: { repos: [{ name: 'primary-child' }] } }));
  mkdirSync(join(newerDecoy, 'decoy-repo'), { recursive: true });
  writeFileSync(join(newerDecoy, 'batch-manifest.json'), JSON.stringify({ kind: 'sweep', sliceId: 'sweep-20260228000000', scope: { repos: [{ name: 'decoy-repo' }] } }));
  mkdirSync(join(newestAdhoc, 'primary-child'), { recursive: true });

  // no filter: plain newest by name — EXACTLY the old, unchanged behaviour.
  assert.equal(latestSweepDir(root), newestAdhoc);
  // filtered: an adhoc (manifestless) batch's scope is "the repo dirs physically present"
  // (monitor/rollup.mjs's own rule for kind:'adhoc') — it legitimately matches here.
  assert.equal(latestSweepDir(root, { repos: ['primary-child'] }), newestAdhoc);

  // remove the adhoc batch's matching dir to isolate the manifest-scoped skip specifically: the
  // newer decoy (which HAS a manifest, declaring an unrelated repo) must still be skipped in
  // favour of the OLDER batch that actually declares primary-child in scope.
  rmSync(join(newestAdhoc, 'primary-child'), { recursive: true, force: true });
  assert.equal(latestSweepDir(root, { repos: ['primary-child'] }), older);

  // a repo no batch covers at all -> null, never a silent fallback to an unrelated batch.
  assert.equal(latestSweepDir(root, { repos: ['nothing-covers-this'] }), null);
});

test('manifestIdsForRepos: an expand:children repo inherits its PARENT entry\'s manifest (array); a plain entry keeps its own; an unresolved repo falls back to the registry default', async () => {
  const { manifestIdsForRepos } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const R = makeAreaFixture();
  const projects = JSON.parse(readFileSync(registryPathFor(R, { ambient: false }), 'utf8'));
  const paths = { projects };

  const a = manifestIdsForRepos(['primary-child'], paths);
  assert.deepEqual(a.ids.sort(), ['build-health', 'security-baseline']);
  assert.deepEqual(a.unresolved, []);

  const b = manifestIdsForRepos(['other-repo'], paths);
  assert.deepEqual(b.ids, ['custom-manifest']);

  const c = manifestIdsForRepos(['ghost-repo'], paths); // never declared, no roots[] to auto-discover it
  assert.deepEqual(c.ids, ['security-baseline']); // registry defaultManifest, not an empty catalogue
  assert.deepEqual(c.unresolved, ['ghost-repo']);

  const d = manifestIdsForRepos(['primary-child', 'other-repo'], paths); // union across repos
  assert.deepEqual(d.ids.sort(), ['build-health', 'custom-manifest', 'security-baseline']);
});

test('kevFreshness: reads the catalogue\'s OWN dateReleased/catalogVersion — never the file\'s mtime', async () => {
  const { kevFreshness } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const kevPath = join(T, 'kev-fresh-test.json');
  writeFileSync(kevPath, JSON.stringify({ catalogVersion: '2026.07.01', dateReleased: '2026-07-01T19:00:06.000Z', vulnerabilities: [] }));
  // Stamp the file's mtime to "right now" — exactly what a fresh git checkout used to do while
  // kev.json was tracked. A mtime-based check would read this as ~0 days old; the content says
  // otherwise, and content is what must win.
  utimesSync(kevPath, new Date(), new Date());
  const at = '2026-07-30T00:00:00.000Z'; // ~29 days after dateReleased
  const f = kevFreshness({ kev: kevPath }, at);
  assert.equal(f.state, 'stale');
  assert.equal(f.catalogVersion, '2026.07.01');
  assert.ok(f.ageDays >= 28 && f.ageDays <= 30, `expected ~29 days from CONTENT, got ${f.ageDays}`);

  // a doc with no dateReleased at all is honestly 'unknown', never a guessed age.
  const noDatePath = join(T, 'kev-no-date.json');
  writeFileSync(noDatePath, JSON.stringify({ vulnerabilities: [] }));
  const f2 = kevFreshness({ kev: noDatePath }, at);
  assert.equal(f2.state, 'unknown');
  assert.equal(f2.ageDays, null);
});

test('epssFreshness: always unknown, with a stated reason — never invents an age from mtime or anything else', async () => {
  const { epssFreshness } = await import(pathToFileURL(join(REPO, 'cra', 'lib.mjs')).href);
  const f = epssFreshness();
  assert.equal(f.state, 'unknown');
  assert.match(f.reason, /no version\/date field/);
});

test('sbom.mjs CLI: resolves the sweep batch PER PRODUCT, ignoring a newer but unrelated decoy sweep', () => {
  const R = makeAreaFixture();
  const realSweep = join(R, 'reports', 'sweep-20260101000000');
  const decoySweep = join(R, 'reports', 'sweep-20260228000000-decoy');
  mkdirSync(join(realSweep, 'primary-child'), { recursive: true });
  writeFileSync(join(realSweep, 'batch-manifest.json'), JSON.stringify({
    area: 'primary', areaOut: 'reports/primary-out', kind: 'sweep', sliceId: 'sweep-20260101000000',
    scope: { repos: [{ name: 'primary-child' }] },
  }));
  writeFileSync(join(realSweep, 'primary-child', 'sbom-syft.json'), JSON.stringify({
    components: [{ name: 'real-component', version: '1.0.0', purl: 'pkg:npm/real-component@1.0.0' }],
  }));
  mkdirSync(join(decoySweep, 'decoy-repo'), { recursive: true });
  writeFileSync(join(decoySweep, 'batch-manifest.json'), JSON.stringify({
    area: 'decoy', areaOut: 'reports/decoy-out', kind: 'sweep', sliceId: 'sweep-20260228000000',
    scope: { repos: [{ name: 'decoy-repo' }] },
  }));
  writeFileSync(join(decoySweep, 'decoy-repo', 'sbom-syft.json'), JSON.stringify({ components: [{ name: 'WRONG-component' }] }));

  const env = { ...process.env, CW_CRA_ROOT: R, CW_CRA_NOW: NOW };
  const r = spawnSync('node', [join(REPO, 'cra', 'sbom.mjs'), '--product', 'prod-primary'], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /sweep-20260101000000/);
  assert.ok(!/sweep-20260228000000-decoy/.test(r.stdout), 'must not report the newer decoy sweep as the source');

  const out = JSON.parse(readFileSync(join(R, 'reports', 'cra', 'sbom', 'prod-primary-1.0.0.cdx.json'), 'utf8'));
  assert.ok(out.components.some((c) => c.name === 'real-component'));
  assert.ok(!out.components.some((c) => c.name === 'WRONG-component'), 'must not merge the unrelated decoy sweep\'s component');
  const spdx = JSON.parse(readFileSync(join(R, 'reports', 'cra', 'sbom', 'prod-primary-1.0.0.spdx.json'), 'utf8'));
  assert.equal(spdx.spdxVersion, 'SPDX-2.3');
  assert.deepEqual(spdx.packages.filter((p) => p.SPDXID.startsWith('SPDXRef-Package-')).map((p) => p.name),
    out.components.map((c) => c.name), 'the SPDX beside the CycloneDX carries the same component set');
});

test('preflight CLI: a non-ambient area\'s evidence is found (not "never scanned"); KEV freshness is content-based, not mtime-based', () => {
  const R = makeAreaFixture();
  writeFileSync(join(R, 'monitor', 'data', 'kev.json'), JSON.stringify({ catalogVersion: '2026.06.01', dateReleased: '2026-06-20T00:00:00.000Z', vulnerabilities: [] }));
  // mtime = "now" (as a fresh checkout would leave it) — the OLD mtime-based check would have
  // read this as ~0 days old / fresh; content says it is ~30 days stale.
  utimesSync(join(R, 'monitor', 'data', 'kev.json'), new Date(), new Date());
  writeFileSync(join(R, 'monitor', 'data', 'epss.json'), JSON.stringify({}));

  const env = { ...process.env, CW_CRA_ROOT: R, CW_CRA_NOW: NOW };
  const r = spawnSync('node', [join(REPO, 'cra', 'preflight.mjs'), '--json'], { env, encoding: 'utf8' });
  const out = JSON.parse(r.stdout);

  // R22 fix 1: other-repo (prod-other) resolves to the 'other' area, which HAS a real rollup —
  // must not be reported as "never scanned" just because it is absent from the AMBIENT rollup.
  assert.ok(!out.advisories.some((a) => /'other-repo' is not in the latest rollup/.test(a)), JSON.stringify(out.advisories));
  assert.ok(out.info.some((i) => /area 'other': 1\/1 repo\(s\) evidenced/.test(i)), JSON.stringify(out.info));

  // R21/preflight mtime fix: KEV content (2026-06-20, ~30 days before NOW) is stale regardless
  // of the mtime being stamped to "now" moments ago.
  assert.ok(out.advisories.some((a) => /KEV catalogue is \d+d stale/.test(a)), JSON.stringify(out.advisories));
  assert.ok(!out.advisories.some((a) => /KEV catalog is \d+d old — refresh \(watch/.test(a)), 'must not use the old mtime-based advisory wording');
  // EPSS: always 'unknown', never a fabricated age.
  assert.ok(out.info.some((i) => /EPSS store freshness: unknown/.test(i)), JSON.stringify(out.info));
});

test('pack.mjs CLI: resolves the ledger AND the check catalogue PER PRODUCT, across areas and manifests', () => {
  const R = makeAreaFixture();
  const env = { ...process.env, CW_CRA_ROOT: R, CW_CRA_NOW: NOW };
  const r = spawnSync('node', [join(REPO, 'cra', 'pack.mjs')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  // prod-other (repo: other-repo, area 'other') picks up the REAL ledger entry that lives in the
  // OTHER area — the ambient/primary directory has no ledger file at all in this fixture.
  const otherLog = readFileSync(join(R, 'reports', 'cra', 'pack', 'prod-other', 'remediation-log.md'), 'utf8');
  assert.match(otherLog, /CVE-2099-00002/);
  assert.match(otherLog, /strong/);

  // prod-primary (repo: primary-child, manifest ['security-baseline','build-health']) documents
  // BOTH manifests' checks — not just security-baseline.
  const primaryHandling = readFileSync(join(R, 'reports', 'cra', 'pack', 'prod-primary', 'vulnerability-handling.md'), 'utf8');
  assert.match(primaryHandling, /security-baseline, build-health/);
  assert.match(primaryHandling, /\bsecrets\b/);
  assert.match(primaryHandling, /\bdeadcode\b/); // only in build-health.json — proves the union

  // prod-other's repo runs ONLY custom-manifest — must not silently document security-baseline's
  // checks for a product that never runs them.
  const otherHandling = readFileSync(join(R, 'reports', 'cra', 'pack', 'prod-other', 'vulnerability-handling.md'), 'utf8');
  assert.match(otherHandling, /custom-manifest/);
  assert.match(otherHandling, /custom-check/);
  assert.ok(!/\bdeadcode\b/.test(otherHandling), 'must not document build-health checks for a product that does not run it');
  assert.ok(!/\bsecrets\b/.test(otherHandling), 'must not document security-baseline checks for a product that does not run it');
});

test('report.mjs CLI: a case whose repos live in a non-ambient area picks up its REAL ledger evidence', () => {
  const R = makeAreaFixture();
  writeFileSync(join(R, 'cra', 'cases.json'), JSON.stringify({
    events: [],
    cases: {
      'prod-other--cve-2099-00002': {
        caseId: 'prod-other--cve-2099-00002', productId: 'prod-other', vulnId: 'CVE-2099-00002',
        kind: 'vulnerability', trigger: 'kev', severity: 'high', cvss: null, epss: null, kev: true,
        packages: [], repos: ['other-repo'], slices: [], firstDetectedAt: NOW, awarenessAt: NOW,
        measures: [], status: 'open',
        clocks: { basis: 'x', earlyWarningDue: NOW, notificationDue: NOW, finalDue: NOW },
      },
    },
  }));
  const env = { ...process.env, CW_CRA_ROOT: R, CW_CRA_NOW: NOW, CW_CASES: join(R, 'cra', 'cases.json') };
  const r = spawnSync('node', [join(REPO, 'cra', 'report.mjs'), 'prod-other--cve-2099-00002'], { env, encoding: 'utf8' });
  assert.equal(r.status ?? 0, 0, r.stdout + r.stderr);

  const fin = readFileSync(join(R, 'reports', 'cra', 'cases', 'prod-other--cve-2099-00002', 'final-report.md'), 'utf8');
  assert.ok(!/no verified fix in the remediation ledger yet/.test(fin), 'the non-ambient area\'s ledger entry must have been found');
  assert.match(fin, /other-repo: some-pkg 1\.0\.0 → 1\.0\.1/);
  assert.match(fin, /evidence: strong — fixed via patch/);
});

// ── PROVENANCE OF THE PROVENANCE ────────────────────────────────────────────────────────────────
// syft's CycloneDX writer discards metadata.resolved, so a git-pinned dependency publishes under a
// bare registry purl. Measured 2026-08-26: closure-net as pkg:npm/closure-net@0.0.0, a version npm
// has never served. Because componentKey IS the purl, that false identity was also the merge key.
// bin/sbom-enrich.mjs corrects it at scan time; these assert the published document says whether
// that happened, since an unchecked claim must not look identical to a checked one.

test('a source SBOM that was NOT provenance-corrected is named in the published document', async () => {
  const { mergeProductSbom } = await import(pathToFileURL(join(REPO, 'cra', 'sbom.mjs')).href);
  const product = { id: 'p', name: 'P', version: '1.0.0', repos: ['a', 'b'] };
  const { doc } = mergeProductSbom(product, { name: 'M' }, [
    { repo: 'a', doc: { components: [{ name: 'x', version: '1', purl: 'pkg:npm/x@1' }] }, provenance: 'enriched' },
    { repo: 'b', doc: { components: [{ name: 'y', version: '1', purl: 'pkg:npm/y@1' }] }, provenance: 'unenriched' },
  ], '2026-08-26T00:00:00Z');
  const props = Object.fromEntries(doc.metadata.properties.map((p) => [p.name, p.value]));
  assert.equal(props['commitwork:provenance-unenriched'], 'b');
  assert.match(props['commitwork:provenance-caveat'], /unverified, not verified-clean/);
  assert.match(props['commitwork:provenance-caveat'], /still carries a package-registry purl/);
});

test('when every source was corrected, no caveat is published — an empty claim is not a claim', async () => {
  const { mergeProductSbom } = await import(pathToFileURL(join(REPO, 'cra', 'sbom.mjs')).href);
  const product = { id: 'p', name: 'P', version: '1.0.0', repos: ['a'] };
  const { doc } = mergeProductSbom(product, { name: 'M' }, [
    { repo: 'a', doc: { components: [{ name: 'x', version: '1', purl: 'pkg:npm/x@1' }] }, provenance: 'enriched' },
  ], '2026-08-26T00:00:00Z');
  const names = doc.metadata.properties.map((p) => p.name);
  assert.ok(!names.includes('commitwork:provenance-unenriched'));
  assert.ok(!names.includes('commitwork:provenance-caveat'));
});

test('nothing-to-correct is NOT unenriched — a repo with no git dependencies is fully checked', async () => {
  const { mergeProductSbom } = await import(pathToFileURL(join(REPO, 'cra', 'sbom.mjs')).href);
  const product = { id: 'p', name: 'P', version: '1.0.0', repos: ['a'] };
  const { doc } = mergeProductSbom(product, { name: 'M' }, [
    { repo: 'a', doc: { components: [{ name: 'x', version: '1', purl: 'pkg:npm/x@1' }] }, provenance: 'nothing-to-correct' },
  ], '2026-08-26T00:00:00Z');
  assert.ok(!doc.metadata.properties.some((p) => p.name === 'commitwork:provenance-caveat'));
});

test('a corrected purl no longer merges with a registry package of the same name', async () => {
  const { mergeProductSbom } = await import(pathToFileURL(join(REPO, 'cra', 'sbom.mjs')).href);
  // The dedupe consequence: before enrichment both rows keyed on pkg:npm/closure-net@0.0.0 and
  // collapsed into one component carrying both repos, asserting they were the same artifact.
  const product = { id: 'p', name: 'P', version: '1.0.0', repos: ['a', 'b'] };
  const { doc } = mergeProductSbom(product, { name: 'M' }, [
    { repo: 'a', doc: { components: [{ name: 'closure-net', version: '0.0.0', purl: 'pkg:npm/closure-net@0.0.0?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Fgoogle%2Fclosure-net.git' }] }, provenance: 'enriched' },
    { repo: 'b', doc: { components: [{ name: 'closure-net', version: '0.0.0', purl: 'pkg:npm/closure-net@0.0.0' }] }, provenance: 'enriched' },
  ], '2026-08-26T00:00:00Z');
  assert.equal(doc.components.length, 2, 'a git checkout and a registry package are two artifacts');
});
