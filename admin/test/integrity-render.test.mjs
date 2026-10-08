// R1 integrity renderers, extracted whole from admin/index.html (derived-rows pattern) and driven
// through every served state. The assertions ARE the house rules: an unknown/absent state renders
// as its own state and never as clean/fresh (explicit uncertainty); an uncorroborated zero is its own
// state, distinct from unknown (violet ≠ grey); unverified-legacy is drawn, never alarmed
// (over-reporting is as wrong as under).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = panelSource('index.html');

const from = (marker) => {
  const at = SRC.indexOf(marker);
  assert.ok(at > -1, `${marker} not found in admin/index.html`);
  return at;
};
const block = SRC.slice(from('// ── R1 INTEGRITY RENDERERS'), from('// ── END R1 INTEGRITY RENDERERS'));

const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const R = new Function('esc',
  `${block}\nreturn { renderConservation, renderTimelineVerify, renderAnomalies, renderFatigue, renderCalibration, renderEscalations, intgSummary };`)(esc);

// the two shapes a cell must never wear when the state is unknown/absent
const notClean = (html, what) => {
  assert.ok(!html.includes('pill live'), `${what} rendered with the green pill`);
  assert.ok(!/\bclean\b|\bfresh\b/i.test(html), `${what} used the word clean/fresh`);
};
// THEME Rule 7: a value that could not be read is drawn as an absence (.pill.unk, dashed), never
// with a severity colour. An unreadable store is not a finding any more than it is a pass.
const unknownNotSevere = (html, what) => {
  assert.match(html, /pill unk/, `${what} is not drawn as unknown`);
  assert.doesNotMatch(html, /pill (crit|high|med|low)"/, `${what} wears a severity pill`);
};

// ── conservation ────────────────────────────────────────────────────────────────────────────────
test('conservation: never-checked is its own state, never clean', () => {
  for (const c of [undefined, null, { state: 'never-checked' }]) {
    const h = R.renderConservation(c);
    assert.match(h, /never checked/);
    notClean(h, 'never-checked conservation');
  }
});

test('conservation: a checked zero is green WITH its evidence; violations name the arithmetic', () => {
  const ok = R.renderConservation({ state: 'checked', checked: ['secrets', 'iac'], violations: [] });
  assert.match(ok, /pill live/);
  assert.match(ok, /2 categories checked/);
  const bad = R.renderConservation({ state: 'checked', checked: ['secrets'],
    violations: [{ category: 'secrets', declared: 5, published: 3, truncated: 1 }] });
  assert.match(bad, /pill crit/);
  assert.match(bad, /declared 5 ≠ published 3 \+ truncated 1/);
});

test('conservation: checked-but-nothing-checkable is not a pass', () => {
  const h = R.renderConservation({ state: 'checked', checked: [], violations: [] });
  assert.match(h, /nothing checkable/);
  notClean(h, 'empty checked set');
});

// ── timeline verify ─────────────────────────────────────────────────────────────────────────────
test('timelineVerify: no-history and unreadable-index are distinct, neither clean', () => {
  const none = R.renderTimelineVerify({ state: 'no-history' });
  assert.match(none, /no history/);
  notClean(none, 'no-history');
  const unread = R.renderTimelineVerify({ state: 'unreadable', detail: 'EACCES' });
  assert.match(unread, /index unreadable/);
  assert.match(unread, /not "no history"/);
  unknownNotSevere(unread, 'an unreadable history index');
});

test('timelineVerify: unverified-legacy is drawn, never alarmed', () => {
  const h = R.renderTimelineVerify({ state: 'ok', window: 2, total: 2, counts: { verified: 1, 'unverified-legacy': 1, unreadable: 0 } });
  assert.match(h, /1 unverified-legacy/);
  const legacyChip = h.split('unverified-legacy')[0].split('</span>').at(-2) || '';
  assert.ok(!/crit|high/.test(legacyChip), 'legacy chip wears an alarm class');
  assert.match(h, /never alarmed/);
});

test('timelineVerify: zero verified is not a green chip; an unreadable slice is unknown', () => {
  const h = R.renderTimelineVerify({ state: 'ok', window: 3, total: 9, counts: { verified: 0, 'unverified-legacy': 2, unreadable: 1 },
    slices: [{ verify: 'unverified-legacy' }, { verify: 'unverified-legacy' }, { verify: 'unreadable', detail: 'EACCES' }] });
  assert.match(h, /pill plan">0 verified/);
  assert.ok(!h.includes('pill live'), 'nothing verified must not render green');
  assert.match(h, /pill unk">1 unreadable/);
  unknownNotSevere(h, 'a slice that could not be read');
  assert.match(h, /newest 3 of 9/);
});

test('timelineVerify: a hash mismatch is measured, so it alarms apart from the unreadable count', () => {
  const h = R.renderTimelineVerify({ state: 'ok', window: 3, total: 3, counts: { verified: 1, 'unverified-legacy': 0, unreadable: 2 },
    slices: [{ verify: 'verified' }, { verify: 'unreadable', detail: 'sha256-mismatch' }, { verify: 'unreadable', detail: 'ENOENT' }] });
  assert.match(h, /pill crit">1 hash mismatch/);
  assert.match(h, /pill unk">1 unreadable/);
  assert.doesNotMatch(h, /pill crit">\d+ unreadable/);
});

// ── anomalies ───────────────────────────────────────────────────────────────────────────────────
test('anomalies: never-measured / unreadable / measured-zero / rows are four different renders', () => {
  const never = R.renderAnomalies({ state: 'never-measured' });
  assert.match(never, /never measured/);
  notClean(never, 'never-measured anomalies');
  const unread = R.renderAnomalies({ state: 'unreadable', detail: 'parse' });
  assert.match(unread, /not zero anomalies/);
  unknownNotSevere(unread, 'unreadable anomalies');
  const zero = R.renderAnomalies({ state: 'measured', count: 0, anomalies: [] });
  assert.match(zero, /pill live/, 'a measured zero is corroborated — green is earned here');
  assert.match(zero, /measured/);
  const rows = R.renderAnomalies({ state: 'measured', count: 1, anomalies: [
    { category: 'secrets', hash: 'aaaaaaaaaaaa', repoCount: 6, bytes: 700, repos: ['r1', 'r2'], truncated: 4 },
  ] });
  assert.match(rows, /secrets/);
  assert.match(rows, /\+4 more/);
});

// ── fatigue ─────────────────────────────────────────────────────────────────────────────────────
test('fatigue: not-served / no-journal / unreadable are three unknowns, none of them zero', () => {
  for (const [f, marker] of [[undefined, /not served/], [{ state: 'no-journal' }, /no journal/], [{ state: 'unreadable', detail: 'EACCES' }, /unreadable/]]) {
    const h = R.renderFatigue(f);
    assert.match(h, marker);
    assert.match(h, /UNKNOWN|never "nothing suppressed"/);
    assert.ok(!h.includes('pill live'), 'an unknown fatigue state rendered green');
    unknownNotSevere(h, 'an unknown fatigue state');
  }
});

test('fatigue: violet ≠ grey — the uncorroborated zero is its own pill, distinct from unknown AND from green', () => {
  const unrf = R.renderFatigue({ state: 'zero-unreinforced' });
  assert.match(unrf, /pill unrf/);
  assert.match(unrf, /uncorroborated/);
  assert.ok(!unrf.includes('pill unk') && !unrf.includes('pill live'));
  const corr = R.renderFatigue({ state: 'zero-corroborated' });
  assert.match(corr, /pill live/);
  assert.match(corr, /corroborated/);
});

test('fatigue: a target row states its counts and flags never-expiring suppressions', () => {
  const h = R.renderFatigue({ state: 'ok', targets: [{ target: 'alpha secrets aws-key', count: 9, labels: 2, everExpiring: false }] });
  assert.match(h, /alpha secrets aws-key/);
  assert.match(h, /never expires/);
});

// ── calibration ─────────────────────────────────────────────────────────────────────────────────
test('calibration: unknown states render as unknown; a null rate renders as none, never 0%', () => {
  for (const c of [undefined, { state: 'no-records' }]) notClean(R.renderCalibration(c), 'calibration unknown');
  const unread = R.renderCalibration({ state: 'unreadable', detail: 'EACCES' });
  assert.match(unread, /never "calibrated clean"/);
  unknownNotSevere(unread, 'an unreadable calibration journal');
  const h = R.renderCalibration({ state: 'ok', generated: 'x', checks: {
    secrets: { human: { denominator: 0, adjudicated: 0, unadjudicated: 4, falseAlarmRate: null, falseCleanRate: null, cohortUnknown: 0 } },
  } });
  assert.ok(!/0%/.test(h), 'a null rate was coerced to 0%');
  assert.match(h, /a rate here would be an invention/);
  const rated = R.renderCalibration({ state: 'ok', generated: 'x', checks: {
    secrets: { human: { denominator: 4, adjudicated: 4, unadjudicated: 1, falseAlarmRate: 0.25, falseCleanRate: 0, cohortUnknown: 0 } },
  } });
  assert.match(rated, /25%/);
  assert.match(rated, /0%/, 'a REAL zero rate does render as 0%');
});

// ── escalations ─────────────────────────────────────────────────────────────────────────────────
test('escalations: not-served / no-journal / unreadable are unknowns; unreadable refuses "none recorded"', () => {
  for (const [e, marker] of [[undefined, /not served/], [{ state: 'no-journal' }, /no journal/]]) {
    const h = R.renderEscalations(e);
    assert.match(h, marker);
    assert.match(h, /UNKNOWN, not empty/);
    notClean(h, 'unknown escalation state');
  }
  const unread = R.renderEscalations({ state: 'unreadable', detail: 'EACCES' });
  unknownNotSevere(unread, 'an unreadable escalations journal');
  assert.match(unread, /"none recorded" is not a claim this load can make/);
});

test('escalations: violet ≠ explicit uncertainty on the empty queue', () => {
  const unrf = R.renderEscalations({ state: 'zero-unreinforced' });
  assert.match(unrf, /pill unrf/);
  assert.match(unrf, /never written here/);
  const corr = R.renderEscalations({ state: 'zero-corroborated' });
  assert.match(corr, /pill live/);
  assert.match(corr, /none recorded/);
});

test('escalation rows are a needs-a-human queue: amber reason, sealed evidence, never a verdict', () => {
  const h = R.renderEscalations({ state: 'ok', pending: 2, resolved: 1, truncated: 3, rows: [
    { findingKey: 'secrets|alpha|aws-key', category: 'secrets', repo: 'alpha', reason: 'disagreement', chains: 3,
      at: '2026-09-01T00:00:00Z', model: 'qwen-7b', evidenceSealed: true, basisSealed: true },
    { findingKey: 'iac|beta|r', category: 'iac', repo: 'beta', reason: 'unparsed', chains: null,
      at: '2026-09-01T01:00:00Z', model: 'qwen-7b', evidenceSealed: false, basisSealed: false },
  ] });
  assert.match(h, /pill part" title="chains returned different verdicts[^"]*needs a person/);
  assert.match(h, /sealed · 3 chain\(s\)/);
  assert.match(h, /no envelope/, 'a row missing its sealed envelope is stated, not blank');
  assert.ok(!h.includes('pill live') && !h.includes('pill crit'), 'a null-truth row wore a verdict colour');
  assert.ok(!/adjudicated<|verdict:/.test(h), 'rendered as if adjudicated');
  assert.match(h, /\+3 older pending/);
  assert.match(h, /1 earlier escalation\(s\) since adjudicated by a person/);
});

// ── summary line ────────────────────────────────────────────────────────────────────────────────
test('intgSummary states all three axes, voids included', () => {
  const s = R.intgSummary({});
  assert.match(s, /conservation: never checked/);
  assert.match(s, /husks: never measured/);
  assert.match(s, /verify: no history/);
  const t = R.intgSummary({
    conservation: { state: 'checked', checked: ['a'], violations: [{}] },
    artifactAnomalies: { state: 'measured', count: 2 },
    timelineVerify: { state: 'ok', window: 3, total: 3, counts: { verified: 2, 'unverified-legacy': 1, unreadable: 0 } },
  });
  assert.match(t, /1 violation/);
  assert.match(t, /2 husk/);
  assert.match(t, /2v\/1l\/0u/);
});

// ── the wiring is present, not just the functions ───────────────────────────────────────────────
test('the panel subscribes: markup ids exist and the load paths call the renderers', () => {
  for (const id of ['intg-cons', 'intg-tl', 'intg-anom', 'intg-n', 'vd-fatigue', 'vd-fat-n', 'vd-calib', 'vd-cal-n', 'vd-esc', 'vd-esc-n']) {
    assert.ok(SRC.includes(`id="${id}"`), `markup lacks #${id}`);
  }
  for (const call of ['renderConservation(d.conservation)', 'renderTimelineVerify(d.timelineVerify)',
    'renderAnomalies(d.artifactAnomalies)', 'renderFatigue(d.fatigue)', 'renderCalibration(d.calibration)',
    'renderEscalations(d.escalations)']) {
    assert.ok(SRC.includes(call), `nothing feeds ${call.split('(')[0]} — built but subscribed by nothing`);
  }
  // the style lives in the static sheet — the CSP (style-src 'self') forbids an inline block
  const css = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8');
  assert.ok(css.includes('.pill.unrf'), 'the violet uncorroborated-zero pill has no style in panel.css');
  assert.match(SRC, /<style id="workspace-styles">/, 'the menu carries its own inline styles');
});
