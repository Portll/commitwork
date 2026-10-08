// Remediation tab triage prompts. Route: /api/remediation/prompts serves manifest text verbatim,
// joined with the project's rollup scanners; no category ⇒ live:null, never a fabricated zero.
// Render: findings first, VOID/no-signal collapsed but present, hostile text escaped.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const CW = join(HERE, '..', '..');
const INDEX_SRC = panelSource('index.html');
const TMP = mkdtempSync(join(tmpdir(), 'cw-rp-'));

// Expected prompts computed the way the route computes them — asserts fidelity to disk, not to a
// copy that would go stale.
function expectedPrompts() {
  const named = ['branch-protection', 'build-health', 'quality-gates', 'runtime', 'security-baseline']
    .filter((n) => existsSync(join(CW, 'manifests', `${n}.json`))).sort();
  const byCheck = new Map();
  for (const name of named) {
    let j; try { j = JSON.parse(readFileSync(join(CW, 'manifests', `${name}.json`), 'utf8')); } catch { continue; }
    for (const c of (Array.isArray(j.checks) ? j.checks : [])) {
      if (!c.remediationPrompt || byCheck.has(c.id)) continue;
      byCheck.set(c.id, { check: c.id, manifest: name, prompt: c.remediationPrompt });
    }
  }
  return byCheck;
}

const FIXTURE_SCANNERS = {
  secrets: { crit: 0, high: 5, med: 0, low: 0, total: 5, repos: 1, ran: 1, skipped: 0, noscan: 0, check: 'secrets-gitleaks' },
  supplyChainHeuristic: { crit: 0, high: 0, med: 0, low: 0, total: 0, repos: 1, ran: 0, skipped: 1, noscan: 0, check: 'supply-chain-guarddog' },
};

let localPort, child;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hit = (path) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port: localPort, path, method: 'GET' }, (res) => {
    let buf = '';
    res.setEncoding('utf8');
    res.on('data', (d) => { buf += d; });
    res.on('end', () => { let json = null; try { json = JSON.parse(buf); } catch { /* html */ } resolve({ status: res.statusCode, body: buf, json }); });
  });
  req.on('error', reject);
  req.end();
});

before(async () => {
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'), monitorOutput: 'fixarea',
    defaultManifest: 'security-baseline', roots: [], projects: [],
    areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true }],
  }));
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  writeFileSync(join(TMP, 'reports', 'fixarea', 'rollup.json'), JSON.stringify({
    generated: '2026-08-02T00:00:00.000Z', totals: { repos: 1 }, scanners: FIXTURE_SCANNERS, repos: [],
  }));
  const port = await freePort();
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: { ...process.env, CW_AUTH_STORE: join(TMP, 'users.json'), CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port), CW_ADMIN_LOCAL_PORT: String(localPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let up = false;
  for (let i = 0; i < 100 && !up; i++) {
    try { up = (await hit('/api/csrf')).status === 200; } catch { /* not up yet */ }
    if (!up) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(up, 'panel did not come up against the fixture registry');
});
after(() => { child?.kill('SIGKILL'); rmSync(TMP, { recursive: true, force: true }); });

describe('route — /api/remediation/prompts', () => {
  test('every prompt is the manifest text verbatim, and every manifest prompt is served', async () => {
    const expected = expectedPrompts();
    assert.ok(expected.size >= 5, `only ${expected.size} prompts on disk — the fixture premise changed`);
    const r = await hit('/api/remediation/prompts?project=fixarea');
    assert.equal(r.status, 200);
    assert.equal(r.json.ok, true);
    const got = new Map(r.json.prompts.map((p) => [p.check, p]));
    assert.deepEqual([...got.keys()].sort(), [...expected.keys()].sort(),
      'the served check set must be exactly the manifests\' prompt-carrying checks');
    for (const [id, e] of expected) {
      assert.equal(got.get(id).prompt, e.prompt, `${id}: served prompt diverges from ${e.manifest}.json`);
      assert.equal(got.get(id).manifest, e.manifest);
    }
  });

  test('a categorised check carries the selected project\'s live scanners entry, verbatim', async () => {
    const r = await hit('/api/remediation/prompts?project=fixarea');
    const secrets = r.json.prompts.find((p) => p.check === 'secrets-gitleaks');
    assert.ok(secrets, 'secrets-gitleaks must be served (it carries a prompt)');
    assert.equal(secrets.category, 'secrets');
    assert.deepEqual(secrets.live, FIXTURE_SCANNERS.secrets, 'live must be the rollup entry passed through whole');
    const gd = r.json.prompts.find((p) => p.check === 'supply-chain-guarddog');
    assert.equal(gd.live.ran, 0, 'a VOID category still passes its provenance through — the client renders the void');
  });

  test('the rollup read state travels: ok for the fixture, absent for an unresolved project, unreadable for a torn file', async () => {
    const ok = await hit('/api/remediation/prompts?project=fixarea');
    assert.deepEqual(ok.json.rollup, { state: 'ok', why: null });
    assert.equal(ok.json.generated, '2026-08-02T00:00:00.000Z');
    const none = await hit('/api/remediation/prompts?project=');
    assert.equal(none.json.rollup.state, 'absent');
    assert.equal(none.json.generated, null);
    assert.equal(none.json.project.state, 'unselected', 'no project is named as such, not as a project nobody swept');
    assert.equal((await hit('/api/remediation/prompts?project=nope')).json.project.state, 'unknown');
    assert.equal(ok.json.project.state, 'ok');
    // corrupt the fixture rollup in place — the route reads at call time — then restore it
    const p = join(TMP, 'reports', 'fixarea', 'rollup.json');
    const orig = readFileSync(p, 'utf8');
    writeFileSync(p, orig.slice(0, 40));
    try {
      const torn = await hit('/api/remediation/prompts?project=fixarea');
      assert.equal(torn.status, 200);
      assert.equal(torn.json.rollup.state, 'unreadable');
      assert.ok(torn.json.rollup.why, 'the parse error travels');
      for (const q of torn.json.prompts) assert.equal(q.live, null, `${q.check}: a torn rollup lends no counts`);
    } finally { writeFileSync(p, orig); }
    const back = await hit('/api/remediation/prompts?project=fixarea');
    assert.equal(back.json.rollup.state, 'ok', 'restored — later tests read the fixture');
  });

  test('a check with no category reports live:null — and today, aliases leave none without one', async () => {
    const r = await hit('/api/remediation/prompts?project=fixarea');
    const outside = r.json.prompts.filter((p) => p.category === null);
    // no category ⇒ live null, never a borrowed or fabricated count
    for (const p of outside) assert.equal(p.live, null, `${p.check}: live must be null`);
    // Joern and Bearer now have real extractor categories; keeping their old exception here would
    // turn completed work back into a tolerated void.
    assert.deepEqual(outside.map((p) => p.check).sort(), [],
      'a prompt-carrying check has no category — alias it in the prompts route, or update this pin');
  });
});

// ── render — lifted from index.html source, the scanner-tabs technique ──────────────────────────
const escLine = INDEX_SRC.split('\n').find((l) => l.startsWith('const esc='));
const fnAt = INDEX_SRC.indexOf('function renderRemediationPrompts(d){');
assert.ok(escLine && fnAt > -1, 'renderRemediationPrompts not found in admin/index.html');
const fnSrc = INDEX_SRC.slice(fnAt, INDEX_SRC.indexOf('\n}', fnAt) + 2);
// rpWeight is the classifier the render shares with the fleet page; lifted, never restated.
const wAt = INDEX_SRC.indexOf('function rpWeight(l){');
assert.ok(wAt > -1, 'rpWeight not found in the panel source');
const wSrc = INDEX_SRC.slice(wAt, INDEX_SRC.indexOf('\n}', wAt) + 2);
// RP_VIEW_TAB is lifted from source, not restated — a copy would go stale silently.
const tabLine = INDEX_SRC.split('\n').find((l) => l.startsWith('const RP_VIEW_TAB='));
assert.ok(tabLine, 'RP_VIEW_TAB not found in admin/index.html');

// covState/COV_COPY lifted from source for the same reason; multi-line, so slice to the `};`.
const liftConst = (name) => {
  const lines = INDEX_SRC.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`const ${name}=`));
  assert.ok(start > -1, `${name} not found in admin/index.html`);
  const end = lines.findIndex((l, i) => i >= start && l === '};');
  assert.ok(end > start, `${name} has no terminating '};' in admin/index.html`);
  return lines.slice(start, end + 1).join('\n');
};
// age() is a two-line arrow whose last line ends in `};` rather than being one; slice to that.
const liftArrow = (name) => {
  const lines = INDEX_SRC.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`const ${name}=`));
  assert.ok(start > -1, `${name} not found in admin/index.html`);
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('};'));
  assert.ok(end >= start, `${name} has no terminating '};' in admin/index.html`);
  return lines.slice(start, end + 1).join('\n');
};
// plainCheck() is one line; liftArrow would run on into SCANNER_LABEL and declare it twice.
const liftLine = (name) => {
  const line = INDEX_SRC.split('\n').find((l) => l.startsWith(`const ${name}=`));
  assert.ok(line, `${name} not found in admin/index.html`);
  return line;
};
const covSrc = `${liftConst('covState')}\n${liftConst('COV_COPY')}\n${liftLine('plainCheck')}\n${liftConst('SCANNER_LABEL')}\n${liftArrow('age')}`;

function harness() {
  const els = {};
  const $ = (id) => (els[id] ||= { id, innerHTML: '', textContent: '' });
  // nosemgrep: javascript.browser.security.eval-detected.eval-detected -- test harness evaluating an esc() helper extracted from panel source under test, no external input
  const esc = eval(`(${escLine.slice(escLine.indexOf('=') + 1).replace(/;$/, '')})`);
  // recBtn is shared with the scanner tabs and tested there; stubbed to a marker here.
  const recBtn = ({ scanner = null, label = '' }) => `<button class="rec" data-scan="${esc(scanner || '')}" data-label="${esc(label)}">⏺</button>`;
  const render = new Function('$', 'esc', 'recBtn',
    `${covSrc}\n${tabLine}\n${wSrc}\n${fnSrc}\nreturn renderRemediationPrompts;`)($, esc, recBtn);
  return { render, el: $ };
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const P = (over = {}) => ({ check: 'secrets-gitleaks', category: 'secrets', manifest: 'security-baseline',
  description: 'desc', prompt: 'You are triaging…', live: null, ...over });

describe('render — findings first, nothing hidden, nothing injected', () => {
  test('a prompt with live findings floats to the top and opens; clean and no-signal collapse but stay present', () => {
    const h = harness();
    h.render({ prompts: [
      P({ check: 'tls-headers', category: null, prompt: 'TLS prompt' }),
      P({ live: { total: 5, high: 5, ran: 1, skipped: 0, noscan: 0 } }),
      P({ check: 'sast', category: 'sastSemgrep', prompt: 'SAST prompt', live: { total: 0, ran: 3, skipped: 0, noscan: 0 } }),
    ] });
    const html = h.el('rp-cards').innerHTML;
    assert.ok(html.indexOf('secrets-gitleaks') < html.indexOf('sast'), 'findings before clean');
    assert.match(html.slice(0, 200), /<details class="card" open/, 'the top actionable card opens');
    assert.match(html, /scanned clean/, 'clean prompts are grouped, not dropped');
    assert.match(html, /no signal right now/, 'no-signal prompts are grouped, not dropped');
    assert.match(html, /TLS prompt/, 'the no-signal prompt text is still rendered');
    assert.equal(h.el('rp-n').textContent, '1 actionable · 1 clean · 1 no signal');
  });

  test('VOID renders the void pill in the no-signal group — never a clean pill', () => {
    const h = harness();
    h.render({ prompts: [P({ live: { total: 0, ran: 0, skipped: 45, noscan: 2 } })] });
    const html = h.el('rp-cards').innerHTML;
    assert.match(html, /VOID — no trustworthy output/);
    assert.doesNotMatch(html, /pill live/);
  });

  // The carried guard. covState() decides the zero-run split for carried rows too; before this a
  // never-run lane carried from the last sweep (ran 0, every repo blocked) fell through to total 0
  // and rendered a green clean under "scanned clean" — four of them on the 100-repo corpus,
  // 2026-09-12.
  test('carried + never ran is no signal — never a clean pill, never counted clean', () => {
    const h = harness();
    h.render({ prompts: [P({ live: { total: 0, ran: 0, skipped: 100, noscan: 0, naSkips: 0, blockedSkips: 100, carried: true, carriedFrom: 'sweep-x' } })] });
    const html = h.el('rp-cards').innerHTML;
    assert.doesNotMatch(html, /pill live/, 'a zero-run category must not render clean, carried or not');
    assert.match(html, /UNRUN — input missing/, 'the classifier\'s own words, as the coverage table uses them');
    assert.match(html, /carried/);
    assert.match(html, /no signal right now/, 'it belongs to the no-signal group');
    assert.equal(h.el('rp-n').textContent, '0 actionable · 0 clean · 1 no signal');
  });

  test('carried + ran 0 + findings is a contradiction: actionable, and the pill says so', () => {
    const h = harness();
    h.render({ prompts: [P({ live: { total: 2430, low: 2430, ran: 0, skipped: 98, noscan: 2, carried: true, carriedFrom: 'sweep-x' } })] });
    const html = h.el('rp-cards').innerHTML;
    assert.match(html, /CONTRADICTION — provenance vs evidence/);
    assert.doesNotMatch(html, /pill live/);
    assert.match(html.slice(0, 200), /<details class="card" open/, 'it stays actionable — findings exist, whatever the run record says');
    assert.equal(h.el('rp-n').textContent, '1 actionable · 0 clean · 0 no signal');
  });

  test('no run provenance and no findings is unknown, not clean', () => {
    const h = harness();
    h.render({ prompts: [P({ live: { total: 0 } })] });
    const html = h.el('rp-cards').innerHTML;
    assert.doesNotMatch(html, /pill live/);
    assert.match(html, /no provenance/);
    assert.equal(h.el('rp-n').textContent, '0 actionable · 0 clean · 1 no signal');
  });

  test('carried keeps its count and says carried', () => {
    const h = harness();
    h.render({ prompts: [P({ live: { total: 88, high: 88, ran: 1, skipped: 0, noscan: 0, carried: true, carriedFrom: 'sweep-x' } })] });
    const html = h.el('rp-cards').innerHTML;
    assert.match(html, /carried/);
    assert.match(html, /88 finding/);
  });

  test('hostile prompt text cannot inject markup, and the copy affordance is present', () => {
    const h = harness();
    h.render({ prompts: [P({ prompt: '<script>bad()</script><img src=x onerror=alert(1)>' })] });
    const html = h.el('rp-cards').innerHTML;
    assert.ok(!html.includes('<script>') && !html.includes('<img'), 'prompt text must be escaped');
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /class="rp-copy"/);
    assert.match(html, /class="rp-claude"/, 'the Claude Code handoff button must be on every card');
    assert.match(html, /class="rp-local"/, 'the local-LLM handoff button must be on every card');
  });

  test('the header dates the counts, and a carried pill dates its slice', () => {
    const h = harness();
    h.render({ generated: hoursAgo(3), prompts: [
      P({ live: { total: 5, high: 5, ran: 1, skipped: 0, noscan: 0, carried: true, carriedFrom: 'sweep-x', carriedAt: hoursAgo(26) } }),
    ] });
    assert.equal(h.el('rp-n').textContent, '1 actionable · 0 clean · 0 no signal · counts 3h old');
    assert.match(h.el('rp-cards').innerHTML, /carried · as of 26h old/, 'the carried pill carries the slice age, as the coverage table row does');
  });

  test('an unreadable rollup is named on the dark group — never the same words as no sweep', () => {
    const h = harness();
    h.render({ rollup: { state: 'unreadable', why: 'Unexpected token < in JSON' }, prompts: [P(), P({ check: 'sast', category: 'sastSemgrep' })] });
    const html = h.el('rp-cards').innerHTML;
    assert.match(html, /rollup\.json is UNREADABLE \(Unexpected token &lt; in JSON\)/, 'the reason is stated and escaped');
    assert.equal(h.el('rp-n').textContent, '0 actionable · 0 clean · 2 no signal');
    const h2 = harness();
    h2.render({ rollup: { state: 'absent', why: null }, prompts: [P()] });
    assert.match(h2.el('rp-cards').innerHTML, /no rollup for this project/);
    assert.doesNotMatch(h2.el('rp-cards').innerHTML, /UNREADABLE/);
  });

  test('the title is the human label the coverage table uses, and aliasOf is rendered', () => {
    const h = harness();
    h.render({ prompts: [P({ check: 'secrets-gitleaks-alias', aliasOf: 'secrets-gitleaks', live: { total: 1, ran: 1, skipped: 0, noscan: 0 } })] });
    const html = h.el('rp-cards').innerHTML;
    assert.match(html, /<b class="sans t-title">Secrets · Gitleaks<\/b>/, 'SCANNER_LABEL, not the raw key');
    assert.match(html, /secrets-gitleaks-alias → secrets-gitleaks/, 'whose numbers these are, as poCard says it');
  });

  test('no prompts anywhere is stated, not blank', () => {
    const h = harness();
    h.render({ prompts: [] });
    assert.match(h.el('rp-cards').innerHTML, /no remediation prompts declared/);
  });
});

// ── guard: formatNotes completeness ratchet ─────────────────────────────────
// Every check carrying remediationPrompt must also carry formatNotes or a justified exemption.
describe('guard — formatNotes completeness ratchet', () => {
  test('every check with remediationPrompt has formatNotes or a justified exemption', () => {
    const named = ['branch-protection', 'build-health', 'quality-gates', 'runtime', 'security-baseline']
      .filter((n) => existsSync(join(CW, 'manifests', `${n}.json`))).sort();

    // Exemptions: check id → reason (≥ 40 chars) why formatNotes cannot be written.
    const EXEMPT = {
      // Example pattern (if needed): 'check-id': 'reason text here is at least 40 chars long',
    };

    const violations = [];
    for (const name of named) {
      let j; try { j = JSON.parse(readFileSync(join(CW, 'manifests', `${name}.json`), 'utf8')); } catch { continue; }
      for (const c of (Array.isArray(j.checks) ? j.checks : [])) {
        if (!c.remediationPrompt) continue;
        if (!c.formatNotes && !EXEMPT[c.id]) {
          violations.push({ check: c.id, manifest: name, hasFormatNotes: !!c.formatNotes, hasExemption: !!EXEMPT[c.id] });
        }
      }
    }

    assert.equal(violations.length, 0,
      violations.length > 0
        ? `${violations.length} check(es) with remediationPrompt missing formatNotes or exemption:\n  ${
          violations.map((v) => `${v.manifest}/${v.check}`).join('\n  ')
        }\nAdd formatNotes to each (verified format facts from tool docs), or add to EXEMPT with ≥40 char reason.`
        : undefined);
  });
});
