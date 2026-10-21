// Guards the FUSION, not the arithmetic (cvss.test.mjs covers that): which source wins, what a
// disagreement does, and that nothing escapes the declared set.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { gradeOf } from '../vendor-scan.mjs';

const vec = (s) => ({ severity: [{ type: 'CVSS_V3', score: s }] });
const lab = (s) => ({ database_specific: { severity: s } });
const both = (v, l) => ({ ...vec(v), ...lab(l) });

const XSS = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N';        // 6.1 → med
const CRIT = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';       // 9.8 → crit

describe('one source present', () => {
  test('vector alone grades and says so', () => {
    const g = gradeOf(vec(XSS));
    assert.equal(g.severity, 'med');
    assert.equal(g.severitySource, 'cvss');
    assert.equal(g.cvssScore, 6.1);
  });
  test('label alone grades and says so', () => {
    const g = gradeOf(lab('MODERATE'));
    assert.equal(g.severity, 'med');
    assert.equal(g.severitySource, 'label');
    assert.equal(g.cvssScore, null);
  });
  test('GitHub label spellings all land', () => {
    for (const [raw, want] of [['CRITICAL', 'crit'], ['HIGH', 'high'], ['MODERATE', 'med'],
      ['MEDIUM', 'med'], ['LOW', 'low'], ['low', 'low']]) {
      assert.equal(gradeOf(lab(raw)).severity, want, raw);
    }
  });
});

describe('both present', () => {
  test('agreement is recorded as agreement, not as a coincidence', () => {
    // the real fleet case: every jQuery/Bootstrap XSS scores 6.1 AND is labelled MODERATE
    const g = gradeOf(both(XSS, 'MODERATE'));
    assert.equal(g.severity, 'med');
    assert.equal(g.severitySource, 'agree');
  });
  test('a disagreement takes the HIGHER and publishes the disagreement', () => {
    const g = gradeOf(both(CRIT, 'LOW'));
    assert.equal(g.severity, 'crit', 'the higher of the two must stand');
    assert.equal(g.severitySource, 'disagreement');
  });
  test('higher wins from either direction — not "vector always wins"', () => {
    assert.equal(gradeOf(both(XSS, 'CRITICAL')).severity, 'crit');
    assert.equal(gradeOf(both(CRIT, 'LOW')).severity, 'crit');
  });
});

describe('the evidence survives the grade', () => {
  // the defect this replaces: parsed, discarded, replaced by a sentinel — no artifact could be re-graded
  test('vector, score and raw label all ride on the finding', () => {
    const g = gradeOf(both(XSS, 'MODERATE'));
    assert.equal(g.cvss, XSS);
    assert.equal(g.cvssScore, 6.1);
    assert.equal(g.label, 'MODERATE');
  });
  test('an UNSCORABLE vector is still carried, so a better parser can re-grade it later', () => {
    const v4 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
    const g = gradeOf(vec(v4));
    assert.equal(g.severity, 'undetermined');
    assert.equal(g.cvss, v4, 'the unreadable vector must be preserved, not dropped');
    assert.equal(g.cvssScore, null);
  });
  test('the highest of several vectors wins — the header always claimed this', () => {
    const g = gradeOf({ severity: [{ score: XSS }, { score: CRIT }] });
    assert.equal(g.severity, 'crit');
    assert.equal(g.cvssScore, 9.8);
  });
});

describe('undetermined is a declared state, not a silent default', () => {
  for (const [why, v] of [
    ['no severity data at all', {}],
    ['empty severity array', { severity: [] }],
    ['unparseable vector, no label', vec('garbage')],
    ['unmapped label, no vector', lab('SEVERE')],
    ['null input', null],
  ]) {
    test(why, () => {
      const g = gradeOf(v);
      assert.equal(g.severity, 'undetermined', why);
      assert.equal(g.severitySource, 'undetermined');
    });
  }
  test('a 0.0 vector falls through to the label rather than posing as a severity', () => {
    const none = 'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N';
    assert.equal(gradeOf(vec(none)).severity, 'undetermined');
    assert.equal(gradeOf(both(none, 'LOW')).severity, 'low', 'the label still answers');
  });
});

describe('severityReason — an undetermined that says why', () => {
  const V4 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
  const NONE = 'CVSS:3.1/AV:L/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N';   // scores 0.0

  test('a row graded by BOTH has no reason to give', () => {
    assert.equal(gradeOf(both(XSS, 'MODERATE')).severityReason, '');
    assert.equal(gradeOf(both(CRIT, 'LOW')).severityReason, '', 'a disagreement still had two votes');
  });

  test('one silent grader names itself even though the row still graded', () => {
    // grade right, coverage not — the reason this is not restricted to `undetermined`
    assert.equal(gradeOf(vec(XSS)).severityReason, 'label-absent');
    assert.equal(gradeOf(lab('HIGH')).severityReason, 'cvss-absent');
    assert.equal(gradeOf({ ...vec(V4), ...lab('HIGH') }).severityReason, 'cvss-unsupported-v4.0',
      'a parser blind spot must stay visible on a row the label rescued');
  });

  test('each silence is distinguished — they have different owners', () => {
    for (const [want, v] of [
      ['cvss-absent', lab('SEVERE')],
      ['cvss-unsupported-v4.0', { ...vec(V4), ...lab('SEVERE') }],
      ['cvss-unsupported-v2.0', { ...vec('CVSS:2.0/AV:N/AC:L'), ...lab('SEVERE') }],
      ['cvss-unparseable', { ...vec('CVSSnonsense'), ...lab('SEVERE') }],
      ['cvss-none', { ...vec(NONE), ...lab('SEVERE') }],
    ]) {
      assert.equal(gradeOf(v).severityReason.split('+')[0], want);
    }
    assert.equal(gradeOf(vec(XSS)).severityReason, 'label-absent');
    assert.equal(gradeOf(both(XSS, 'SEVERE')).severityReason, 'label-unrecognised');
  });

  test('when both fall silent the reason names both, in a fixed order', () => {
    assert.equal(gradeOf({}).severityReason, 'cvss-absent+label-absent');
    assert.equal(gradeOf({ ...vec(V4), ...lab('SEVERE') }).severityReason,
      'cvss-unsupported-v4.0+label-unrecognised');
    assert.equal(gradeOf(vec(NONE)).severityReason, 'cvss-none+label-absent');
  });

  test('the reason is a closed vocabulary — a free-text explanation is not queryable', () => {
    const CVSS_WHY = /^cvss-(absent|unparseable|none|unsupported-v\d+\.\d+)$/;
    const LABEL_WHY = /^label-(absent|unrecognised)$/;
    const inputs = [{}, null, undefined, vec(''), vec(V4), vec(NONE), vec('CVSSx'), vec(XSS),
      lab(''), lab('SEVERE'), lab('HIGH'), both(XSS, 'MODERATE'), both(CRIT, 'LOW'), both(NONE, 'LOW')];
    for (const i of inputs) {
      const r = gradeOf(i).severityReason;
      if (r === '') continue;
      const parts = r.split('+');
      assert.ok(parts.length <= 2, `too many reasons: ${r}`);
      for (const p of parts) {
        assert.ok(CVSS_WHY.test(p) || LABEL_WHY.test(p), `undeclared reason '${p}' in '${r}'`);
      }
    }
  });

  test('a reason never contradicts the source that produced the grade', () => {
    for (const i of [vec(XSS), lab('HIGH'), both(XSS, 'MODERATE'), { ...vec(V4), ...lab('HIGH') }, {}]) {
      const g = gradeOf(i);
      const r = g.severityReason;
      if (g.severitySource === 'cvss') assert.ok(!r.startsWith('cvss-'), `${r} vs source ${g.severitySource}`);
      if (g.severitySource === 'label') assert.ok(!r.includes('label-'), `${r} vs source ${g.severitySource}`);
      if (g.severitySource === 'undetermined') assert.ok(r.includes('cvss-') && r.includes('label-'), r);
    }
  });
});

describe('the local CVSS index fills gaps and never overrides', () => {
  const V4 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
  const id = 'GHSA-73rr-hh4g-fpgx';
  const withId = (v) => ({ ...v, id });
  const IDX = { [id]: { label: 'low', cve: 'CVE-2026-24001', v4: V4, s4: 9.3 } };

  test('a v4 vector OSV cannot score is graded from the indexed score', () => {
    // why the index exists: OSV ships the vector, GitHub ships the number
    const bare = gradeOf(withId(vec(V4)));
    assert.equal(bare.severity, 'undetermined');
    assert.equal(bare.severityReason, 'cvss-unsupported-v4.0+label-absent');

    const g = gradeOf(withId(vec(V4)), IDX);
    assert.equal(g.severity, 'crit', '9.3 bands to crit');
    assert.equal(g.cvssScore, 9.3);
    assert.equal(g.cvssVia, 'index');
    assert.equal(g.severityReason, '', 'both graders spoke once the index filled the gap');
  });

  test('OSV wins where OSV can answer — the index is never consulted', () => {
    const g = gradeOf(withId(vec(XSS)), IDX);
    assert.equal(g.cvssScore, 6.1, 'the indexed 9.3 must not displace a vector we scored ourselves');
    assert.equal(g.cvssVia, 'osv');
  });

  test('the index supplies a label only when OSV has none', () => {
    assert.equal(gradeOf(withId(both(XSS, 'CRITICAL')), IDX).label, 'CRITICAL');
    assert.equal(gradeOf(withId({}), IDX).label, 'low', 'gap filled');
  });

  test('an id absent from the index changes nothing', () => {
    const g = gradeOf({ ...vec(V4), id: 'GHSA-not-indexed' }, IDX);
    assert.equal(g.severity, 'undetermined');
    assert.equal(g.severityReason, 'cvss-unsupported-v4.0+label-absent');
    assert.equal(g.cvssVia, '');
  });

  test('an indexed entry GitHub could not score does not invent one', () => {
    const g = gradeOf(withId(vec(V4)), { [id]: { label: 'high' } });
    assert.equal(g.severity, 'high', 'the label still grades it');
    assert.equal(g.severitySource, 'label');
    assert.equal(g.cvssVia, '', 'no vector was scored, so nothing may claim to have supplied one');
    assert.equal(g.severityReason, 'cvss-unsupported-v4.0');
  });

  test('a v3 vector in the index is scored locally when it carries no score', () => {
    const g = gradeOf(withId({}), { [id]: { v3: XSS } });
    assert.equal(g.cvssScore, 6.1);
    assert.equal(g.cvssVia, 'index');
  });

  test('a null/empty index is exactly today\'s behaviour', () => {
    for (const idx of [null, undefined, {}]) {
      assert.equal(gradeOf(withId(vec(V4)), idx).severity, 'undetermined');
    }
  });
});

test('no input yields a value outside the declared set — the sentinel cannot come back', () => {
  const OK = new Set(['crit', 'high', 'med', 'low', 'undetermined']);
  const SOURCES = new Set(['agree', 'disagreement', 'cvss', 'label', 'undetermined']);
  const inputs = [{}, null, undefined, { severity: null }, { severity: [{}] }, vec(''), vec('CVSS:9.9/X:Y'),
    lab(''), lab('unknown-cvss'), both('garbage', 'nope'), both(CRIT, 'MODERATE'), vec(XSS), lab('HIGH')];
  for (const i of inputs) {
    const g = gradeOf(i);
    assert.ok(OK.has(g.severity), `severity '${g.severity}' escaped for ${JSON.stringify(i)}`);
    assert.ok(SOURCES.has(g.severitySource), `source '${g.severitySource}' escaped`);
    assert.ok(!String(g.severity).includes('unknown'), 'the unknown-cvss sentinel is back');
  }
});
