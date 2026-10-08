// BLOCKED is a void with an OWNER — distinct from a void nobody can clear.
//
// `noscan` means "ran, produced nothing trustworthy", and for most lanes nothing can be done about
// it: a11y with no served HTML, BOLA with no OpenAPI spec, TLS with no live target. Those are
// structural absences and grey is honest. An absent CREDENTIAL or TOOL is different in kind — the
// lane could report, it is not being allowed to, and one human action clears it. Rendered the same
// grey it sits, because the operator has correctly learned grey means "nothing to do here".
//
// The risk this file guards is OVER-matching. If structural absence starts painting red, the
// distinction is worthless within a week and the red gets ignored like everything else.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseReport } from '../commitwork.mjs';
import { PALETTE } from '../lib/theme.mjs';

const T = mkdtempSync(join(tmpdir(), 'cw-blocked-'));
const write = (name, data) => { const p = join(T, name); writeFileSync(p, JSON.stringify(data)); return p; };

describe('a clearable void reports BLOCKED', () => {
  test('cspm-github self-gated on a missing token is BLOCKED, not merely not-evaluated', () => {
    const r = parseReport('cspm-github', write('c1.json',
      { ran: false, skipped: true, reason: 'PROWLER_GITHUB_TOKEN unset and $CI is set — the gh-session fallback is deliberately refused in CI' }));
    assert.equal(r.sev, 'noscan', 'the STATUS axis is unchanged — every existing consumer still reads a void');
    assert.equal(r.blocked, true, 'but the fact that a human can clear it rides alongside');
    // The word BLOCKED is the RENDERER's, not the summary's — asserted in the effect test below.
    assert.match(r.summary, /not evaluated/);
    assert.match(r.blockedReason, /PROWLER_GITHUB_TOKEN/, 'the reason must name WHAT to set, not just that something is missing');
  });

  test('a missing tool is BLOCKED — installing it is an action somebody can take', () => {
    const r = parseReport('cspm-github', write('c2.json', { ran: false, reason: 'prowler not installed' }));
    assert.equal(r.blocked, true);
  });
});

describe('a STRUCTURAL void stays grey — the over-match guard', () => {
  // Each of these is a genuine absence with no owner. Painting them red would retire the
  // distinction: an operator who sees red for "this repo serves no HTML" learns to ignore red.
  const structural = [
    ['a11y', { ran: false, reason: 'no served HTML' }],
    ['authz-bola', { ran: false, reason: 'no OpenAPI spec discovered' }],
    ['tls-headers', { ran: false, reason: 'no live target' }],
    ['gradle-wrapper', { ran: false, reason: 'no wrapper in this repo' }],
  ];
  for (const [format, body] of structural) {
    test(`${format}: "${body.reason}" is a void with no owner — explicit uncertainty`, () => {
      const r = parseReport(format, write(`s-${format}.json`, body));
      assert.equal(r.sev, 'noscan');
      assert.notEqual(r.blocked, true, `${format} painted a structural absence as BLOCKED — over-matching retires the distinction`);
      assert.doesNotMatch(r.summary, /BLOCKED/);
    });
  }
});

describe('the void axis is unchanged for old readers', () => {
  test('blocked never changes sev away from noscan', () => {
    // The whole point of riding alongside rather than becoming a fifth status: a consumer that has
    // never heard of `blocked` must still classify this correctly as a void, not fall through to a
    // default that reads clean.
    const r = parseReport('cspm-github', write('c3.json', { ran: false, reason: 'PROWLER_GITHUB_TOKEN unset' }));
    assert.equal(r.sev, 'noscan');
    assert.equal(r.ok, false);
  });

  test('a lane that RAN is never blocked, whatever its reason field says', () => {
    const r = parseReport('cspm-github', write('c4.json', { ran: true, pass: 3, fail: 13, reason: 'token used' }));
    assert.notEqual(r.blocked, true, 'blocked describes a void — a lane with results is not one');
    assert.equal(r.sev, 'high');
  });
});

// ── THE EFFECT, NOT THE MARKER ───────────────────────────────────────────────────────────────
// Everything above asserts that `blocked` is SET. None of it asserts that anything OBEYS it —
// verified by deleting the renderer branch and watching all 8 still pass. That is the same defect
// found in the passkey test on 2026-08-23: it checked the markup shipped `hidden` and
// the script referenced PublicKeyCredential, both true for the entire life of a button that was
// visible in every browser. A test that asserts a flag is set is probably not asserting that
// anything reads it.
//
// So this runs the real CLI over a real manifest and reads the terminal output. Colour is forced
// on, because the whole point of the change is that a blocked void looks different from a grey one
// — asserting the WORD alone would leave the palette free to drift back to the unmeasured colour while the word still passes.
describe('the renderer obeys the flag', () => {
  test('a blocked void renders BLOCKED in its own colour, not as grey noscan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-blocked-cli-'));
    const repo = join(dir, 'repo'); const reports = join(dir, 'reports');
    mkdirSync(repo); mkdirSync(reports);
    const manifest = join(dir, 'm.json');
    writeFileSync(manifest, JSON.stringify({
      repo: 'fixture',
      groups: { probe: ['cspm-github'] },
      checks: [{
        id: 'cspm-github',
        description: 'fixture: self-gates on an absent token',
        local: [`printf '{"tool":"cspm-github","ran":false,"skipped":true,"reason":"PROWLER_GITHUB_TOKEN unset"}' > "$CW_REPORT_DIR/cspm-github.json"`],
        report: { file: 'cspm-github.json', format: 'cspm-github' },
        groups: ['probe'],
      }],
    }));
    const colourEnv = { ...process.env, CW_REPORT_DIR: reports, CW_SKIP_SETUP: '1', FORCE_COLOR: '3' };
    // NO_COLOR deliberately outranks FORCE_COLOR in theme.mjs. This test is specifically about the
    // colour renderer, so remove ambient opt-outs instead of claiming FORCE_COLOR overrode them.
    delete colourEnv.NO_COLOR;
    delete colourEnv.CW_NO_COLOR;
    const r = spawnSync('node', [fileURLToPath(new URL('../commitwork.mjs', import.meta.url)),
      'run', 'probe', '--manifest', manifest, '--repo', repo, '--no-fail-fast'], {
      encoding: 'utf8',
      env: colourEnv,
    });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    // TWO renderers must obey it, and the count is asserted rather than the mere presence: the
    // per-check line during the run, and the void summary at the end. Checking only that BLOCKED
    // appears SOMEWHERE was measurably too weak — removing either renderer alone still passed,
    // because the other one covered for it. Verified by deleting each in turn.
    const shown = (out.match(/BLOCKED/g) || []).length;
    assert.equal(shown, 2,
      `expected BLOCKED from both the per-check line and the void summary, saw ${shown} — `
      + 'if one renderer stops obeying the flag, the other hides it');
    // PALETTE.blocked is the blocked slot. Without the renderer branch this is the noscan colour,
    // which is precisely the regression every marker-asserting test above is blind to.
    assert.ok(out.includes(`38;2;${PALETTE.blocked.join(';')}m`),
      'BLOCKED must render in its own colour; grey/orange here means the renderer ignored the flag');
    rmSync(dir, { recursive: true, force: true });
  });
});
