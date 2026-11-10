import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { contentEvidence } from '../../lib/security-malicious-content-evidence.mjs';

describe('contentEvidence', () => {
  const baseSubject = {
    id: 's1',
    type: 'installed-dependency',
    scannerOutcome: 'completed',
    advisoryIds: ['ADV-1'],
    evidence: { observed: [], static: [], unreadable: [] }
  };

  const baseCoverage = { gaps: [] };

  function makeInput(subjects, gaps = []) {
    return { subjects, coverage: { gaps } };
  }

  describe('validation', () => {
    it('throws on missing subjects', () => {
      throws(() => contentEvidence({ coverage: { gaps: [] } }), /subjects/);
    });

    it('throws on non-array subjects', () => {
      throws(() => contentEvidence({ subjects: {}, coverage: { gaps: [] } }), /subjects/);
    });

    it('throws on missing coverage.gaps', () => {
      throws(() => contentEvidence({ subjects: [] }), /coverage.gaps/);
    });

    it('throws on non-array coverage.gaps', () => {
      throws(() => contentEvidence({ subjects: [], coverage: { gaps: {} } }), /coverage.gaps/);
    });

    it('throws on duplicate subject id', () => {
      const subj = { ...baseSubject };
      throws(() => contentEvidence(makeInput([subj, subj])), /subject.id duplicate/);
    });

    it('throws on unknown subject type', () => {
      const subj = { ...baseSubject, type: 'unknown' };
      throws(() => contentEvidence(makeInput([subj])), /subject.type/);
    });

    it('throws on unknown scannerOutcome', () => {
      const subj = { ...baseSubject, scannerOutcome: 'unknown' };
      throws(() => contentEvidence(makeInput([subj])), /subject.scannerOutcome/);
    });

    it('throws on empty advisoryIds entry', () => {
      const subj = { ...baseSubject, advisoryIds: [''] };
      throws(() => contentEvidence(makeInput([subj])), /subject.advisoryIds/);
    });

    it('throws on non-array advisoryIds', () => {
      const subj = { ...baseSubject, advisoryIds: 'ADV-1' };
      throws(() => contentEvidence(makeInput([subj])), /subject.advisoryIds/);
    });

    it('throws on missing evidence', () => {
      const subj = { ...baseSubject, evidence: null };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence/);
    });

    it('throws on non-array observed', () => {
      const subj = { ...baseSubject, evidence: { observed: {}, static: [], unreadable: [] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.observed/);
    });

    it('throws on unknown behaviour', () => {
      const subj = { ...baseSubject, evidence: { observed: [{ behaviour: 'unknown', detail: 'x' }], static: [], unreadable: [] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.observed.behaviour/);
    });

    it('throws on non-string observed detail', () => {
      const subj = { ...baseSubject, evidence: { observed: [{ behaviour: 'code-execution-on-load', detail: 123 }], static: [], unreadable: [] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.observed.detail/);
    });

    it('throws on unknown capability', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [{ capability: 'unknown', detail: 'x' }], unreadable: [] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.static.capability/);
    });

    it('throws on non-string static detail', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [{ capability: 'install-hook', detail: 123 }], unreadable: [] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.static.detail/);
    });

    it('throws on non-string unreadable path', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [], unreadable: [{ path: 123, why: 'x' }] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.unreadable.path/);
    });

    it('throws on non-string unreadable why', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [], unreadable: [{ path: 'x', why: 123 }] } };
      throws(() => contentEvidence(makeInput([subj])), /subject.evidence.unreadable.why/);
    });

    it('throws on gap referencing unknown subject', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 'unknown', reason: 'unreadable', detail: 'x' }];
      throws(() => contentEvidence(makeInput([subj], gaps)), /coverage.gaps.subject/);
    });

    it('throws on unknown gap reason', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 's1', reason: 'unknown', detail: 'x' }];
      throws(() => contentEvidence(makeInput([subj], gaps)), /coverage.gaps.reason/);
    });

    it('throws on non-string gap detail', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 's1', reason: 'unreadable', detail: 123 }];
      throws(() => contentEvidence(makeInput([subj], gaps)), /coverage.gaps.detail/);
    });
  });

  describe('classification', () => {
    it('dangerous-behaviour when observed non-empty', () => {
      const subj = { ...baseSubject, evidence: { observed: [{ behaviour: 'code-execution-on-load', detail: 'exec' }], static: [], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'dangerous-behaviour');
      strictEqual(observations[0].confidence, 'demonstrated');
    });

    it('dangerous-behaviour stays reportable with empty advisoryIds', () => {
      const subj = { ...baseSubject, advisoryIds: [], evidence: { observed: [{ behaviour: 'code-execution-on-load', detail: 'exec' }], static: [], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'dangerous-behaviour');
      deepStrictEqual(observations[0].advisoryIds, []);
    });

    it('not-examined when scannerOutcome failed', () => {
      const subj = { ...baseSubject, scannerOutcome: 'failed' };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'not-examined');
      strictEqual(observations[0].confidence, 'none');
    });

    it('not-examined when scannerOutcome unavailable', () => {
      const subj = { ...baseSubject, scannerOutcome: 'unavailable' };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'not-examined');
      strictEqual(observations[0].confidence, 'none');
    });

    it('not-examined when oversize gap present', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 's1', reason: 'oversize', detail: 'too big' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      deepStrictEqual(observations[0].class, 'not-examined');
      strictEqual(observations[0].confidence, 'none');
    });

    it('not-examined when excluded gap present', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 's1', reason: 'excluded', detail: 'excluded' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      deepStrictEqual(observations[0].class, 'not-examined');
      strictEqual(observations[0].confidence, 'none');
    });

    it('unreadable when evidence.unreadable non-empty', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [], unreadable: [{ path: 'x', why: 'perm' }] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'unreadable');
      strictEqual(observations[0].confidence, 'none');
    });

    it('unreadable when unreadable gap present', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 's1', reason: 'unreadable', detail: 'perm' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      deepStrictEqual(observations[0].class, 'unreadable');
      strictEqual(observations[0].confidence, 'none');
    });

    it('candidate when static non-empty', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [{ capability: 'install-hook', detail: 'hook' }], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'candidate');
      strictEqual(observations[0].confidence, 'needs-context');
    });

    it('candidate never labelled malware (class is candidate)', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [{ capability: 'dynamic-eval', detail: 'eval' }], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'candidate');
    });

    it('nothing-observed when completed, no gaps, all evidence empty', () => {
      const subj = { ...baseSubject };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'nothing-observed');
      strictEqual(observations[0].confidence, 'none');
    });

    it('not-examined takes precedence over unreadable when both oversize gap and unreadable evidence', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [], unreadable: [{ path: 'x', why: 'perm' }] } };
      const gaps = [{ subject: 's1', reason: 'oversize', detail: 'big' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      deepStrictEqual(observations[0].class, 'not-examined');
    });

    it('unreadable takes precedence over candidate when unreadable evidence and static', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [{ capability: 'install-hook', detail: 'hook' }], unreadable: [{ path: 'x', why: 'perm' }] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'unreadable');
    });

    it('candidate takes precedence over nothing-observed when static present', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [{ capability: 'install-hook', detail: 'hook' }], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].class, 'candidate');
    });
  });

  describe('sorting', () => {
    it('observations sorted by subject id', () => {
      const subj1 = { ...baseSubject, id: 'b' };
      const subj2 = { ...baseSubject, id: 'a' };
      const { observations } = contentEvidence(makeInput([subj1, subj2]));
      strictEqual(observations[0].subject, 'a');
      strictEqual(observations[1].subject, 'b');
    });

    it('gaps sorted by subject then reason', () => {
      const subj = { ...baseSubject };
      const gaps = [
        { subject: 's1', reason: 'oversize', detail: '1' },
        { subject: 's1', reason: 'unreadable', detail: '2' },
        { subject: 's1', reason: 'excluded', detail: '3' }
      ];
      const { gaps: sorted } = contentEvidence(makeInput([subj], gaps));
      strictEqual(sorted[0].reason, 'excluded');
      strictEqual(sorted[1].reason, 'oversize');
      strictEqual(sorted[2].reason, 'unreadable');
    });

    it('gaps across multiple subjects sorted by subject then reason', () => {
      const subj1 = { ...baseSubject, id: 's1' };
      const subj2 = { ...baseSubject, id: 's2' };
      const gaps = [
        { subject: 's2', reason: 'unreadable', detail: '1' },
        { subject: 's1', reason: 'oversize', detail: '2' },
        { subject: 's1', reason: 'excluded', detail: '3' }
      ];
      const { gaps: sorted } = contentEvidence(makeInput([subj1, subj2], gaps));
      strictEqual(sorted[0].subject, 's1');
      strictEqual(sorted[0].reason, 'excluded');
      strictEqual(sorted[1].subject, 's1');
      strictEqual(sorted[1].reason, 'oversize');
      strictEqual(sorted[2].subject, 's2');
      strictEqual(sorted[2].reason, 'unreadable');
    });
  });

  describe('output structure', () => {
    it('observation includes all required fields', () => {
      const subj = { ...baseSubject, evidence: { observed: [{ behaviour: 'code-execution-on-load', detail: 'x' }], static: [], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      const obs = observations[0];
      assert.ok('subject' in obs);
      assert.ok('type' in obs);
      assert.ok('class' in obs);
      assert.ok('confidence' in obs);
      assert.ok('observed' in obs);
      assert.ok('static' in obs);
      assert.ok('unreadable' in obs);
      assert.ok('gaps' in obs);
      assert.ok('advisoryIds' in obs);
    });

    it('gaps in observation are the ones for that subject', () => {
      const subj = { ...baseSubject };
      const gaps = [
        { subject: 's1', reason: 'unreadable', detail: 'x' },
        { subject: 's1', reason: 'oversize', detail: 'y' }
      ];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      deepStrictEqual(observations[0].gaps.map((g) => g.reason), ['oversize', 'unreadable']);
    });

    it('advisoryIds passed through', () => {
      const subj = { ...baseSubject, advisoryIds: ['ADV-1', 'ADV-2'] };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].advisoryIds, ['ADV-1', 'ADV-2']);
    });

    it('evidence arrays passed through', () => {
      const observed = [{ behaviour: 'code-execution-on-load', detail: 'x' }];
      const staticArr = [{ capability: 'install-hook', detail: 'y' }];
      const unreadable = [{ path: 'z', why: 'perm' }];
      const subj = { ...baseSubject, evidence: { observed, static: staticArr, unreadable } };
      const { observations } = contentEvidence(makeInput([subj]));
      deepStrictEqual(observations[0].observed, observed);
      deepStrictEqual(observations[0].static, staticArr);
      deepStrictEqual(observations[0].unreadable, unreadable);
    });
  });

  describe('boundary cases', () => {
    it('all subject types allowed', () => {
      const types = ['installed-dependency', 'vendored-javascript', 'model-serialization', 'dataset-loader'];
      for (const type of types) {
        const subj = { ...baseSubject, id: type, type };
        const { observations } = contentEvidence(makeInput([subj]));
        strictEqual(observations[0].type, type);
      }
    });

    it('all scannerOutcomes allowed', () => {
      const outcomes = ['completed', 'failed', 'unavailable'];
      for (const outcome of outcomes) {
        const subj = { ...baseSubject, id: outcome, scannerOutcome: outcome };
        const { observations } = contentEvidence(makeInput([subj]));
        // just ensure no throw
        assert.ok(observations[0]);
      }
    });

    it('all behaviours allowed', () => {
      const behaviours = ['code-execution-on-load', 'dangerous-opcode-demonstrated', 'network-exfiltration-observed', 'file-write-outside-root-observed'];
      for (const behaviour of behaviours) {
        const subj = { ...baseSubject, id: behaviour, evidence: { observed: [{ behaviour, detail: 'x' }], static: [], unreadable: [] } };
        const { observations } = contentEvidence(makeInput([subj]));
        strictEqual(observations[0].class, 'dangerous-behaviour');
      }
    });

    it('all capabilities allowed', () => {
      const capabilities = ['install-hook', 'network-capability', 'obfuscation', 'remote-data-path', 'dynamic-eval', 'unsafe-deserializer-reference'];
      for (const capability of capabilities) {
        const subj = { ...baseSubject, id: capability, evidence: { observed: [], static: [{ capability, detail: 'x' }], unreadable: [] } };
        const { observations } = contentEvidence(makeInput([subj]));
        strictEqual(observations[0].class, 'candidate');
      }
    });

    it('all gap reasons allowed', () => {
      const reasons = ['unreadable', 'oversize', 'excluded'];
      for (const reason of reasons) {
        const subj = { ...baseSubject };
        const gaps = [{ subject: 's1', reason, detail: 'x' }];
        const { observations } = contentEvidence(makeInput([subj], gaps));
        // just ensure no throw
        assert.ok(observations[0]);
      }
    });

    it('empty arrays are valid', () => {
      const subj = { ...baseSubject, evidence: { observed: [], static: [], unreadable: [] } };
      const { observations } = contentEvidence(makeInput([subj]));
      strictEqual(observations[0].class, 'nothing-observed');
    });

    it('subject with gaps but no evidence unreadable and not oversize/excluded -> unreadable class', () => {
      const subj = { ...baseSubject };
      const gaps = [{ subject: 's1', reason: 'unreadable', detail: 'x' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      strictEqual(observations[0].class, 'unreadable');
    });

    it('subject with oversize gap and completed scannerOutcome -> not-examined', () => {
      const subj = { ...baseSubject, scannerOutcome: 'completed' };
      const gaps = [{ subject: 's1', reason: 'oversize', detail: 'x' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      strictEqual(observations[0].class, 'not-examined');
    });

    it('subject with excluded gap and completed scannerOutcome -> not-examined', () => {
      const subj = { ...baseSubject, scannerOutcome: 'completed' };
      const gaps = [{ subject: 's1', reason: 'excluded', detail: 'x' }];
      const { observations } = contentEvidence(makeInput([subj], gaps));
      strictEqual(observations[0].class, 'not-examined');
    });

    it('subject with failed scannerOutcome and no gaps -> not-examined', () => {
      const subj = { ...baseSubject, scannerOutcome: 'failed' };
      const { observations } = contentEvidence(makeInput([subj]));
      strictEqual(observations[0].class, 'not-examined');
    });

    it('subject with unavailable scannerOutcome and no gaps -> not-examined', () => {
      const subj = { ...baseSubject, scannerOutcome: 'unavailable' };
      const { observations } = contentEvidence(makeInput([subj]));
      strictEqual(observations[0].class, 'not-examined');
    });

    it('deterministic output for same input regardless of order', () => {
      const subj1 = { ...baseSubject, id: 'a', evidence: { observed: [], static: [{ capability: 'install-hook', detail: 'x' }], unreadable: [] } };
      const subj2 = { ...baseSubject, id: 'b', evidence: { observed: [{ behaviour: 'code-execution-on-load', detail: 'y' }], static: [], unreadable: [] } };
      const gaps = [
        { subject: 'a', reason: 'unreadable', detail: 'g1' },
        { subject: 'b', reason: 'oversize', detail: 'g2' }
      ];
      const input1 = makeInput([subj1, subj2], gaps);
      const input2 = makeInput([subj2, subj1], [...gaps].reverse());
      const out1 = contentEvidence(input1);
      const out2 = contentEvidence(input2);
      deepStrictEqual(out1, out2);
    });

    it('a subject with several gaps lists them in the same order whatever the input order', () => {
      const gaps = [
        { subject: 's1', reason: 'unreadable', detail: 'b.bin' },
        { subject: 's1', reason: 'oversize', detail: 'z.pt' },
        { subject: 's1', reason: 'unreadable', detail: 'a.bin' }
      ];
      const out1 = contentEvidence(makeInput([baseSubject], gaps));
      const out2 = contentEvidence(makeInput([baseSubject], [...gaps].reverse()));
      deepStrictEqual(out1, out2);
      deepStrictEqual(out1.observations[0].gaps.map((g) => g.detail), ['z.pt', 'a.bin', 'b.bin']);
      deepStrictEqual(out1.gaps, out1.observations[0].gaps);
    });
  });
});
