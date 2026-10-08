// pins: the drift alarm must ACCOUNT for grouping, never go silent about it. bin/anchor-triage.mjs
// was built, tested, and consumed by nothing for a day; this is the test that says something reads
// it. Asserting the call exists would not do - these assert what reaches the operator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { gitChildEnv } from '../lib/git-env.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// a commit every clone has, so the triage's git range resolves wherever the suite runs
const BASELINE = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: REPO, encoding: 'utf8', env: gitChildEnv() }).trim();

const anchorDoc = (driftedOpen) => ({
  baseline: BASELINE,
  driftedOpen,
  results: Array.from({ length: driftedOpen }, (_, i) => ({
    state: 'anchor-changed', file: `x${i}.mjs`, line: i + 1,
    wasText: `a-line-long-enough-to-search-${i}`, summary: `s${i}`,
  })),
});

/** Run the real gate (not --show) and return everything it emitted. */
function fire({ drifted, baselineDrifted, triageInput }) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-triage-wire-'));
  try {
    const anchors = join(dir, 'anchors.json');
    writeFileSync(anchors, `${JSON.stringify(anchorDoc(drifted), null, 2)}\n`);
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, `${JSON.stringify({ conflicts: 0, unreviewed: 0, drifted: baselineDrifted, at: '2026-08-01T00:00:00.000Z' })}\n`);
    const verdicts = join(dir, 'verdicts'); const hook = join(dir, 'hook');
    mkdirSync(verdicts, { recursive: true }); mkdirSync(hook, { recursive: true });
    let out = '';
    try {
      out = execFileSync(process.execPath, [join(REPO, 'bin', 'gate-ratchet.mjs')], {
        cwd: REPO, encoding: 'utf8', timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          CW_ANCHOR_STALENESS_JSON: anchors,
          // anchor-triage reads its OWN env var; point it wherever the case needs
          CW_ANCHOR_STALENESS: triageInput === undefined ? anchors : triageInput,
          CW_RATCHET_BASELINE: baseline, CW_VERDICT_DIR: verdicts, CW_HOOK_STATE: hook,
        },
      });
    } catch (e) { out = `${String(e.stdout || '')}\n${String(e.stderr || '')}`; }
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('when drift worsens the alarm ACCOUNTS for grouping — never silently omits it', () => {
  const out = fire({ drifted: 12, baselineDrifted: 3 });
  assert.match(out, /anchor drifted/, 'precondition: the drift metric must be the one that worsened');
  // Either it grouped, or it says it could not. A third outcome (nothing about grouping at all)
  // is the failure this test exists to catch, because that is what "wired to nothing" looks like
  // from the operator's side.
  const accounted = /Grouped by the commits that rewrote them/.test(out)
    || /Grouping UNAVAILABLE this run/.test(out);
  assert.ok(accounted, `alarm said nothing about grouping:\n${out.slice(0, 1200)}`);
});

test('an unreadable triage input reports UNAVAILABLE — it does not resolve to silence', () => {
  const out = fire({ drifted: 12, baselineDrifted: 3, triageInput: '/nonexistent/anchor-staleness.json' });
  assert.match(out, /Grouping UNAVAILABLE this run/,
    'a failed grouping must SAY so; silence would read as "there is no grouping to offer"');
  assert.match(out, /the drift count above stands, ungrouped/,
    'the unavailable notice must not invalidate the drift count it sits beside');
});

test('the grouping line is not emitted when drift did not worsen — it costs ~5s, so it must be conditional', () => {
  // drift IMPROVES against the baseline, so `worse` cannot contain the drift metric
  const out = fire({ drifted: 2, baselineDrifted: 50 });
  assert.doesNotMatch(out, /Grouped by the commits that rewrote them/);
  assert.doesNotMatch(out, /Grouping UNAVAILABLE/);
});

test('grouping NOTHING never reads as nothing-to-look-at', () => {
  // The fixture's wasText values are absent from git history, so every finding lands in
  // noEvidence and grouped is 0. The first version of --summary printed "0 drifted finding(s)
  // group into 0 verdict(s)" directly beneath an alarm reporting a RISE, which reads as reassurance
  // and is the exact false-clean this repo exists to refuse. Caught before it shipped; pinned here.
  const out = fire({ drifted: 12, baselineDrifted: 3 });
  assert.match(out, /Grouped by the commits that rewrote them/, 'precondition: triage ran');
  assert.match(out, /NONE of \d+ drifted finding\(s\) could be grouped/,
    'a zero grouping must state that every finding needs its own read');
  assert.doesNotMatch(out, /group into 0 verdict\(s\)/,
    'never phrase a total failure to group as a count of zero verdicts');
});

const REWRITTEN = {
  alpha: 'const fixtureAlphaLineLongEnough = 1;',
  beta: 'const fixtureBetaLineLongEnough = 2;',
  gamma: 'const fixtureGammaLineLongEnough = 3;',
};

/**
 * A repository whose history the triage can search: one commit rewrites alpha and beta out of a.mjs,
 * the next rewrites gamma out of b.mjs. Built by fast-import, whose stream carries its own committer
 * line, so it needs no git identity from the environment and its commit ids are the same every run.
 */
function triageRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-triage-repo-'));
  const data = (s) => `data ${Buffer.byteLength(s)}\n${s}\n`;
  const commit = (n, message, files) => `commit refs/heads/main\nmark :${n}\n`
    + `committer fixture <> ${1767225600 + n * 60} +0000\n${data(message)}${n > 1 ? `from :${n - 1}\n` : ''}`
    + Object.entries(files).map(([path, body]) => `M 100644 inline ${path}\n${data(body)}`).join('');
  const stream = [
    commit(1, 'baseline', {
      'a.mjs': `${REWRITTEN.alpha}\n${REWRITTEN.beta}\nconst keep = 0;\n`,
      'b.mjs': `${REWRITTEN.gamma}\nconst keep = 0;\n`,
    }),
    commit(2, 'rewrite a', { 'a.mjs': 'const keep = 0;\n' }),
    commit(3, 'rewrite b', { 'b.mjs': 'const keep = 0;\n' }),
  ].join('\n');
  // Scrubbed: under a hook an inherited GIT_DIR outranks -C, and this import would land in commitwork.
  const git = (args, input) => execFileSync('git', ['-C', dir, ...args],
    { encoding: 'utf8', input, env: gitChildEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  git(['init', '-q']);
  git(['fast-import', '--quiet'], stream);
  git(['symbolic-ref', 'HEAD', 'refs/heads/main']);
  return { dir, baseline: git(['rev-parse', 'main~2']).trim() };
}

test('--summary states the singleton split, not just the reduction', () => {
  // The reduction alone reads as a bigger saving than it is: measured 2026-08-23, 45 of 60
  // verdicts covered exactly one finding. A consumer quoting only "N into M" would mislead.
  const { dir, baseline } = triageRepo();
  try {
    const report = join(dir, 'anchor-staleness.json');
    writeFileSync(report, `${JSON.stringify({
      baseline,
      driftedOpen: 3,
      results: [['a.mjs', 1, 'alpha'], ['a.mjs', 2, 'beta'], ['b.mjs', 1, 'gamma']].map(([file, line, k]) => ({
        state: 'anchor-changed', file, line, wasText: REWRITTEN[k], summary: k,
      })),
    }, null, 2)}\n`);
    const out = execFileSync(process.execPath, [join(REPO, 'bin', 'anchor-triage.mjs'), '--summary'], {
      cwd: REPO, encoding: 'utf8', timeout: 120_000,
      env: { ...gitChildEnv(), CW_ANCHOR_STALENESS: report, CW_ANCHOR_TRIAGE_ROOT: dir },
    });
    assert.match(out, /\d+ drifted finding\(s\) group into \d+ verdict\(s\)/);
    assert.match(out, /\d+ singleton/, 'the singleton count must travel with the reduction');
    assert.match(out, /input @[0-9a-f]{12}/, 'the input digest must travel: both HEAD and the report move');
    assert.match(out, /^3 of 3 drifted finding\(s\) group into 2 verdict\(s\) \(1 singleton, 1 covering 2\)/,
      'the fixture holds one two-finding rewrite and one singleton');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
