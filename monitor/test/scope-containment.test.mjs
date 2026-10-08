// node --test monitor/test/  — SCOPE CONTAINMENT: a scoped sweep of area P writes nothing outside
// reports/<P.out>/ and its own batch dir; CW_MONITOR_OUT is an absolute override that wins.
// Hermetic: only os.tmpdir() is written; children run with globalThis.fetch removed.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, areaOut, allAreas } from '../registry.mjs';
import { expandHome } from '../discover.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const REPORTS = join(CW, 'reports');
const REG = loadRegistry({ quiet: true });
const NO_FETCH = 'data:text/javascript,globalThis.fetch = undefined;';
const BATCH_RE = /^sweep-\d{14}(-[a-z0-9-]+)?$/;

// ── the routing probe: sweep --dry, which resolves OUT and then runs nothing ─────────────────────
function dryRun(project, env = {}) {
  const args = ['--import', NO_FETCH, join(CW, 'monitor/sweep.mjs'), 'fast'];
  if (project !== null) args.push(project);
  args.push('--dry');
  // exit 2 (refused scope) is a legitimate outcome — surface it as data, don't throw
  let out;
  try {
    out = execFileSync(process.execPath, args,
      { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_SKIP_SETUP: '1', ...env } });
  } catch (e) {
    const text = `${e.stdout || ''}${e.stderr || ''}`;
    if (e.status === 2 && /cannot resolve .* to an area/.test(text)) return { refused: true, raw: text };
    throw e;
  }
  const m = /^\[sweep\] scope=(.*) · out=(.*)$/m.exec(out);
  assert.ok(m, `sweep --dry printed no scope/out line for project=${project}:\n${out}`);
  const repos = [...out.matchAll(/^ {2}(\S+) {2}\[/gm)].map((x) => x[1]);
  return { scope: m[1], out: m[2], repos, raw: out };
}

// ── snapshots: every durable artifact that a mis-routed write would land in ──────────────────────
const sha = (p) => { try { return createHash('sha256').update(readFileSync(p)).digest('hex'); } catch { return 'ABSENT'; } };
const DURABLE = ['rollup.json', 'lifecycle.json', 'cwx-registry.json', 'remediation-ledger.json',
  'dashboard.html', 'REMEDIATION.md', 'history/index.json', 'history/LOG.md'];

// area dirs = everything under reports/ that is NOT a batch dir and not a file
function areaDirs() {
  if (!existsSync(REPORTS)) return [];
  return readdirSync(REPORTS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !BATCH_RE.test(e.name)).map((e) => e.name).sort();
}

function snapshotReports() {
  const snap = { entries: [], artifacts: {} };
  if (!existsSync(REPORTS)) return snap;
  for (const e of readdirSync(REPORTS, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = join(REPORTS, e.name);
    let st; try { st = statSync(p); } catch { continue; }
    snap.entries.push(`${e.isDirectory() ? 'd' : 'f'} ${e.name} mtime=${st.mtimeMs} size=${e.isDirectory() ? '-' : st.size}`);
  }
  for (const a of areaDirs()) for (const f of DURABLE) snap.artifacts[`${a}/${f}`] = sha(join(REPORTS, a, f));
  // the shared, non-area-scoped caches a rollup can also reach (rollup.mjs:229)
  const dataDir = join(CW, 'monitor/data');
  if (existsSync(dataDir)) for (const f of readdirSync(dataDir).sort()) snap.artifacts[`monitor/data/${f}`] = sha(join(dataDir, f));
  return snap;
}

function diffSnapshots(a, b) {
  const out = [];
  if (a.entries.join('\n') !== b.entries.join('\n')) {
    const sa = new Set(a.entries), sb = new Set(b.entries);
    for (const e of b.entries) if (!sa.has(e)) out.push(`reports/ entry appeared or changed: ${e}`);
    for (const e of a.entries) if (!sb.has(e)) out.push(`reports/ entry vanished or changed: ${e}`);
  }
  for (const k of new Set([...Object.keys(a.artifacts), ...Object.keys(b.artifacts)])) {
    if (a.artifacts[k] !== b.artifacts[k]) out.push(`${k}: ${String(a.artifacts[k]).slice(0, 12)} -> ${String(b.artifacts[k]).slice(0, 12)}`);
  }
  return out;
}

// real containment, not a string prefix test
function inside(child, parent) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

// ── the routing table: project arg -> the ONE area dir it may write to ───────────────────────────
const ROUTES = [
  // Was a declared standalone repo until the anonymisation pass renamed it; `client-d` is not in
  // the registry, so what this row now proves is that an UNDECLARED name still routes to its own
  // dir and borrows nobody's. Still worth asserting — but for that reason, not the one it used to
  // give, and a row whose rationale has quietly gone false is how a table stops being read.
  ['client-d', 'client-d', 'reports/client-d', 'undeclared name — gets its own dir, borrows none'],
  ['internal-b-dev', 'internal-b-dev', 'reports/internal-b-dev', 'registry entry, area === name'],
  // The fleet area is found by SHAPE (several members, prefixes, out != slug), never by name: the
  // private registry carries real member names and the tracked tree the pseudonym, and a literal
  // here read the pseudonym as if the registry declared it. Rows cite positions, never names.
  ...(() => {
    const fleet = (REG.areas || []).filter((a) => (a.prefixes || []).length > 0 && (a.members || []).length > 1 && a.out && a.out !== a.slug);
    if (fleet.length !== 1) return [];
    const f = fleet[0]; const out = `reports/${f.out}`;
    return [
      [f.slug, f.slug, out, 'the AREA SLUG as the arg (sweep the fleet); out != slug'],
      [f.members[0], f.slug, out, 'fleet member #0 -> the fleet area, not its own dir'],
      [f.members[1], f.slug, out, 'fleet member #1 (THE BUG: must not get its own out dir)'],
      [`${f.prefixes[0]}zz-selection-probe`, f.slug, out, 'a prefix probe -> the fleet area'],
    ];
  })(),
];
const FLEET = (REG.areas || []).find((a) => (a.prefixes || []).length > 1 && (a.members || []).length > 1 && a.out && a.out !== a.slug) || null;
// the member whose repos share a prefix: the one prefix that names a member's children
const LIBS = FLEET && FLEET.members.find((m) => FLEET.prefixes.some((px) => px !== `${m}-` && m.endsWith('-libs')));
// Skipped only when a declared pause explains the missing member: an undeclared absence still
// reaches the assertion and fails.
const NO_LIBS = FLEET && !LIBS && FLEET.paused
  ? 'the fleet area is paused and declares no -libs member that resolves here, so there is no member-scoped sweep to contain'
  : undefined;


// A real single-repo area, RESOLVED FROM THE REGISTRY rather than named.
//
// Two reasons, and the second is why this changed. The first is the one already written against the
// primary-area test below: a literal asserts today's registry, not the contract. The second is that
// a literal here was a client's name, and an anonymisation pass rewrote it to `client-d` — which is
// not a project the registry has ever known, so the assertion went on reading as a containment
// check while actually asking whether a nonexistent area enumerates nothing. It does. The test
// passed nothing and would have kept passing nothing.
//
// (It was not passing, as it happens: the same pass renamed the BINDING too, `const client-d` is a
// syntax error, and this whole file stopped parsing. That is the only reason anybody found out.)
//
// Which area is used carries no meaning — any area with exactly one declared project proves the
// property, and deriving it keeps no client name in a tracked file.
const SOLO = (() => {
  const byArea = {};
  for (const p of (REG.projects || [])) {
    if (!p || !p.name) continue;
    const a = p.area || p.name;
    (byArea[a] ||= []).push(p);
  }
  const live = (p) => { try { return !!p.path && existsSync(expandHome(p.path)); } catch { return false; } };
  const hit = Object.entries(byArea).find(([, v]) => v.length === 1 && live(v[0]));
  return hit ? { area: hit[0], project: hit[1][0].name } : null;
})();
const NO_SOLO = SOLO ? undefined
  : 'no declared area on this machine has exactly one project whose path exists, so there is no '
    + 'single-repo area to prove containment against. Stated rather than skipped silently.';

// Skip the fleet-dependent suites where no registry path exists on this machine.
// undefined, NOT null: node:test reads `{ skip: null }` as SKIP.
const NO_FLEET = (loadRegistry({ quiet: true }).projects || [])
  .map((x) => x.path).filter(Boolean)
  .some((x) => { try { return existsSync(expandHome(x)); } catch { return false; } })
  ? undefined
  : 'no path declared in monitor/projects.json exists on this machine, so a scoped sweep has no '
    + 'repos to enumerate. These two suites are meaningful only where the fleet lives.';

describe('OUT routing — a scoped sweep resolves exactly one area dir', { skip: NO_FLEET }, () => {
  for (const [project, scope, out, why] of ROUTES) {
    test(`--project ${project} -> scope=${scope}, out=${out}  (${why})`, () => {
      const r = dryRun(project);
      assert.equal(r.scope, scope);
      assert.equal(r.out, out, `${project} routed to ${r.out}`);
      const abs = join(CW, r.out);
      assert.ok(inside(abs, REPORTS), `${project} resolved an OUT outside the reports root: ${abs}`);
      assert.equal(relative(REPORTS, abs), areaOut(scope, REG), 'the OUT dir must be exactly reports/<areaOut(scope)>');
    });
  }

  test('a scoped sweep enumerates ONLY its own area\'s repos', { skip: NO_SOLO }, () => {
    const solo = dryRun(SOLO.project);
    assert.deepEqual(solo.repos, [SOLO.project],
      `a ${SOLO.project}-scoped sweep enumerated ${solo.repos.join(', ') || 'nothing'}`);
  });

  test('a fleet member-scoped sweep enumerates the member and its prefixed children, nothing foreign', { skip: NO_SOLO || NO_LIBS }, () => {
    assert.ok(FLEET && LIBS, 'the fleet area declares a -libs member whose children share a prefix');
    const libs = dryRun(LIBS);
    assert.ok(libs.repos.length >= 1);
    // What a member-scoped sweep may enumerate: the member itself and repos under the area's
    // prefixes (its children where they are checked out beside it), and nothing from any other area.
    assert.ok(libs.repos.every((n) => n === LIBS || FLEET.prefixes.some((px) => n.startsWith(px))), `libs scope leaked non-libs repos: ${libs.repos.join(', ')}`);
    // Derived for the same reason: a literal foreign name here would pass whether or not the name
    // exists, and an absent name cannot leak.
    assert.ok(!libs.repos.includes(SOLO.project),
      `a fleet-scoped sweep enumerated a foreign area's repo: ${SOLO.project}`);
  });

  test('no two DECLARED areas share an out dir (a shared out is a guaranteed clobber)', () => {
    const outs = allAreas(REG).map((s) => areaOut(s, REG));
    assert.deepEqual([...new Set(outs)].sort(), outs.slice().sort(), `two areas resolve to the same reports/ dir: ${outs.join(', ')}`);
  });

  test('an unknown project name gets its OWN out dir, never a declared area\'s', () => {
    const r = dryRun('definitely-not-a-real-project-xyz');
    assert.equal(r.scope, 'definitely-not-a-real-project-xyz');
    assert.equal(r.out, 'reports/definitely-not-a-real-project-xyz');
    assert.equal(r.repos.length, 0, 'and it enumerates nothing');
    for (const a of allAreas(REG)) assert.notEqual(r.out, `reports/${areaOut(a, REG)}`, 'an unknown name must not borrow a declared area\'s dir');
  });

  test('the DEFAULT scope (no project arg) is the primary area, not the whole machine', () => {
    // DERIVED, not literal: this pinned 'client-a' until 2026-08-26, when that area was paused and
    // primary moved. A literal here asserts today's registry, not the contract — and the contract
    // is the one thing that must hold after the move.
    const want = REG.areas.find((a) => a.primary) || REG.areas[0];
    assert.ok(want, 'the fixture registry declares no area to be primary');
    const r = dryRun(null);
    assert.equal(r.scope, want.slug, 'a bare `sweep fast` must scope to the registry primary area');
    assert.equal(r.out, `reports/${areaOut(want.slug, REG)}`);
    assert.ok(!want.paused, 'the primary area is paused — a bare sweep would target something declared out of scope');
  });
});

describe('CW_MONITOR_OUT is an absolute override that WINS over registry routing', { skip: NO_FLEET }, () => {
  let scratch;
  before(() => { scratch = mkdtempSync(join(tmpdir(), 'cw-fixture-out-')); });
  after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

  test('it overrides the out dir for every project in the routing table', () => {
    for (const [project] of ROUTES) {
      const r = dryRun(project, { CW_MONITOR_OUT: scratch });
      assert.equal(r.out, scratch, `CW_MONITOR_OUT lost to registry routing for ${project} (got ${r.out}) — the verification-fixture seam is broken`);
      assert.ok(!inside(resolve(r.out), REPORTS), 'the fixture OUT must be able to sit entirely outside reports/');
    }
  });

  test('the scope is still resolved and reported — the override changes WHERE, not WHAT', { skip: NO_SOLO }, () => {
    const r = dryRun(SOLO.project, { CW_MONITOR_OUT: scratch });
    assert.equal(r.scope, SOLO.area);
    assert.deepEqual(r.repos, [SOLO.project],
      'the override moved the OUT dir and took the repo enumeration with it');
  });

  test('a relative CW_MONITOR_OUT is resolved to an absolute path, not joined onto reports/', () => {
    const r = dryRun('client-d', { CW_MONITOR_OUT: 'some/fixture/dir' });
    const abs = resolve(CW, 'some/fixture/dir'); // the child's cwd is CW
    assert.ok(r.out === abs || r.out === relative(CW, abs), `relative CW_MONITOR_OUT resolved to ${r.out}, expected ${abs} (or its CW-relative print form)`);
    assert.ok(!inside(abs, REPORTS), 'and it must NOT have been re-rooted under reports/');
  });
});

describe('the write path — nothing lands outside the resolved OUT', () => {
  // reports/ has other writers, so fail only on changes that repeat in every dry window and no
  // control window. Key changes by path, not diff string — mtimes vary per attempt.
  const changeKey = (s) => {
    const entry = /^reports\/ entry (?:appeared or changed|vanished or changed): [df] (\S+)/.exec(s);
    if (entry) return `entry:${entry[1]}`;
    const artifact = /^(.+?): [0-9a-f]+ ->/.exec(s) || /^(.+?): undefined ->/.exec(s);
    return artifact ? `artifact:${artifact[1]}` : `raw:${s}`;
  };

  test('a --dry sweep writes NOTHING: no batch dir, no area dir, no artifact touched', async (t) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const attempts = [];

    for (let i = 0; i < 3; i++) {
      // WINDOW D — the dry runs happen inside this one.
      const t0 = Date.now();
      const beforeDry = snapshotReports();
      for (const [project] of ROUTES) dryRun(project);
      dryRun('definitely-not-a-real-project-xyz');
      const dryChanged = diffSnapshots(beforeDry, snapshotReports());
      const span = Math.max(Date.now() - t0, 50);

      // a clean window settles it — a --dry that writes cannot produce one
      if (!dryChanged.length) return;

      // WINDOW C — control: matched duration, no dry run; whatever moves here is somebody else.
      const beforeCtl = snapshotReports();
      await sleep(span);
      const ctlChanged = diffSnapshots(beforeCtl, snapshotReports());

      const ambient = new Set(ctlChanged.map(changeKey));
      const attributable = dryChanged.filter((s) => !ambient.has(changeKey(s)));
      // Nothing survived attribution: everything that moved was moving anyway.
      if (!attributable.length) { attempts.push({ dryChanged, ctlChanged, attributable: [] }); continue; }
      attempts.push({ dryChanged, ctlChanged, attributable });
    }

    // fail only on what was attributable in EVERY attempt
    const keySets = attempts.map((a) => new Set(a.attributable.map(changeKey)));
    const persistent = keySets.length ? [...keySets[0]].filter((k) => keySets.every((s) => s.has(k))) : [];

    if (!persistent.length) {
      t.diagnostic('reports/ had other writers throughout (changes per dry window: '
        + `${attempts.map((a) => a.dryChanged.length).join(', ')}; per control window: `
        + `${attempts.map((a) => a.ctlChanged.length).join(', ')}) — nothing was attributable to --dry in every attempt`);
      return;
    }
    const detail = attempts[attempts.length - 1].attributable.filter((s) => persistent.includes(changeKey(s)));
    assert.fail('--dry mutated the reports tree. This is attributable: the same path(s) changed in every dry '
      + 'window and in NO control window, so a concurrent sweep does not explain it:\n  '
      + `${detail.join('\n  ')}\n`);
  });

  describe('a scoped rollup into a scratch CW_MONITOR_OUT', () => {
    let state = null;
    const guard = (t) => { if (state.skip) { t.skip(state.skip); return true; } return false; };

    before(async () => {
      let batches = [];
      try {
        batches = readdirSync(REPORTS, { withFileTypes: true })
          .filter((e) => e.isDirectory() && BATCH_RE.test(e.name)).map((e) => e.name).sort();
      } catch { /* no reports/ */ }
      if (!batches.length) {
        state = { skip: `SKIPPED (not a silent pass): no stored sweep-<stamp>[-<area>] batch under ${REPORTS} to roll. Run \`node monitor/sweep.mjs fast <project>\` once, then re-run.` };
        return;
      }
      // smallest batch first; walk candidates until one rolls (exit 2 must not pass vacuously)
      const size = (n) => { let c = 0; const w = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { if (e.isDirectory()) w(join(d, e.name)); else c++; } }; try { w(join(REPORTS, n)); } catch {} return c; };
      const cands = batches.map((n) => ({ n, c: size(n) })).filter((b) => b.c > 1).sort((a, b) => a.c - b.c);
      const tried = [];
      for (const picked of cands.slice(0, 4)) {
        const out = mkdtempSync(join(tmpdir(), 'cw-contain-out-'));
        const t0 = Date.now();
        const snapBefore = snapshotReports();
        let code = 0, stderr = '';
        try {
          execFileSync(process.execPath, ['--import', NO_FETCH, join(CW, 'monitor/rollup.mjs'), join(REPORTS, picked.n)],
            { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CW_MONITOR_OUT: out } });
        } catch (e) { code = e.status ?? -1; stderr = String(e.stderr || ''); }
        if (code === 2 || code === 4) {
          // 2: empty batch · 4: no rollable repo dir — retention can decay a candidate mid-run; try the next
          tried.push(`${picked.n} (${code === 2 ? 'empty batch' : 'no rollable repo dir'})`);
          rmSync(out, { recursive: true, force: true });
          continue;
        }
        const snapAfter = snapshotReports();
        // control window: excludes concurrent writers' changes from attribution
        const span = Math.min(Math.max(Date.now() - t0, 50), 4000);
        const ctlBefore = snapshotReports();
        await new Promise((r) => setTimeout(r, span));
        const ambient = new Set(diffSnapshots(ctlBefore, snapshotReports()).map(changeKey));
        state = { batch: picked.n, out, snapBefore, snapAfter, code, stderr, ambient };
        return;
      }
      state = { skip: `SKIPPED (not a silent pass): no batch under ${REPORTS} holds rollable tool output — tried ${tried.join(', ') || 'none'}.` };
    });
    after(() => { if (state && state.out) rmSync(state.out, { recursive: true, force: true }); });

    test('the rollup succeeded (otherwise "nothing was written anywhere" passes vacuously)', (t) => {
      if (guard(t)) return;
      assert.equal(state.code, 0, `rollup of ${state.batch} exited ${state.code}: ${state.stderr.trim()}`);
    });

    test('it DID write the full artifact set into the scratch OUT', (t) => {
      if (guard(t)) return;
      for (const f of ['rollup.json', 'dashboard.html', 'REMEDIATION.md', 'lifecycle.json', 'history/index.json']) {
        assert.ok(existsSync(join(state.out, f)), `${f} missing from the scratch OUT — the write did not happen there`);
      }
      const r = JSON.parse(readFileSync(join(state.out, 'rollup.json'), 'utf8'));
      assert.ok(r.totals.repos >= 1);
    });

    test('every file it wrote is INSIDE the scratch OUT', (t) => {
      if (guard(t)) return;
      const outside = [];
      const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (!inside(p, state.out)) outside.push(p); if (e.isDirectory()) walk(p); } };
      walk(state.out);
      assert.deepEqual(outside, []);
    });

    test('NO other area was touched — every durable artifact hash and mtime is unchanged', (t) => {
      if (guard(t)) return;
      // the snapshot must actually be watching something, or "unchanged" is meaningless
      const watched = Object.entries(state.snapBefore.artifacts).filter(([, v]) => v !== 'ABSENT');
      assert.ok(state.snapBefore.entries.length > 0, 'snapshot captured no reports/ entries');
      assert.ok(watched.length >= 3, `snapshot is watching only ${watched.length} live artifacts — too few for this assertion to mean anything`);
      // drop changes that also moved in the control window — those belong to another writer
      const raw = diffSnapshots(state.snapBefore, state.snapAfter);
      const changed = raw.filter((s) => !state.ambient.has(changeKey(s)));
      if (raw.length && !changed.length) {
        t.diagnostic(`${raw.length} path(s) moved under reports/ during the rollup, all of them also moving in the `
          + 'control window — attributable to another writer, not to this rollup');
      }
      assert.deepEqual(changed, [],
        `a scoped rollup into ${state.out} mutated state outside it, and a concurrent writer does NOT explain it `
        + `(these paths moved during the rollup and not in the control window):\n  ${changed.join('\n  ')}\n`);
    });

    test('and the batch dir it read is unmodified (input is read-only)', (t) => {
      if (guard(t)) return;
      const b = `d ${state.batch} `;
      const before = state.snapBefore.entries.find((e) => e.startsWith(b));
      const after = state.snapAfter.entries.find((e) => e.startsWith(b));
      assert.equal(after, before, 'the rollup mutated its own input batch dir');
    });
  });
});

describe('OUT can never escape the reports root', () => {
  const TRAVERSALS = ['../evil', '../../tmp/evil', 'client-d/../client-a-monorepo', './evil', 'a/b/c'];
  test('a path-traversal project arg is refused or contained, never routed outside reports/',
    () => {
      for (const p of TRAVERSALS) {
        const r = dryRun(p);
        if (r.refused) continue; // refused outright — the strongest form of containment
        const abs = resolve(CW, r.out);
        assert.ok(inside(abs, REPORTS), `project arg ${JSON.stringify(p)} resolved OUT to ${abs}, outside ${REPORTS}`);
        assert.equal(relative(REPORTS, abs).includes(sep), false, `project arg ${JSON.stringify(p)} resolved OUT to a NESTED path ${abs}`);
        for (const a of allAreas(REG)) {
          assert.notEqual(abs, join(REPORTS, areaOut(a, REG)),
            `project arg ${JSON.stringify(p)} routed writes into the declared area ${a} — the clobber class this plan exists to close`);
        }
      }
    });
});
