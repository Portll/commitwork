// Equivalence between the DERIVED detail renderer and the eleven literal ones it RETIRED.
//
// The acceptance criterion is not "the derived table contains the same values" — a renderer can
// display every value and still put it under the wrong heading (proven while planning this: the
// `iac` schema declares rule/file/line/sev/message while the markup's thead read
// Service/Rule/Sev/Location/Message, a different order AND a different column count). So this
// asserts value-UNDER-CORRECT-LABEL by comparing the emitted cells position for position.
//
// The schema is IMPORTED from monitor/detail-schema.mjs — the real one, not a fixture — so a schema
// edit that changes a lane's shape fails here rather than silently restyling the panel.
//
// The reference is fixtures/detail-rows.golden.json: the exact bytes the eleven literal renderers
// emitted, captured from them while they still existed and before they were deleted. That is what
// makes "keep the formatting" checkable rather than asserted — the literals are gone, but what they
// produced is pinned, so a derivation that restyles a lane fails here instead of shipping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSchema } from '../../monitor/detail-schema.mjs';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const from = (marker) => {
  const at = SRC.indexOf(marker);
  assert.ok(at > -1, `${marker} not found in admin/index.html`);
  return at;
};
// One contiguous slice: SARIF_ROW through the end of laneColumns(). Both the literal renderers and
// the derived one live in it, which is the point — they are compared as they actually ship.
const block = SRC.slice(from('const DETAIL_CELL='), SRC.indexOf('\n// ── ran===0 IS THREE FACTS'));
const tabsBlock = SRC.slice(from('const SCANNER_TABS=['), SRC.indexOf('\n];', from('const SCANNER_TABS=[')) + 3);

const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const sevPill = (s) => `<span class="pill">${esc(s)}</span>`;
const annCell = () => '<td class="ann"></td>';

// SARIF_GROUP_ROW is declared further down the page than this slice reaches. It renders the GROUPED
// mode (a rule aggregated across sites), which is a different rendering shape from a per-row cell
// and is deliberately NOT retired by the derivation — so it is stubbed here and its lanes are
// filtered out below. Retiring it would mean flattening grouped lanes into per-row ones, which is a
// formatting change, not a refactor.
const SARIF_GROUP_ROW = () => '';
const { SCANNER_TABS, laneColumns, LANE_FORMAT } = new Function('esc', 'sevPill', 'annCell', 'SARIF_GROUP_ROW',
  `${block}\n${tabsBlock}\nreturn { SCANNER_TABS, laneColumns, LANE_FORMAT };`)(esc, sevPill, annCell, SARIF_GROUP_ROW);

const SCHEMA = panelSchema();

/** A finding carrying every field the lane's schema declares, plus the rollup-prepended repo. */
function fixture(key) {
  const f = { repo: 'clientD' };
  const sample = { str: 'x-value', text: 'a detail message', path: 'src/app/main.js', int: 42, sev: 'high', bool: true };
  for (const c of SCHEMA[key].columns) f[c.name] = sample[c.type];
  // values that must round-trip recognisably rather than as 'x-value'
  if ('rule' in f) f.rule = 'some-rule-id';
  if ('package' in f) f.package = '@ctrl/tinycolor';
  if ('version' in f) f.version = '4.1.1';
  if ('id' in f) f.id = 'MAL-2025-47';
  if ('advisory' in f) f.advisory = 'https://osv.dev/vulnerability/MAL-2025-47';
  if ('commit' in f) f.commit = 'deadbeefcafe1234';
  if ('line' in f) f.line = 42;
  return f;
}

const derived = (key, f) => laneColumns(key, SCHEMA[key]).map((c) => c.render(f)).join('');
const GOLDEN = JSON.parse(readFileSync(join(HERE, 'fixtures', 'detail-rows.golden.json'), 'utf8'));

const perRow = SCANNER_TABS.filter((t) => !t.group && SCHEMA[t.key]);

test('every per-row lane has a schema to derive from', () => {
  const missing = SCANNER_TABS.filter((t) => !t.group && !SCHEMA[t.key]).map((t) => t.key);
  assert.deepEqual(missing, [], `these lanes render rows with no declared schema: ${missing.join(', ')}`);
  assert.ok(perRow.length >= 10, `only ${perRow.length} per-row lanes found — the table's shape changed`);
});

test('no per-row lane carries a literal renderer any more', () => {
  const leftovers = SCANNER_TABS.filter((t) => !t.group && t.row).map((t) => t.key);
  assert.deepEqual(leftovers, [],
    `these lanes still hand-write their rows: ${leftovers.join(', ')} — derive them or say why they cannot be`);
});

// Lanes that never had a literal renderer, so there is nothing to preserve for them: they were
// registered AFTER the derivation, which is what made registering them cheap. Declared rather than
// inferred from "has no golden entry", so a lane that LOSES its captured reference fails loudly
// instead of quietly joining this list.
const NEW_LANES = new Set(['stubs', 'denoLint', 'denoTypes', 'secretsHistory', 'cspm',
  'depsJvm', 'depsGo', 'depsRetire', 'vendorAssets', 'tlsHeaders', 'apiFuzz', 'gradleWrapper',
  'commitProvenance']);

test('every lane is either pinned to a captured reference or declared new', () => {
  const unaccounted = perRow.map((t) => t.key).filter((k) => !GOLDEN[k] && !NEW_LANES.has(k));
  assert.deepEqual(unaccounted, [],
    `no captured reference and not declared new: ${unaccounted.join(', ')} — if a lane lost its golden entry the formatting guarantee went with it`);
});

test('the golden master holds no stale references', () => {
  const live = new Set(perRow.map((t) => t.key));
  const stale = Object.keys(GOLDEN).filter((k) => !live.has(k));
  assert.deepEqual(stale, [], `golden entries for lanes that no longer render rows: ${stale.join(', ')}`);
});

test('a declared-new lane really has no captured reference', () => {
  // Guards the other direction: adding a key to NEW_LANES must not be a way to opt a pinned lane
  // out of its own formatting check.
  const both = [...NEW_LANES].filter((k) => GOLDEN[k]);
  assert.deepEqual(both, [], `declared new but pinned by the golden master: ${both.join(', ')}`);
});

// Lanes that have deliberately GAINED columns since the capture. The golden's guarantee is "no
// silent restyle", not "no lane may ever grow": for these the captured html must still be a strict
// PREFIX of what the lane derives today, so every original column is proven byte-identical and the
// growth is proven to be growth. Re-baselining the golden instead would retire the check entirely,
// which is what makes the prefix worth the extra branch.
const WIDENED = new Map([
  ['supplyChain', 'D15 2026-08-26 — claimKind/sevReason appended so an undetermined row says why'],
  ['secrets', '2026-08-29 — context/publicByDesign appended. NOT a new capability: extractors.mjs:1317 '
    + 'already emitted both and the container thead already declared both; the schema was the one '
    + 'declaration of the three that had not caught up, so the lane derived 10 columns against a '
    + 'thead of 12 and its own count guard went red. Widening rather than trimming the thead is the '
    + 'deliberate half — publicByDesign is WHY sev is null on those rows (extractors.mjs:1306), so '
    + 'dropping it would leave an empty severity with no stated reason, which reads as a missing '
    + 'verdict rather than a deliberate one. The prefix check below still proves every original '
    + 'column byte-identical.'],
  ['sastGo', '2026-09-01 — cwe/corroboratedBy appended. cwe is sarif-read.mjs\'s cweOf(), read from '
    + 'the rule metadata gosec already ships and previously dropped at the door (see sarif-read.mjs\'s '
    + 'own header). corroboratedBy is meta-SAST: monitor/corroborate.mjs\'s markSastPlaceCorroboration '
    + 'flags when another SAST tool hit the same file (tightened to [cwe] when both share a CWE). '
    + 'Neither is a restyle of rule/file/line/sev/message; the thead in admin/index.html was widened '
    + 'to match (Weakness, Corroborated by).'],
]);

test('a widened lane is a lane that has a reference to widen', () => {
  const phantom = [...WIDENED.keys()].filter((k) => !GOLDEN[k]);
  assert.deepEqual(phantom, [], `declared widened but never pinned: ${phantom.join(', ')}`);
});

// THE acceptance test. Byte-equality is achievable here precisely because LANE_FORMAT declares the
// deviations rather than normalising them away; a mismatch means the derivation would have silently
// restyled that lane.
for (const t of perRow.filter((x) => GOLDEN[x.key])) {
  test(`derived rows match the retired renderer's output for '${t.key}'`, () => {
    const g = GOLDEN[t.key];
    const got = derived(t.key, g.fixture);
    if (!WIDENED.has(t.key)) {
      assert.equal(got, g.html,
        `lane '${t.key}' renders differently once derived — declare the deviation in LANE_FORMAT rather than accepting a restyle`);
      return;
    }
    // A TRAILING `extra` COLUMN BREAKS A NAIVE PREFIX, and the break is structural rather than a
    // restyle. laneColumns() pushes the `extra` cell (Annotation) AFTER every schema field, so a
    // lane that gains a field has it land BEFORE that cell and shifts it one right — which a raw
    // startsWith reads as "a column you already had changed". supplyChain never hit this because it
    // declares no `extra`; secrets is the first lane to widen while carrying one.
    //
    // The property the guard actually wants is unchanged: every column the lane already had renders
    // byte-identically, and growth is growth. So compare both sides with that trailing cell removed,
    // and ONLY for lanes that declare one — every other lane keeps the strict prefix it had. This
    // is a generalisation, not a relaxation: the cells being compared are the same cells, and a
    // genuine restyle of any pre-existing column still fails.
    const dropExtraCell = (html) => {
      const i = html.lastIndexOf('<td');
      return i < 0 ? html : html.slice(0, i);
    };
    const hasExtra = !!(LANE_FORMAT[t.key] || {}).extra;
    const [gotCmp, goldCmp] = hasExtra ? [dropExtraCell(got), dropExtraCell(g.html)] : [got, g.html];
    assert.ok(gotCmp.startsWith(goldCmp),
      `widened lane '${t.key}' changed a column it already had — widening appends, it does not restyle`);
    assert.ok(got.length > g.html.length,
      `lane '${t.key}' is declared widened (${WIDENED.get(t.key)}) but derives nothing beyond its reference`);
  });
}

test('the derived column count matches the lane\'s declared cols', () => {
  for (const t of perRow) {
    const n = laneColumns(t.key, SCHEMA[t.key]).length;
    // A generic lane shares one container that has NO static thead — its `cols` is only the
    // colspan used for the empty/void message before the schema arrives, and the renderer
    // overwrites it once it can count real columns. Asserting equality there would be asserting
    // a placeholder. What matters is that it derives a usable table at all.
    if (t.generic) { assert.ok(n >= 2, `generic lane '${t.key}' derives only ${n} column(s)`); continue; }
    assert.equal(n, t.cols, `lane '${t.key}' derives ${n} columns but its container's thead declares ${t.cols}`);
    // The thead check above stays strict for every lane — a widened lane must still have had its
    // markup widened to match. Only the reference relaxes, and only upward.
    if (GOLDEN[t.key] && WIDENED.has(t.key)) {
      assert.ok(n > GOLDEN[t.key].cols,
        `lane '${t.key}' is declared widened but derives ${n} of ${GOLDEN[t.key].cols} columns — that is a LOSS`);
    } else if (GOLDEN[t.key]) {
      assert.equal(n, GOLDEN[t.key].cols, `lane '${t.key}' column count drifted from the captured reference`);
    }
  }
});

test('repo leads every lane and is presentation metadata, not a schema field', () => {
  for (const t of perRow) {
    assert.equal(laneColumns(t.key, SCHEMA[t.key])[0].label, 'Service');
    assert.ok(!SCHEMA[t.key].columns.some((c) => c.name === 'repo'),
      `'${t.key}' declares repo in its schema; the rollup already prepends it when flattening, so both paths would emit it`);
  }
});

test('a hostile value cannot inject markup through any derived cell', () => {
  for (const t of perRow) {
    const f = fixture(t.key);
    for (const c of SCHEMA[t.key].columns) if (typeof f[c.name] === 'string') f[c.name] = '<img src=x onerror=alert(1)>';
    const html = derived(t.key, f);
    assert.ok(!html.includes('<img'), `lane '${t.key}' let unescaped markup through: ${html.slice(0, 160)}`);
  }
});

// ── THE SHARED CONTAINER ────────────────────────────────────────────────────────────────────────
// Eleven lanes write into one container, so which lane is on screen decides what it holds. Nothing
// exercised that path until it broke: LANE_TITLE was declared inside a function while
// renderScannerTabs sits at module scope, so the renderer threw ReferenceError the moment anyone
// opened a generic lane — and every existing test passed, because the harness only ever set
// curView to a NON-generic view, where generic lanes take the early return and touch none of it.
// A path that only runs when a specific tab is open needs a test that opens that tab.
const escFn = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderWith(curView, state) {
  const ageAt = SRC.indexOf('const age=(iso)=>');
  const fnAt = SRC.indexOf('function renderScannerTabs(d){');
  const ageSrc = SRC.slice(ageAt, SRC.indexOf(';\n', SRC.indexOf("'d old'", ageAt)) + 1);
  const body = SRC.slice(SRC.indexOf('const DETAIL_CELL='), SRC.indexOf('\n}', fnAt) + 2);
  const els = {};
  const el = (id) => (els[id] ||= { id, innerHTML: '', textContent: '' });
  const badges = {};
  const render = new Function('$', 'setTabN', 'esc', 'sevPill', 'curView',
    `${ageSrc}\n${body}\nreturn renderScannerTabs;`)(el, (v, n) => { badges[v] = n; }, escFn, (x) => `<span>${x}</span>`, curView);
  render({ detailSchema: SCHEMA, ...state });
  return { el, badges };
}

const GENERIC = SCANNER_TABS.filter((t) => t.generic);

/** renderWith, named for the fixed-container lanes it exercises. */
const harnessTabs = (curView, state) => renderWith(curView, state);

test('a generic lane on screen fills the shared container', () => {
  assert.ok(GENERIC.length >= 5, `only ${GENERIC.length} generic lanes — the registration changed`);
  const t = GENERIC.find((x) => x.key === 'stubs') || GENERIC[0];
  const { el } = renderWith(t.view, { scanners: {}, scannerFindings: {} });
  assert.notEqual(el('lane-title').textContent, '—', 'the shared container kept its placeholder heading — the active lane never wrote to it');
  assert.match(el('lane-cov').innerHTML, /never scanned here/, 'a category the results never spoke for must say so, not render blank');
});

test('a generic lane NOT on screen writes nothing but still reports its badge', () => {
  const t = GENERIC[0];
  const { el, badges } = renderWith('overview', {
    scanners: { [t.key]: { total: 7, ran: 2, skipped: 0, noscan: 0 } }, scannerFindings: { [t.key]: [] },
  });
  assert.equal(el('lane-title').textContent, '', 'an off-screen lane must not write into the shared container');
  assert.equal(badges[t.view], 7, 'its badge comes from `scanners`, not from the DOM, so it survives not being rendered');
});

test('every generic lane can render without throwing', () => {
  // The ReferenceError above was in a branch shared by all eleven; one passing lane is not evidence.
  for (const t of GENERIC) {
    const rows = [Object.fromEntries(SCHEMA[t.key].columns.map((c) => [c.name, c.type === 'int' ? 1 : 'v']))];
    const { el } = renderWith(t.view, {
      scanners: { [t.key]: { total: 1, ran: 1, skipped: 0, noscan: 0 } },
      scannerFindings: { [t.key]: rows.map((r) => ({ repo: 'clientD', ...r })) },
    });
    assert.match(el('lane-thead').innerHTML, /<th>/, `lane '${t.key}' derived no column headings`);
    assert.match(el('lane-rows').innerHTML, /<tr>/, `lane '${t.key}' rendered no rows for a finding it has`);
  }
});

// ── WHEN THE ROLLUP DISAGREES WITH ITSELF ───────────────────────────────────────────────────────
// Found by sweeping every rollup on disk rather than by reading the code: three categories carried
// run provenance saying nothing was scanned (ran=0) while holding findings anyway —
// clientD/denoLint 821 rows, 100randomrepos/denoLint 2,430, an internal project's shellLint 1. The panel
// rendered the void banner INSTEAD of the table and cleared the badge, so 3,252 findings read as
// "nothing scanned". The n/a variant was worse: it asserted there was no target for the check
// while holding thousands of findings from that target.
//
// The panel cannot know which side is wrong. It must not settle the argument by hiding one of them.
const VOID_WITH_ROWS = {
  scanners: { secrets: { total: 821, ran: 0, skipped: 0, noscan: 1 } },
  scannerFindings: { secrets: [{ repo: 'clientD', rule: 'r', file: 'a.js', line: 1, commit: 'abc' }] },
};

test('a void that is holding rows renders the rows, not a "nothing scanned" banner', () => {
  const h = harnessTabs('secrets', VOID_WITH_ROWS);
  assert.match(h.el('sec-rows').innerHTML, /<tr/, 'the rows the lane is holding must render');
  assert.doesNotMatch(h.el('sec-rows').innerHTML, /nothing scanned/,
    'the void message must not stand in place of a populated table');
});

test('...and says so, rather than picking a side', () => {
  const h = harnessTabs('secrets', VOID_WITH_ROWS);
  const cov = h.el('sec-cov').innerHTML;
  assert.match(cov, /CONTRADICTION — provenance vs evidence/);
  assert.match(cov, /ran 0 of/, 'the provenance claim is real and stays stated');
  assert.match(cov, /821 finding\(s\) anyway/, 'so does the evidence that contradicts it');
  assert.match(cov, /cannot tell which/, 'the panel must not assert a resolution it does not have');
  // The wording comes from the SHARED COV_COPY, so the Overview's row for this same category says
  // the same thing. A contradiction recognised by one surface and not another would be the panel
  // contradicting itself about the contradiction.
  assert.match(SRC, /if\(st==='contradiction'\)return \{cls:'crit'/,
    'the copy must live in COV_COPY, not in a single renderer');
  assert.match(SRC, /if\(Number\(s\.total\)>0\)return 'contradiction';/,
    'the STATE must live in covState, so every surface classifies it identically');
});

test('the badge is not cleared over findings the lane holds', () => {
  const h = harnessTabs('secrets', VOID_WITH_ROWS);
  assert.equal(h.badges.secrets, 821,
    'a null badge over 821 findings is the same lie, moved into the tab strip');
});

test('a GENUINE void — ran=0 and no rows — still renders exactly as before', () => {
  // The guard must not become a way to bypass a real void.
  const h = harnessTabs('secrets', {
    scanners: { secrets: { total: 0, ran: 0, skipped: 4, noscan: 2 } }, scannerFindings: { secrets: [] },
  });
  assert.match(h.el('sec-rows').innerHTML, /nothing scanned/);
  assert.doesNotMatch(h.el('sec-cov').innerHTML, /CONTRADICTION/);
  assert.equal(h.badges.secrets, null, 'a real void still clears its badge');
});

// ── MORE SUPPRESSED THAN EXIST ──────────────────────────────────────────────────────────────────
// clientD/secrets rendered "80 annotated" over a total of 3; commitwork-admin/sastCodeql 6 over 1.
// Annotations outliving the findings they were written against: a fix lands, the finding goes, the
// acceptance stays. Printed bare it reads as a suppression count.
// THE REVERSE OF WHAT THIS ONCE ASSERTED. It required a CRITICAL whenever annotated > total, on the
// reading that "more acceptances than findings" meant acceptances outliving their findings. It does
// not: rollup.mjs subtracts each applied record from `total` and adds it to `annotated`, so total is
// already net of suppressions and annotated counts rows it really matched. annotated > total says
// only "over half of this lane is adjudicated" — the normal end state of a worked lane, and on
// commitwork-admin/secrets (20 annotated, 1 open, all 20 matching rows on the page) it published a
// CRITICAL over the best outcome a lane can reach. The genuine signal — records that matched
// nothing — is annotationHealth.orphaned, aggregated fleet-wide in serve.mjs and rendered already.
test('a fully-adjudicated lane is NOT a critical — over-reporting is not the safe direction', () => {
  const h = harnessTabs('secrets', {
    scanners: { secrets: { total: 1, ran: 5, skipped: 0, noscan: 0, annotated: 20 } },
    scannerFindings: { secrets: [{ repo: 'clientD', rule: 'r', file: 'a.js', line: 1, commit: 'abc' }] },
  });
  const cov = h.el('sec-cov').innerHTML;
  assert.doesNotMatch(cov, /more acceptances than findings/,
    'a lane whose findings have all been judged must not be graded as an anomaly for it');
  assert.doesNotMatch(cov, /pill crit/,
    'a fabricated critical costs more than a missed one — it is the number a reader can check');
  assert.match(cov, /20 annotated<\/span>/, 'the suppression count is still disclosed, plainly');
});

test('an ordinary annotation count keeps its ordinary wording', () => {
  const h = harnessTabs('secrets', {
    scanners: { secrets: { total: 10, ran: 2, skipped: 0, noscan: 0, annotated: 3 } },
    scannerFindings: { secrets: [{ repo: 'clientD', rule: 'r', file: 'a.js', line: 1, commit: 'abc' }] },
  });
  assert.match(h.el('sec-cov').innerHTML, /3 annotated<\/span>/);
  assert.doesNotMatch(h.el('sec-cov').innerHTML, /more acceptances than findings/);
});

// ── A GROUP IS NOT A FINDING ────────────────────────────────────────────────────────────────────
// Reported 2026-08-26 from the live panel: SAST · Semgrep read "3 finding(s)" over ONE row with no
// file, no line, and nothing saying two more sites existed. Cause: rows are derived from
// detailSchema now, and that derivation was applied to GROUPED lanes too. groupSarif collapses
// identical diagnoses into {rule, sev, message, sites[]}; file and line move into the sites. A
// schema renderer expecting flat `file`/`line` reads undefined on both and never looks at sites.
test('a grouped lane renders through its GROUP renderer, not the schema derivation', () => {
  const src = panelSource('index.html');
  assert.match(src, /const cell=\(t\.group&&t\.row\)\?t\.row:\(cols\?/,
    'a lane that declares group:true carries a row renderer that understands the grouped shape, and '
    + 'that renderer must win over schema derivation — the schema describes a finding, not a group');
});

test('the grouped shape genuinely lacks what the schema would render, so the two are not interchangeable', () => {
  const cols = panelSchema().sastSemgrep.columns.map((c) => c.name);
  assert.deepEqual(cols, ['rule', 'file', 'line', 'sev', 'message', 'cwe', 'corroboratedBy'], 'schema pins the flat finding shape');
  // What groupSarif emits, by construction: identity fields plus sites.
  const group = { rule: 'r', sev: 'med', message: 'm', sites: [{ repo: 'a', file: 'x.html', line: 18 }] };
  for (const missing of ['file', 'line']) {
    assert.ok(!(missing in group),
      `a group has no '${missing}' — rendering it through the schema draws an empty cell and discards every site`);
  }
});

// ── THE PERF TABLE IS SECTIONED, AND THE SECTIONS ARE DERIVED ───────────────────────────────────
// Forty-four lanes in one flat list is a table an operator scrolls rather than reads. The grouping
// comes from the registries the nav strip already uses — d.scannerRegistry joins the perf payload's
// CHECK id to the rollup CATEGORY, SCANNER_TABS maps that to a view, TAB_GROUPS to a section — so a
// lane cannot sit in one place here and another in the strip.
test('the perf sections are joined through the published registry, never inferred from a lane name', () => {
  const src = panelSource('index.html');
  assert.match(src, /function perfGroupFor\(checkId,reg\)\{/);
  assert.match(src, /\(Array\.isArray\(reg\)\?reg:\[\]\)\.find\(r=>r&&r\.check===checkId\)/,
    'the check-to-category hop must come from the payload registry — a fourth hand-maintained list '
    + 'beside the three that exist is the drift this repo keeps rediscovering');
  assert.ok(!/startsWith\('sast'\)|\/\^sast\//.test(src.slice(src.indexOf('function perfGroupFor'), src.indexOf('function perfRow'))),
    'no name-prefix heuristic: a lane whose place is unknown is STATED as unplaced, not guessed into a section');
});

test('a lane with no tab is kept and labelled, never dropped from a table that is its own denominator', () => {
  const src = panelSource('index.html');
  assert.match(src, /other:'No panel tab'/,
    'the fallback section names what is actually true of those lanes rather than calling them Other');
  assert.match(src, /these lanes RUN and have no tab of their own/,
    'and says why they are here — 18 of 44 lanes had no panel tab when this landed, which is a '
    + 'finding the table surfaces rather than smooths over');
  // The property that matters most: sectioning must not lose a row.
  assert.match(src, /return head\+list\.map\(x=>perfRow\(x\)\)\.join\(''\)/,
    'every row in a section renders; a lane silently missing from this table would be a lane an '
    + 'operator cannot switch off and cannot see');
});

// ── EVERY LANE GETS A TAB, AND THE TAB IS GENERATED ─────────────────────────────────────────────
// Seventeen of forty-three categories carried a row schema, ran, produced findings and had nowhere
// to render them — reachable only through the perf table. Adding each by hand meant six registries
// per lane (SCANNER_TABS, NATIVE, VALID_VIEWS, LANE_TITLE, PATH_VIEWS, PANEL_VIEWS), which is the
// count that reliably produces a lane present in five of them and silently absent from the sixth.
test('every category with a row schema gets a tab — generated, not hand-listed', async () => {
  const { SCANNER_SPECS, SCANNER_LABELS } = await import('../../monitor/extractors.mjs');
  const { derivedLaneTabs, laneSection, laneView } = await import('../../monitor/lane-tabs.mjs');
  const { panelSchema } = await import('../../monitor/detail-schema.mjs');
  const html = panelSource('index.html');
  const hand = new Set([...html.matchAll(/\{\s*key:\s*'([A-Za-z0-9]+)'\s*,\s*view:/g)].map((m) => m[1]));
  const cats = SCANNER_SPECS.map(([k]) => k);
  const schema = panelSchema();

  const ungiven = cats.filter((c) => !hand.has(c) && !(schema[c] && schema[c].columns && schema[c].columns.length));
  assert.deepEqual(ungiven, [],
    'a category with neither a hand-written tab nor a row schema can be rendered nowhere — it would '
    + 'run, find things, and be invisible outside the perf table');

  // The generator must not re-add a tab the page already writes, or the strip doubles.
  const sent = derivedLaneTabs(cats, [], (c) => SCANNER_LABELS[c]);
  assert.equal(sent.length, cats.length, 'the server sends every category; the panel takes the complement');
  assert.ok(sent.every((t) => t.view === laneView(t.key)), 'the view slug is derived from the id, not invented');
  assert.ok(sent.every((t) => t.section === laneSection(t.key)));
});

test('a lane nobody classified renders under a section that SAYS so, rather than vanishing', async () => {
  const { laneSection, derivedLaneTabs } = await import('../../monitor/lane-tabs.mjs');
  assert.equal(laneSection('someLaneAddedTomorrow'), 'other',
    'an unclassified lane must still get a placement — the alternative is a tab that never renders');
  const t = derivedLaneTabs(['someLaneAddedTomorrow'], [], () => null)[0];
  assert.equal(t.derived, true, 'and it is marked derived, so a reader can tell a generated tab from an authored one');
  assert.equal(t.label, 'someLaneAddedTomorrow', 'with no label available it falls back to the id rather than to blank');
});

test('the panel keeps declared and derived placements APART, and rebuilds its path table', () => {
  const html = panelSource('index.html');
  assert.match(html, /const TAB_GROUPS_EXTRA=\{\};/,
    'generated placements live in their own map — merging them into the frozen TAB_GROUPS would make '
    + 'a derived placement indistinguishable from a declared one');
  assert.match(html, /hasOwnProperty\.call\(TAB_GROUPS_EXTRA,v\)/, 'and groupOf consults both');
  assert.match(html, /function rebuildViewPaths\(\)\{ PATH_VIEWS=buildPathViews\(\); \}/,
    'PATH_VIEWS must be rebuilt after tabs are added — a path table computed once 404s every tab the '
    + 'page just drew, which is a link the user can see and the router denies');
  assert.match(html, /if\(!cols\|\|!cols\.length\)continue;/,
    'no schema, no tab: a generated tab whose cells cannot be derived would render an empty table '
    + 'under a heading promising findings');
});

// ── AN EMPTY LANE OFFERS THE THING THAT WOULD FILL IT ───────────────────────────────────────────
// A lane with no record rendered a grey sentence in a table cell, which reads as "nothing here" —
// the false clean this page refuses everywhere else. It is now a centred panel that says WHICH kind
// of nothing, and offers a run only where running is the answer.
test('the three void states say different things, and only never-run offers a run', () => {
  const html = panelSource('index.html');
  const grab = (re) => { const m = html.match(re); assert.ok(m, `missing ${re}`); return m[0]; };
  // laneCheckId is extracted, not stubbed. A stub returning 'some-check' would assert that the panel
  // renders a button when TOLD there is a check — which is not the question. The question is whether
  // a real registry resolves one.
  const src = [grab(/const LANE_VOID_COPY=\{[\s\S]*?\n\};/),
    grab(/function laneVoidPanel\(t,why,detail,registry\)\{[\s\S]*?\n\}/),
    grab(/function laneCheckId\(cat,registry\)\{[\s\S]*?\n\}/)].join('\n');
  const esc = (x) => String(x ?? '');
  const { laneVoidPanel } = new Function('esc', 'LANE_TITLE',
    `${src}; return { laneVoidPanel };`)(esc, { x: 'X' });
  const REG = [{ key: 'x', check: 'deps-osv' }];

  assert.match(laneVoidPanel({ key: 'x' }, 'never-run', null, REG), /lane-run/,
    'never run is the one state where the panel should offer to change it');
  for (const why of ['not-applicable', 'blocked']) {
    assert.ok(!/lane-run/.test(laneVoidPanel({ key: 'x' }, why, null, REG)),
      `${why}: running would not change the answer, and a button that cannot help is worse than none`);
  }
  // three distinct headings — the operator's next action differs in each
  const heads = ['never-run', 'not-applicable', 'blocked']
    .map((w) => (laneVoidPanel({ key: 'x' }, w, null, REG).match(/<h3>([^<]*)/) || [])[1]);
  assert.equal(new Set(heads).size, 3, 'each state must read differently, or the distinction is decoration');
});

test('no check id, no run button — the server would refuse it anyway', () => {
  const html = panelSource('index.html');
  const grab = (re) => html.match(re)[0];
  const src = [grab(/const LANE_VOID_COPY=\{[\s\S]*?\n\};/),
    grab(/function laneVoidPanel\(t,why,detail,registry\)\{[\s\S]*?\n\}/),
    grab(/function laneCheckId\(cat,registry\)\{[\s\S]*?\n\}/)].join('\n');
  const { laneVoidPanel } = new Function('esc', 'LANE_TITLE',
    `${src}; return { laneVoidPanel };`)((x) => String(x ?? ''), {});
  // a registry that knows OTHER lanes but not this one, and a registry that is absent entirely:
  // both must answer "no button", and only the second is the case anyone thinks to test
  for (const reg of [[{ key: 'other', check: 'sast' }], [], null, undefined]) {
    assert.ok(!/lane-run/.test(laneVoidPanel({ key: 'x' }, 'never-run', null, reg)),
      'an unresolvable check id must not render a button: sweep.mjs reads an unrecognised value as a '
      + 'GROUP name and would scan something other than what the button said');
  }
});

test('a lane-scoped sweep validates its check against the declared ids', async () => {
  const { SCANNER_CHECKS } = await import('../../monitor/scanner-checks.mjs');
  const serve = serverSource();
  assert.match(serve, /const KNOWN_CHECKS = new Set\(Object\.values\(SCANNER_CHECKS\)\);/,
    'the accepted set is derived from the one declaration, not a second list beside it');
  assert.match(serve, /if \(!KNOWN_CHECKS\.has\(check\)\)/, 'and an unknown check is refused');
  // The values that must NOT pass are group names — the ones sweep.mjs would happily act on.
  const known = new Set(Object.values(SCANNER_CHECKS));
  for (const group of ['all', 'fast', 'deep', 'supply-chain']) {
    assert.ok(!known.has(group),
      `${group} is a sweep GROUP: accepting it here would run a whole group from a button that named one lane`);
  }
});
