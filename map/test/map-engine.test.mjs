// map engine — project-agnosticism and honest-empty-state tests, driven through a synthetic
// project in a tmpdir. Pins: (1) no client's name/number/narrative in another project's artifact;
// (2) absence renders as absence — never a crash, "undefined", a zero, or another project's default.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { loadScope } from '../../bin/lib/release-names-head-scan.mjs';
import { findNames } from '../../bin/lib/release-scope.mjs';

const MAP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Client names come from the private maps, through the release gate's own scope and matcher, never
// from this file: a guard that lists them publishes them. A public checkout has no maps and checks
// the generic tokens below only.
const PRIVATE_SCOPE = loadScope();

// Tokens of the client the engine was once hardcoded for — none may appear in any other project's
// artifact. Matching is normalised (case/whitespace/separators collapsed) and entries derive from
// strings actually FOUND in a generated file: near-miss spellings are the failure mode guarded here.
const CLIENT_TOKENS = [
  'Sydney', 'single mainline',
  'KC 16', 'KC migrate', 'KC span', 'Keycloak', 'realm preserved',
  '168C', 'Boot 4.1', 'Boot 3.2', 'boot3212', 'boot35', 'boot2',
  'Wave 1 → 3', 'Wave 1→3', 'great convergence',
  'monorepo', 'post-4.1', '3.2.12', '26.6.3',
  'runs as root (no USER)', 'deprecated MAINTAINER',
];

// Collapse case/whitespace/separators so a near-miss spelling cannot pass.
const normalise = (s) => String(s).toLowerCase().replace(/[\s_·—–-]+/g, '');

function clientTokensIn(html) {
  const hay = normalise(html);
  const found = CLIENT_TOKENS.filter((t) => hay.includes(normalise(t)));
  // a private hit is reported by the map it came from, never by the name itself
  if (PRIVATE_SCOPE) for (const h of findNames(html, PRIVATE_SCOPE)) found.push(`‹${h.source}›`);
  return found;
}

function baseProject(overrides = {}) {
  const meta = {
    title: 'Acme Widgets', subtitle: 'a project that is not the engine author’s first client',
    asOf: '2026-08-20', logo: null, logoLabel: null, kpis: [],
    counts: { resolved: 0, open: 1, inProgress: 0 },
    severityLegend: {}, statusLegend: {},
    ...(overrides.meta || {}),
  };
  return {
    meta,
    versionAxis: [{ id: 'old', era: 'Legacy', band: 'legacy' }, { id: 'cur', era: 'Current', band: 'now' }],
    waves: [],
    tracks: [{ id: 'svc-a', index: 0, cohort: 'app', colour: '#0072bc', enter: 'old', reach: 'cur', cve: { total: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } }],
    infraSiding: [],
    subsystems: [{
      subsystemId: 's1', subsystemName: 'Core', color: '#0072bc',
      nodes: [{ name: 'svc-a', kind: 'service', currentVersion: '1.0', journey: [], issues: [{ id: 'M-1', title: 'upgrade the thing', severity: 'HIGH', status: 'open' }] }],
    }],
    remediationLog: [],
    ...(overrides.top || {}),
  };
}

// Renders a synthetic project and returns its artifact; throws if generate.mjs exits non-zero.
function render(data, extraFiles = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cw-map-'));
  try {
    writeFileSync(join(root, 'data.json'), JSON.stringify(data, null, 1));
    for (const [rel, body] of Object.entries(extraFiles)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    execFileSync('node', [join(MAP, 'generate.mjs')], { env: { ...process.env, MAP_ROOT: root }, stdio: 'pipe' });
    return readFileSync(join(root, 'index.html'), 'utf8');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------------------- crash / empty state --------- */

test('a securityProgram with no monitor{} renders an empty state, not a TypeError', () => {
  const d = baseProject();
  d.meta.securityProgram = { asOf: '2026-08-20', scanners: ['osv'] };
  const html = render(d);
  assert.match(html, /monitor not declared/);
  assert.match(html, /check count not reported/);
  assert.match(html, /no live target declared/);
});

test('a securityProgram with no secrets{} says "not recorded", never "undefined found"', () => {
  const d = baseProject();
  d.meta.securityProgram = { asOf: '2026-08-20', monitor: { tool: 'commitwork', checks: 3 } };
  const html = render(d);
  assert.doesNotMatch(html, /undefined found/);
  assert.doesNotMatch(html, /undefined remaining/);
  assert.match(html, /no secret scan recorded for this project/);
});

test('a securityProgram with no cvePosture{} says "not measured", never 0 CVEs', () => {
  // explicit uncertainty: an unmeasured posture must not render as a clean one.
  const d = baseProject();
  d.meta.securityProgram = { asOf: '2026-08-20', monitor: { tool: 'commitwork', checks: 3 } };
  const html = render(d);
  assert.match(html, /CVE posture not measured for this project/);
  assert.doesNotMatch(html, /<b>0<\/b> npm CVEs/);
});

test('an EMPTY cvePosture{} says "not measured" too — presence of the object is not measurement', () => {
  const d = baseProject();
  d.meta.securityProgram = { asOf: '2026-08-20', monitor: { tool: 'commitwork', checks: 3 }, cvePosture: {}, secrets: {} };
  const html = render(d);
  assert.match(html, /CVE posture not measured for this project/);
  assert.doesNotMatch(html, /<b>0<\/b> npm CVEs/);
  assert.doesNotMatch(html, /0C<\/span>/);
});

test('an absent baseline count renders grey, never the literal "undefined"', () => {
  const d = baseProject();
  d.meta.securityProgram = {
    asOf: '2026-08-20',
    monitor: { tool: 'commitwork', checks: 3 },
    historicBaseline: { label: 'earlier snapshot' },
    topRemediation: [{ severity: 'HIGH', package: 'pkg' }],
    kev: [{ package: 'kpkg', cve: 'CVE-1' }],
  };
  const html = render(d);
  // Scoped: "undefined" legitimately appears in the inlined client JS — assert the actual bad renders.
  assert.doesNotMatch(html, /undefinedC/);
  assert.doesNotMatch(html, /undefinedH/);
  assert.doesNotMatch(html, /undefined CVE/);
  assert.doesNotMatch(html, />undefined</);
  assert.match(html, /not recorded/);
});

test('a project with NO securityProgram at all renders no security panel and does not throw', () => {
  const html = render(baseProject());
  assert.doesNotMatch(html, /class="secprog"/);
  assert.match(html, /Acme Widgets/);
});

test('a fully-populated securityProgram still renders its real values', () => {
  // reversion guard: the absence handling must not have swallowed the present case.
  const d = baseProject();
  d.meta.securityProgram = {
    asOf: '2026-08-20', prioritisation: 'KEV then severity',
    monitor: { tool: 'commitwork', checks: 14, dashboard: 'reports/acme/dashboard.html', liveTarget: 'Acme/widgets' },
    cvePosture: { total: 12, crit: 1, high: 2, med: 3, low: 6, kevCves: 1 },
    secrets: { found: 5, remaining: 0, verifiedBy: 'gitleaks: 0 findings' },
    scanners: ['osv', 'gitleaks'],
  };
  const html = render(d);
  assert.match(html, /5 found/);
  assert.match(html, /0 remaining/);
  assert.match(html, /commitwork/);
  assert.match(html, /Acme\/widgets/);
  // Scoped to the panel — "not measured" is the CORRECT rendering elsewhere (unmeasured badge ladder).
  const panel = html.slice(html.indexOf('class="secprog"'), html.indexOf('</details>'));
  assert.doesNotMatch(panel, /not measured/);
});

/* ---------------------------------------------------------------- project-agnosticism ---------- */

test('no other client’s name, number or narrative reaches a project’s artifact', () => {
  const d = baseProject();
  d.meta.securityProgram = { asOf: '2026-08-20', monitor: { tool: 'commitwork', checks: 3 } };
  d.waves = [{ id: 'w1', short: 'W1', label: 'first wave', axis: 'cur', status: 'done' }];
  const html = render(d);
  const leaked = clientTokensIn(html);
  assert.deepEqual(leaked, [], `artifact leaks client tokens: ${JSON.stringify(leaked)}`);
});

test('an issue row resolves by POSITION, so duplicate ids cannot open the wrong finding', () => {
  const html = render(baseProject());
  assert.match(html, /data-idx="/);
  assert.match(html, /issues\[Number\(lk\.dataset\.idx\)\]/);
  assert.doesNotMatch(html, /\.find\(i=>i\.id===lk\.dataset\.iid\)/);
});

test('a track with no CVE snapshot renders "not measured", never C0 H0', () => {
  const d = baseProject();
  for (const t of d.tracks || []) delete t.cve;
  const html = render(d);
  assert.match(html, /not measured/);
});

test('an unmeasured track does not crash the renderer', () => {
  // Emitting undefined without guarding every t.cve call site would turn a false clean into a blank map.
  const d = baseProject();
  for (const t of d.tracks || []) delete t.cve;
  assert.doesNotThrow(() => render(d));
});

test('the leak guard matches near-miss spellings, not just the exact reported one', () => {
  // If normalisation is ever weakened back to a literal includes(), this fails.
  assert.deepEqual(clientTokensIn('<p>legacy/Boot4.1 era</p>'), ['Boot 4.1']);
  assert.deepEqual(clientTokensIn('<p>boot3212 anchor</p>'), ['boot3212']);
  assert.deepEqual(clientTokensIn('// kept clear of KC-migrate span'), ['KC migrate']);
  assert.deepEqual(clientTokensIn('--wave:"Great-Convergence",Arial'), ['great convergence']);
  assert.deepEqual(clientTokensIn('<p>nothing to see</p>'), []);
});

test('no comment survives into the artifact — the channel is closed, not policed', () => {
  const html = render(baseProject());
  const body = html.slice(html.indexOf('<style>'));
  const commentLines = body.split('\n').filter((l) => /^\s*\/\//.test(l));
  assert.deepEqual(commentLines, [], `comment lines reached the artifact: ${commentLines.slice(0, 3).join(' | ')}`);
});

test('the page title names the artifact, not a client', () => {
  const html = render(baseProject());
  assert.match(html, /<title>Acme Widgets — modernization map<\/title>/);
  // and it does not double up on a project whose own title already says "map"
  const owned = render(baseProject({ meta: { title: 'Acme Modernization Map' } }));
  assert.match(owned, /<title>Acme Modernization Map<\/title>/);
});

test('a now-span wave capsule is labelled from the wave, not from one client’s migration', () => {
  const d = baseProject();
  d.waves = [{ id: 'span', short: 'AUTH', label: 'auth server move', axis: 'now-span', status: 'done', spanFrom: 'old', spanTo: 'cur' }];
  const html = render(d);
  assert.ok(html.includes("w.short||w.label||w.id"), 'span capsule label must read the wave');
  assert.ok(!html.includes('KC 16'), 'span capsule must not carry another project’s version pair');
});

test('the masthead logo resolves only against the project’s own data dir', () => {
  const d = baseProject({ meta: { logo: 'other_logo_white.svg', logoLabel: 'Someone Else' } });
  const html = render(d);
  assert.ok(!html.includes('<span class="logo'), 'an unresolvable logo must render no mark at all');
});

test('a project-owned logo IS inlined', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect id="acme-mark" width="10" height="10"/></svg>';
  const d = baseProject({ meta: { logo: 'acme.svg', logoLabel: 'Acme' } });
  const html = render(d, { 'acme.svg': svg });
  assert.match(html, /acme-mark/);
  assert.match(html, /aria-label="Acme"/);
});

/* ---------------------------------------------------------------- honest claims ---------------- */

test('"WHOLE FLEET CONVERGED" is guarded by an equality on ARRIVED tracks, not by the band alone', () => {
  // Asserts the guard's SHAPE, not exact source text — pinning implementation text votes against fixing it.
  const html = render(baseProject());
  assert.match(html, /const converged = isNow && TRACKS\.length>0 && arrived\.length===TRACKS\.length;/);
  assert.match(html, /converged\?' · WHOLE FLEET CONVERGED':' · partial'/);
  // and the number shown beside the claim is the same population the claim is made from
  assert.match(html, /arrived\.length\+' \/ '\+TRACKS\.length\+' tracks'/);
});

test('the era legend makes no "all N tracks" claim it has not measured', () => {
  const html = render(baseProject());
  assert.doesNotMatch(html, /hero, all /);
  assert.match(html, /\(hero interchange\)/);
});

test('currency is not decided by a date literal frozen into the engine', () => {
  // any scan dated >= 2026-07-06 used to read "(current)" forever, on every project.
  const html = render(baseProject());
  assert.ok(!html.includes("d>='2026-07-06'"), 'engine must not carry a magic currency date');
});

test('an un-extended history is flagged as a snapshot, and an extended one as current', () => {
  const hist = (extra) => {
    const d = baseProject();
    d.meta.cveHistory = [
      { scope: 'jvm', event: 'a', ts: '2026-01-02T00-00-00-000Z', total: 20, crit: 2 },
      { scope: 'jvm', event: 'b', ts: '2026-03-04T00-00-00-000Z', total: 5, crit: 0 },
    ];
    Object.assign(d.meta, extra);
    return render(d);
  };
  const snapshot = hist({ historiesDerived: false });
  assert.match(snapshot, /historic snapshot — not extended from the live store/);
  assert.match(snapshot, /0 crit · 2026-03-04 \(last scan\)/);
  assert.ok(!snapshot.includes('(current)'), 'an un-extended series must not claim currency');

  const derived = hist({ historiesDerived: true });
  assert.match(derived, /0 crit · 2026-03-04 \(current\)/);
  // the caption states the span it actually covers, not a wave numbering
  assert.match(derived, /2026-01-02 → 2026-03-04/);
});

/* ---------------------------------------------------------------- inert controls --------------- */

test('the issue status chips are wired to the issue list', () => {
  // issueVisible() was defined and never called: the chips rendered and did nothing.
  const html = render(baseProject());
  assert.match(html, /function issueVisible\(iss\)/);
  assert.match(html, /function applyIssueFilter\(\)/);
  // both chip groups and the panel opener must drive it
  const calls = html.match(/applyIssueFilter\(\)/g) || [];
  assert.ok(calls.length >= 4, `applyIssueFilter must be called, saw ${calls.length} occurrences`);
  assert.match(html, /data-istatus="/);
});

test('an issue severity the toolbar has no chip for stays visible', () => {
  // state.sev has no INFO key; a bare truthiness test would hide every INFO issue permanently.
  const html = render(baseProject());
  assert.match(html, /s === undefined \? true : s/);
  assert.match(html, /t === undefined \? true : t/);
});

test('the CVE-baseline toggle is rendered only where a second baseline exists', () => {
  const without = render(baseProject());
  assert.ok(!without.includes('id="cveBaseline"'), 'no cveOriginal anywhere => no toggle');

  const d = baseProject();
  d.tracks[0].cveOriginal = { total: 9, CRITICAL: 4, HIGH: 5, MEDIUM: 0, LOW: 0 };
  const with_ = render(d);
  assert.match(with_, /id="cveBaseline"/);
  // and its label counts THIS project's criticals rather than carrying a literal
  assert.match(with_, /ORIG_CRIT!=null\?' \('\+ORIG_CRIT\+'C\)':''/);
  assert.ok(!with_.includes('168C'));
});

/* ---------------------------------------------------------------- injected issue text ---------- */

// attach-security.mjs turns scanner findings into map issues; each title must derive from the rows
// it summarises, never from a fixed sentence.
function attachSecurity({ findings = [], origRows = [], nodeCve = null }) {
  const root = mkdtempSync(join(tmpdir(), 'cw-map-sec-'));
  try {
    const data = baseProject();
    if (nodeCve) data.subsystems[0].nodes[0].cve = nodeCve;
    data.meta.counts = { resolved: 0, open: 0, inProgress: 0, bySeverity: {}, openBySeverity: {}, issues: 0, securityIssues: 0 };
    writeFileSync(join(root, 'data.json'), JSON.stringify(data, null, 1));
    writeFileSync(join(root, 'migration-state.json'), JSON.stringify({
      meta: { remediationTracks: [{ id: 'T1', label: 'JVM deps' }, { id: 'T4', label: 'Containers' }], securityJoin: {} },
    }, null, 1));
    const snapDir = 'snap-original';
    mkdirSync(join(root, 'cve-history', snapDir), { recursive: true });
    mkdirSync(join(root, 'cve-history', 'security-scans'), { recursive: true });
    writeFileSync(join(root, 'cve-history', 'index.json'), JSON.stringify({ snapshots: [{ event: 'baseline__TRUE-ORIGINAL', dir: snapDir }] }));
    writeFileSync(join(root, 'cve-history', snapDir, 'full-cve-list.json'), JSON.stringify(origRows));
    writeFileSync(join(root, 'cve-history', 'security-scans', 'security-findings.json'), JSON.stringify({ meta: {}, findings }));
    execFileSync('node', [join(MAP, 'attach-security.mjs')], { env: { ...process.env, MAP_ROOT: root }, stdio: 'pipe' });
    const out = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
    return { data: out, issues: out.subsystems[0].nodes[0].issues || [] };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('an iac issue quotes the findings it counts, not a fixed sentence', () => {
  const { issues } = attachSecurity({
    findings: [
      { class: 'iac', node: 'svc-a', severity: 'HIGH', id: 'X-1', title: 'Secret exposed via build arg', file: 'Dockerfile' },
      { class: 'iac', node: 'svc-a', severity: 'LOW', id: 'X-2', title: 'ADD instead of COPY', file: 'Dockerfile' },
    ],
  });
  const iac = issues.find(i => i.id === 'SEC-iac-svc-a');
  assert.ok(iac, 'expected an iac issue');
  assert.match(iac.title, /Secret exposed via build arg/);
  assert.match(iac.title, /ADD instead of COPY/);
  assert.ok(!/runs as root \(no USER\)/.test(iac.title), 'must not assert a defect the scan did not report');
  assert.ok(!/MAINTAINER/.test(iac.title), 'must not assert a defect the scan did not report');
});

test('a jvm-original issue compares against the real current scan, or says there is none', () => {
  const origRows = [
    { service: 'svc-a', severity: 'CRITICAL' }, { service: 'svc-a', severity: 'HIGH' },
  ];
  const measured = attachSecurity({ origRows, nodeCve: { total: 4, bySeverity: { CRITICAL: 0, HIGH: 1, MEDIUM: 3, LOW: 0 } } });
  const a = measured.issues.find(i => i.id === 'SEC-jvm-orig-svc-a');
  assert.ok(a, 'expected a jvm-original issue');
  assert.match(a.title, /4 in the current scan/);
  assert.ok(!/Boot 4\.1/.test(a.title), 'must not name another project’s framework upgrade');
  assert.ok(!/cleared to ~0/.test(a.title), 'must not claim an outcome nothing measured');

  const unmeasured = attachSecurity({ origRows });
  const b = unmeasured.issues.find(i => i.id === 'SEC-jvm-orig-svc-a');
  assert.match(b.title, /no current scan to compare against/);
});

test('the meta.security note describes the schema, not one project’s release history', () => {
  const { data } = attachSecurity({ origRows: [{ service: 'svc-a', severity: 'HIGH' }] });
  assert.ok(!/Boot 4\.1/.test(data.meta.security.note));
  assert.equal(data.meta.security.originSnapshot, 'baseline__TRUE-ORIGINAL');
});

/* ---------------------------------------------------------------- determinism ------------------ */

test('same input renders byte-identical output', () => {
  const d = baseProject();
  d.meta.securityProgram = { asOf: '2026-08-20', monitor: { tool: 'commitwork', checks: 3 } };
  assert.equal(render(d), render(d));
});

/* ---------------------------------------------------------------- keyboard access (WCAG 2.1.1) - */

test('every clickable part of the map is a keyboard target, and the detail panel manages focus', () => {
  const html = render(baseProject());
  assert.match(html, /function kbd\(node,label\)\{/);
  assert.match(html, /t\.dispatchEvent\(new MouseEvent\('click',\{bubbles:true\}\)\)/, 'SVG groups have no click(); Enter and Space must dispatch the event a pointer would');
  for (const site of ['kbd(g);', "kbd(grp,'wave '", 'kbd(hd);', 'kbd(row);', 'forEach(lk=>kbd(lk))', 'kbd(ch);']) {
    assert.ok(html.includes(site), `${site} is gone, so that element is click-only again`);
  }
  assert.match(html, /class="mapwrap" tabindex="0"/, 'the scrolling map must take focus so the arrow keys can scroll it');
  assert.match(html, /function openPanel\(\)\{[\s\S]*?\.dclose[\s\S]*?\.focus\(\)/);
  assert.match(html, /function closePanel\(\)\{[^\n]*panelOpener[^\n]*\.focus\(\)/);
  assert.match(html, /\[data-kbd\]:focus-visible/);
  assert.match(html, /g\[data-kbd\]:focus-visible>rect/, 'an outline on an SVG group is unreliable; the ring goes on its shape');
});

/* -------------------------------------------------------------- no-data placeholder (THEME §11) - */

// Importing render.mjs must not run it: the CLI writes into map/data/. The source check runs first,
// so a module that would run on import is never imported here.
test('the no-data placeholder takes the house sheet and the theme follower, with no palette of its own', async () => {
  assert.match(readFileSync(join(MAP, 'render.mjs'), 'utf8'), /^if \(isMainModule\(import\.meta\.url\)\) main\(\);$/m,
    'render.mjs runs on import, so it cannot be tested without writing into map/data/');
  const { stubHtml } = await import('../render.mjs');
  const { houseCss } = await import('../../lib/house-css.mjs');
  const { followerScript } = await import('../../lib/theme-follower.mjs');
  const html = stubHtml('acme<b>', 'no data at map/data/acme/');
  assert.ok(html.includes(houseCss()), 'the house sheet');
  assert.ok(html.includes(followerScript()), 'the theme follower');
  const own = html.replace(houseCss(), '').replace(followerScript(), '');
  assert.doesNotMatch(own, /#[0-9a-f]{3,8}\b|rgba?\(/i, 'a literal colour outside the house sheet');
  assert.doesNotMatch(own, /\d(?:px|pt)\b/, 'a fixed size; the page sizes in rem');
  assert.match(own, /color:var\(--mut\)/);
  assert.ok(!html.includes('acme<b>') && html.includes('acme&lt;b&gt;'), 'the slug is escaped');
});

// build-data.mjs writes the severity legend into data.json; its colours are the house tokens the map
// paints with, never a second severity palette (docs/THEME.md §3.4).
test('the severity legend build-data writes carries the house severity tokens', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-map-data-'));
  try {
    writeFileSync(join(root, 'subsystems.raw.json'), '[]');
    writeFileSync(join(root, 'migration-state.json'), JSON.stringify({ meta: {}, versionAxis: [], waves: [] }));
    execFileSync('node', [join(MAP, 'build-data.mjs')], { env: { ...process.env, MAP_ROOT: root }, stdio: 'pipe' });
    const legend = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8')).meta.severityLegend;
    assert.deepEqual(legend.map((l) => [l.sev, l.color]),
      [['CRIT', 'var(--crit)'], ['HIGH', 'var(--high)'], ['MED', 'var(--med)'], ['LOW', 'var(--low)']]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
