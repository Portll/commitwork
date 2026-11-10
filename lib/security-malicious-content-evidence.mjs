/**
 * @typedef {'installed-dependency'|'vendored-javascript'|'model-serialization'|'dataset-loader'} SubjectType
 * @typedef {'completed'|'failed'|'unavailable'} ScannerOutcome
 * @typedef {'code-execution-on-load'|'dangerous-opcode-demonstrated'|'network-exfiltration-observed'|'file-write-outside-root-observed'} Behaviour
 * @typedef {'install-hook'|'network-capability'|'obfuscation'|'remote-data-path'|'dynamic-eval'|'unsafe-deserializer-reference'} Capability
 * @typedef {'unreadable'|'oversize'|'excluded'} GapReason
 * @typedef {{behaviour: Behaviour, detail: string}} ObservedEntry
 * @typedef {{capability: Capability, detail: string}} StaticEntry
 * @typedef {{path: string, why: string}} UnreadableEntry
 * @typedef {{observed: ObservedEntry[], static: StaticEntry[], unreadable: UnreadableEntry[]}} Evidence
 * @typedef {{id: string, type: SubjectType, scannerOutcome: ScannerOutcome, advisoryIds: string[], evidence: Evidence}} Subject
 * @typedef {{subject: string, reason: GapReason, detail: string}} Gap
 * @typedef {{subjects: Subject[], coverage: {gaps: Gap[]}}} Input
 * @typedef {{subject: string, type: SubjectType, class: string, confidence: string, observed: ObservedEntry[], static: StaticEntry[], unreadable: UnreadableEntry[], gaps: Gap[], advisoryIds: string[]}} Observation
 * @typedef {{observations: Observation[], gaps: Gap[]}} Output
 */

/**
 * @param {Input} input
 * @returns {Output}
 */
export function contentEvidence({ subjects, coverage }) {
  // Validate top-level
  if (!subjects || !Array.isArray(subjects)) throw new TypeError('subjects');
  if (!coverage || typeof coverage !== 'object' || !Array.isArray(coverage.gaps)) throw new TypeError('coverage.gaps');

  // Allowed values
  const allowedTypes = new Set(['installed-dependency', 'vendored-javascript', 'model-serialization', 'dataset-loader']);
  const allowedOutcomes = new Set(['completed', 'failed', 'unavailable']);
  const allowedBehaviours = new Set(['code-execution-on-load', 'dangerous-opcode-demonstrated', 'network-exfiltration-observed', 'file-write-outside-root-observed']);
  const allowedCapabilities = new Set(['install-hook', 'network-capability', 'obfuscation', 'remote-data-path', 'dynamic-eval', 'unsafe-deserializer-reference']);
  const allowedGapReasons = new Set(['unreadable', 'oversize', 'excluded']);

  // Track subject ids for duplicates and gap validation
  const subjectIds = new Set();
  const subjectMap = new Map();

  // Validate subjects
  for (const subj of subjects) {
    if (!subj || typeof subj !== 'object') throw new TypeError('subject');
    const { id, type, scannerOutcome, advisoryIds, evidence } = subj;
    if (typeof id !== 'string' || id === '') throw new TypeError('subject.id');
    if (subjectIds.has(id)) throw new TypeError('subject.id duplicate');
    subjectIds.add(id);
    if (!allowedTypes.has(type)) throw new TypeError('subject.type');
    if (!allowedOutcomes.has(scannerOutcome)) throw new TypeError('subject.scannerOutcome');
    if (!Array.isArray(advisoryIds) || !advisoryIds.every(a => typeof a === 'string' && a !== '')) throw new TypeError('subject.advisoryIds');
    if (!evidence || typeof evidence !== 'object') throw new TypeError('subject.evidence');
    const { observed, static: staticArr, unreadable } = evidence;
    if (!Array.isArray(observed)) throw new TypeError('subject.evidence.observed');
    if (!Array.isArray(staticArr)) throw new TypeError('subject.evidence.static');
    if (!Array.isArray(unreadable)) throw new TypeError('subject.evidence.unreadable');
    for (const obs of observed) {
      if (!obs || typeof obs !== 'object') throw new TypeError('subject.evidence.observed entry');
      if (!allowedBehaviours.has(obs.behaviour)) throw new TypeError('subject.evidence.observed.behaviour');
      if (typeof obs.detail !== 'string') throw new TypeError('subject.evidence.observed.detail');
    }
    for (const sta of staticArr) {
      if (!sta || typeof sta !== 'object') throw new TypeError('subject.evidence.static entry');
      if (!allowedCapabilities.has(sta.capability)) throw new TypeError('subject.evidence.static.capability');
      if (typeof sta.detail !== 'string') throw new TypeError('subject.evidence.static.detail');
    }
    for (const unr of unreadable) {
      if (!unr || typeof unr !== 'object') throw new TypeError('subject.evidence.unreadable entry');
      if (typeof unr.path !== 'string') throw new TypeError('subject.evidence.unreadable.path');
      if (typeof unr.why !== 'string') throw new TypeError('subject.evidence.unreadable.why');
    }
    subjectMap.set(id, subj);
  }

  // Validate gaps
  for (const gap of coverage.gaps) {
    if (!gap || typeof gap !== 'object') throw new TypeError('coverage.gaps entry');
    const { subject, reason, detail } = gap;
    if (typeof subject !== 'string' || !subjectIds.has(subject)) throw new TypeError('coverage.gaps.subject');
    if (!allowedGapReasons.has(reason)) throw new TypeError('coverage.gaps.reason');
    if (typeof detail !== 'string') throw new TypeError('coverage.gaps.detail');
  }

  const byGap = (a, b) => {
    for (const f of ['subject', 'reason', 'detail']) {
      if (a[f] !== b[f]) return a[f] < b[f] ? -1 : 1;
    }
    return 0;
  };
  const sortedGaps = coverage.gaps.map((g) => ({ subject: g.subject, reason: g.reason, detail: g.detail })).sort(byGap);

  const gapsBySubject = new Map();
  for (const gap of sortedGaps) {
    const arr = gapsBySubject.get(gap.subject) || [];
    arr.push(gap);
    gapsBySubject.set(gap.subject, arr);
  }

  // Classify each subject
  const observations = [];
  for (const subj of subjects) {
    const { id, type, scannerOutcome, advisoryIds, evidence } = subj;
    const subjectGaps = gapsBySubject.get(id) || [];
    const hasOversizeOrExcluded = subjectGaps.some(g => g.reason === 'oversize' || g.reason === 'excluded');
    const hasUnreadableGap = subjectGaps.some(g => g.reason === 'unreadable');

    let cls, confidence;
    if (evidence.observed.length > 0) {
      cls = 'dangerous-behaviour';
      confidence = 'demonstrated';
    } else if (scannerOutcome === 'failed' || scannerOutcome === 'unavailable' || hasOversizeOrExcluded) {
      cls = 'not-examined';
      confidence = 'none';
    } else if (evidence.unreadable.length > 0 || hasUnreadableGap) {
      cls = 'unreadable';
      confidence = 'none';
    } else if (evidence.static.length > 0) {
      cls = 'candidate';
      confidence = 'needs-context';
    } else if (scannerOutcome === 'completed' && subjectGaps.length === 0 && evidence.observed.length === 0 && evidence.static.length === 0 && evidence.unreadable.length === 0) {
      cls = 'nothing-observed';
      confidence = 'none';
    } else {
      // This should not happen given the exhaustive conditions, but throw if it does.
      throw new Error(`Unclassifiable subject ${id}`);
    }

    observations.push({
      subject: id,
      type,
      class: cls,
      confidence,
      observed: evidence.observed,
      static: evidence.static,
      unreadable: evidence.unreadable,
      gaps: subjectGaps,
      advisoryIds
    });
  }

  observations.sort((a, b) => a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0);
  return { observations, gaps: sortedGaps };
}
