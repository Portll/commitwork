// commitwork learning view — rebuilt from issue-store events; never an independent source of truth.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stableStringify, writeJSONAtomic } from '../cra/lib.mjs';
import { summaryTokens, jaccard } from '../lib/text-similarity.mjs';
import { validateAgainstSchema } from './registry.mjs';
import { acquireLock } from './lockfile.mjs';
import { REMEDIATION_EVENT_TYPES } from './issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_LEARNING_POLICY = Object.freeze({
  rampObservations: 8,
  weightFloor: 0.05,
  strongWeightFloor: 0.20,
  learningDecayRate: Math.log(2) / 90,
  reinforceBonus: 0.15,
  contradictionPenalty: 0.25,
  jaccardThreshold: 0.45,
  minSupport: 3,
  tierStrongMinObservations: 4,
  tierStrongMinConfidence: 0.75,
  tierMediumMinConfidence: 0.5,
  tierWeakMaxObservations: 2,
});

export const LEARNING_EVENT_TYPES = REMEDIATION_EVENT_TYPES;

const LEARNING_EVENTS = new Set(LEARNING_EVENT_TYPES);
const DAY_MS = 86_400_000;

export const learningPath = () => resolve(process.env.CW_LEARNING || join(HERE, 'data', 'learning.json'));
export const learningSchemaPath = () => resolve(process.env.CW_LEARNING_SCHEMA || join(HERE, '..', 'schema', 'learning.schema.json'));

const finite = (value, name, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`learning policy ${name} must be in [${min},${max}]`);
  return n;
};

export function resolveLearningPolicy(policy = {}) {
  const supplied = policy.learningParameters || policy.learningPolicy || policy;
  const merged = { ...DEFAULT_LEARNING_POLICY, ...(supplied || {}) };
  return {
    rampObservations: finite(merged.rampObservations, 'rampObservations', { min: 1 }),
    weightFloor: finite(merged.weightFloor, 'weightFloor', { min: 0, max: 1 }),
    strongWeightFloor: finite(merged.strongWeightFloor, 'strongWeightFloor', { min: 0, max: 1 }),
    learningDecayRate: finite(merged.learningDecayRate, 'learningDecayRate', { min: 0 }),
    reinforceBonus: finite(merged.reinforceBonus, 'reinforceBonus', { min: 0, max: 1 }),
    contradictionPenalty: finite(merged.contradictionPenalty, 'contradictionPenalty', { min: 0, max: 1 }),
    jaccardThreshold: finite(merged.jaccardThreshold, 'jaccardThreshold', { min: 0, max: 1 }),
    minSupport: finite(merged.minSupport, 'minSupport', { min: 1 }),
    tierStrongMinObservations: finite(merged.tierStrongMinObservations, 'tierStrongMinObservations', { min: 0 }),
    tierStrongMinConfidence: finite(merged.tierStrongMinConfidence, 'tierStrongMinConfidence', { min: 0, max: 1 }),
    tierMediumMinConfidence: finite(merged.tierMediumMinConfidence, 'tierMediumMinConfidence', { min: 0, max: 1 }),
    tierWeakMaxObservations: finite(merged.tierWeakMaxObservations, 'tierWeakMaxObservations', { min: 0 }),
  };
}

const instant = (value, label) => {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new Error(`${label} is not an ISO instant: ${JSON.stringify(value)}`);
  return ms;
};

export const patternKey = ({ rule, pathPrefix, package: pkg = null }) => `${rule}|${pathPrefix}|${pkg || ''}`;

function learningFact(event) {
  if (!LEARNING_EVENTS.has(event?.type)) return null;
  const data = event.data || {};
  const pattern = data.pattern || data;
  if (typeof pattern.rule !== 'string' || !pattern.rule
    || typeof pattern.pathPrefix !== 'string' || !pattern.pathPrefix) {
    throw new Error(`${event.type} ${event.issueId || '(unknown issue)'} has no rule/pathPrefix learning key`);
  }
  if (pattern.package !== undefined && pattern.package !== null && typeof pattern.package !== 'string') {
    throw new Error(`${event.type} ${event.issueId || '(unknown issue)'} has a non-string package`);
  }
  if (typeof event.hash !== 'string' || !event.hash) throw new Error(`${event.type} ${event.issueId || '(unknown issue)'} has no event hash`);
  instant(event.at, `${event.type} at`);

  const contradicted = event.type === 'fix-disputed'
    || event.type === 'reopened-contradiction'
    || (event.type === 'fp-reinvestigated' && data.outcome === 'contradicted');
  const evidence = data.evidence && typeof data.evidence === 'object' ? data.evidence : {};
  const annotator = evidence.who ?? data.who ?? data.actor ?? null;
  return {
    event,
    rule: pattern.rule,
    pathPrefix: pattern.pathPrefix,
    package: pattern.package || null,
    helpful: !contradicted,
    note: typeof evidence.note === 'string' ? evidence.note.trim() : '',
    annotator: typeof annotator === 'string' && annotator.trim() ? annotator.trim() : null,
  };
}

const compareFacts = (a, b) => String(a.event.at).localeCompare(String(b.event.at))
  || String(a.event.issueId).localeCompare(String(b.event.issueId))
  || String(a.event.type).localeCompare(String(b.event.type))
  || stableStringify(a.event.data).localeCompare(stableStringify(b.event.data))
  || String(a.event.hash).localeCompare(String(b.event.hash));

export function confidenceFromEvents(events, policy = DEFAULT_LEARNING_POLICY) {
  const cfg = resolveLearningPolicy(policy);
  let alpha = 1;
  let beta = 1;
  for (const event of events) {
    const fact = event?.event ? event : learningFact(event);
    if (!fact) continue;
    if (fact.helpful) alpha += 1;
    else beta += 1;
  }
  const observations = alpha + beta - 2;
  const ramp = Math.min(1, Math.max(0, observations / cfg.rampObservations));
  const bayesian = alpha / (alpha + beta);
  const calibratedConfidence = (1 - ramp) * 0.5 + ramp * bayesian;
  const tier = observations < cfg.tierWeakMaxObservations ? 'weak'
    : calibratedConfidence >= cfg.tierStrongMinConfidence && observations >= cfg.tierStrongMinObservations ? 'strong'
      : calibratedConfidence >= cfg.tierMediumMinConfidence ? 'medium' : 'weak';
  return { confidenceAlpha: alpha, confidenceBeta: beta, observations, calibratedConfidence, tier };
}

export function decayWeight(weight, gapDays, floor, policy = DEFAULT_LEARNING_POLICY) {
  const cfg = resolveLearningPolicy(policy);
  const gap = finite(gapDays, 'gapDays', { min: 0 });
  const anchor = finite(floor, 'floor', { min: 0, max: 1 });
  return Math.min(1, Math.max(anchor, weight * Math.exp(-cfg.learningDecayRate * gap)));
}

function weightFromFacts(facts, nowMs, tier, cfg) {
  const floor = tier === 'strong' ? cfg.strongWeightFloor : cfg.weightFloor;
  let weight = 1;
  let lastMs = null;
  for (const fact of facts) {
    const atMs = instant(fact.event.at, `${fact.event.type} at`);
    if (lastMs !== null && atMs < lastMs) {
      throw new Error(`learning events for ${patternKey(fact)} are out of chronological order`);
    }
    if (lastMs !== null) weight = decayWeight(weight, (atMs - lastMs) / DAY_MS, floor, cfg);
    weight = fact.helpful ? Math.min(1, weight + cfg.reinforceBonus)
      : Math.max(floor, weight - cfg.contradictionPenalty);
    lastMs = atMs;
  }
  if (lastMs !== null) {
    if (nowMs < lastMs) throw new Error(`learning rebuild time precedes the last event for ${patternKey(facts.at(-1))}`);
    weight = decayWeight(weight, (nowMs - lastMs) / DAY_MS, floor, cfg);
  }
  return weight;
}

function consolidate(facts, cfg) {
  const candidates = facts.filter((f) => f.note).sort(compareFacts);
  const clusters = [];
  for (const candidate of candidates) {
    const tokens = summaryTokens(candidate.note);
    if (!tokens.size) continue;
    let best = -1;
    let bestSimilarity = 0;
    for (let i = 0; i < clusters.length; i += 1) {
      const similarity = jaccard(tokens, clusters[i].tokens);
      if (similarity > bestSimilarity) { bestSimilarity = similarity; best = i; }
    }
    if (best >= 0 && bestSimilarity >= cfg.jaccardThreshold) {
      for (const token of tokens) clusters[best].tokens.add(token);
      clusters[best].members.push(candidate);
    } else {
      clusters.push({ tokens, members: [candidate] });
    }
  }

  const supported = clusters.filter((cluster) => cluster.members.length >= cfg.minSupport);
  if (!supported.length) return null;
  supported.sort((a, b) => b.members.length - a.members.length
    || compareFacts(b.members.at(-1), a.members.at(-1)));
  const members = supported[0].members;
  const representative = members.reduce((latest, candidate) =>
    String(candidate.event.at) > String(latest.event.at) ? candidate : latest);
  return {
    text: representative.note,
    supportCount: members.length,
    sourceAnnotations: members.map((m) => m.event.hash).sort(),
  };
}

export function emptyLearningDoc({ now, policy = DEFAULT_LEARNING_POLICY, sourceEventCount = 0, sourceChainHead = null } = {}) {
  const generatedAt = new Date(now ?? process.env.CW_NOW ?? Date.now()).toISOString();
  return {
    note: 'commitwork learning view — regenerated from monitor/issues.json events[] (+ CW_NOW at rebuild). Never edit by hand. Verify: node bin/learning-rebuild.mjs --verify',
    version: 1,
    generatedAt,
    sourceEventCount,
    sourceChainHead,
    policySnapshot: resolveLearningPolicy(policy),
    patterns: {},
  };
}

export function rebuildLearning({ issuesDoc, now = process.env.CW_NOW || new Date(), policy = DEFAULT_LEARNING_POLICY } = {}) {
  if (!issuesDoc || !Array.isArray(issuesDoc.events)) throw new Error('learning rebuild requires an issue store with events[]');
  const generatedAt = new Date(now).toISOString();
  const nowMs = instant(generatedAt, 'learning rebuild time');
  const cfg = resolveLearningPolicy(policy);
  const grouped = new Map();
  for (const event of issuesDoc.events) {
    const fact = learningFact(event);
    if (!fact) continue;
    const key = patternKey(fact);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(fact);
  }

  const doc = emptyLearningDoc({
    now: generatedAt,
    policy: cfg,
    sourceEventCount: issuesDoc.events.length,
    sourceChainHead: issuesDoc.events.at(-1)?.hash || null,
  });
  for (const key of [...grouped.keys()].sort()) {
    const facts = grouped.get(key);
    const confidence = confidenceFromEvents(facts, cfg);
    const orderedCitations = [...facts].sort(compareFacts).map((fact) => fact.event.hash);
    const last = facts.at(-1);
    const annotators = new Set(facts.map((fact) => fact.annotator).filter(Boolean));
    doc.patterns[key] = {
      rule: facts[0].rule,
      pathPrefix: facts[0].pathPrefix,
      package: facts[0].package,
      ...confidence,
      weight: weightFromFacts(facts, nowMs, confidence.tier, cfg),
      weightAsOf: generatedAt,
      lastEventAt: last.event.at,
      lastEventType: last.event.type,
      distinctAnnotators: annotators.size,
      consolidated: consolidate(facts, cfg),
      citedEvents: orderedCitations,
    };
  }
  return doc;
}

function assertValid(doc, schemaPath = learningSchemaPath()) {
  const { errors } = validateAgainstSchema(doc, { path: schemaPath });
  if (errors.length) throw new Error(`learning view is invalid:\n  - ${errors.join('\n  - ')}`);
}

export function loadLearning({ path = learningPath(), schemaPath = learningSchemaPath() } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`learning view at ${path} is unreadable (${error.code || error.message})`);
  }
  let doc;
  try { doc = JSON.parse(raw); }
  catch (error) { throw new Error(`learning view at ${path} is not valid JSON (${error.message})`); }
  assertValid(doc, schemaPath);
  return doc;
}

export function saveLearning(doc, { path = learningPath(), schemaPath = learningSchemaPath() } = {}) {
  assertValid(doc, schemaPath);
  const lock = acquireLock(`${path}.lock`, { staleMs: 30_000, label: 'learning-view', attempts: 50, spinMs: 20 });
  if (!lock.ok) throw new Error(`learning view is locked by another process (${path}.lock); try again`);
  try { writeJSONAtomic(path, doc); } finally { lock.release(); }
}
