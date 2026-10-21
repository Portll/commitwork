// monitor/detector-basis.mjs — which analysts can be wrong TOGETHER.
//
// Agreement between two tools is corroboration only when they cannot share a failure mode. osv and
// npm audit both match one lockfile against one advisory feed; when the feed is wrong they agree on
// the same wrong answer, and counting that as two witnesses launders one failure through the word
// for two. The class map in detector-basis.json names each analyst's method and data source, and
// this module answers "how many distinct bases saw this" so corroboration.mjs and corroborate.mjs
// can say `same-basis` where they used to say `corroborated`. An analyst with no class is
// `unclassified` and never counts as independent.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const UNCLASSIFIED = 'unclassified';

export const basisPath = () => process.env.CW_DETECTOR_BASIS || join(HERE, 'detector-basis.json');

/**
 * The class map. ENOENT is the one legitimate absence and yields an empty map, under which every
 * analyst is unclassified; a file that exists and cannot be parsed, or that binds a detector to an
 * undeclared class, throws.
 */
export function loadBasisMap(path = basisPath()) {
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    if (e && e.code === 'ENOENT') return { classes: {}, detectors: {} };
    throw e;
  }
  const classes = doc && doc.classes && typeof doc.classes === 'object' ? doc.classes : null;
  const detectors = doc && doc.detectors && typeof doc.detectors === 'object' ? doc.detectors : null;
  if (!classes || !detectors) throw new Error(`${path}: a detector-basis map needs \`classes\` and \`detectors\` objects`);
  if (Object.hasOwn(classes, UNCLASSIFIED)) throw new Error(`${path}: '${UNCLASSIFIED}' is reserved and may not be declared as a class`);
  for (const [det, cls] of Object.entries(detectors)) {
    if (typeof cls !== 'string' || !Object.hasOwn(classes, cls)) {
      throw new Error(`${path}: detector '${det}' names class '${cls}', which \`classes\` does not declare`);
    }
  }
  return { classes, detectors };
}

/** The failure-mode class of one analyst, or `unclassified`. */
export function basisOf(detector, map = loadBasisMap()) {
  const cls = map && map.detectors ? map.detectors[String(detector)] : undefined;
  return typeof cls === 'string' ? cls : UNCLASSIFIED;
}

/**
 * Bases for a set of analysts, in sorted analyst order so the output is byte-stable whatever order
 * the analysts arrived in.
 *
 * Returns { bases: {analyst: class}, independentBases: n, unclassified: [analyst] } where
 * independentBases counts DISTINCT declared classes and never the unclassified.
 */
export function basesOf(detectors, map = loadBasisMap()) {
  const bases = {};
  const unclassified = [];
  const distinct = new Set();
  for (const d of [...new Set((detectors || []).map(String))].sort()) {
    const cls = basisOf(d, map);
    bases[d] = cls;
    if (cls === UNCLASSIFIED) unclassified.push(d);
    else distinct.add(cls);
  }
  return { bases, independentBases: distinct.size, unclassified };
}

/**
 * The word for two or more agreeing analysts: `corroborated` when at least two distinct declared
 * classes saw it, `same-basis` otherwise. One analyst is `single`.
 */
export function agreementWord(detectors, map = loadBasisMap()) {
  const ids = [...new Set((detectors || []).map(String))];
  if (ids.length < 2) return 'single';
  return basesOf(ids, map).independentBases >= 2 ? 'corroborated' : 'same-basis';
}

export default { UNCLASSIFIED, basisPath, loadBasisMap, basisOf, basesOf, agreementWord };
