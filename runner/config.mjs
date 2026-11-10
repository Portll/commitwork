// Dispatcher config: the declared repositories, the runner's label set, slot sizes and timings.
// The real file names the operator's repositories, so it lives in the private dir; the tree ships
// runner/runner.example.json.
//   env, read at call time: CW_RUNNER_CONFIG (else <private dir>/runner.json)
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDir } from '../monitor/store-paths.mjs';

export class RunnerConfigError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'RunnerConfigError';
    this.code = code;
  }
}

const OWN_TREE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOP_KEYS = ['repos', 'labels', 'actors', 'slots', 'pollSec', 'staleRunnerSec'];
const REPO_KEYS = ['repo', 'labels', 'actors'];
const SLOT_KEYS = ['id', 'cpus', 'memGb'];
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
// Slot ids go into runner names, which GitHub caps at 64 characters.
const SLOT_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;
const LABEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// actions/runner ships linux-arm64 and linux-x64 only.
const ARCH_LABELS = Object.freeze({ arm64: 'arm64', x64: 'x64' });
export const REQUIRED_LABELS = Object.freeze(['self-hosted', 'commitwork']);
export const DEFAULTS = Object.freeze({ pollSec: 30, staleRunnerSec: 600 });

const fail = (code, message) => { throw new RunnerConfigError(code, message); };

/** The config path: CW_RUNNER_CONFIG, else runner.json in the private dir. */
export const runnerConfigPath = (root = OWN_TREE) =>
  (process.env.CW_RUNNER_CONFIG ? resolve(process.env.CW_RUNNER_CONFIG) : join(privateDir(root), 'runner.json'));

/** The default label set for an architecture. */
export function defaultLabels(arch = process.arch) {
  if (!Object.hasOwn(ARCH_LABELS, arch)) fail('config-arch', `no runner build for architecture ${arch}`);
  return ['self-hosted', 'linux', ARCH_LABELS[arch], 'commitwork'];
}

function knownKeys(obj, allowed, where) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) fail('config-shape', `${where} must be an object`);
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) fail('config-unknown-key', `${where}.${k} is not a runner config key`);
}

function labelSet(v, where) {
  if (!Array.isArray(v) || !v.length || !v.every((s) => typeof s === 'string' && LABEL_RE.test(s))) {
    fail('config-labels', `${where} must be a non-empty list of label names`);
  }
  const set = [...new Set(v.map((s) => s.toLowerCase()))];
  for (const need of REQUIRED_LABELS) if (!set.includes(need)) fail('config-labels', `${where} must include ${need}`);
  return Object.freeze(set);
}

function actorSet(v, where) {
  if (!Array.isArray(v) || !v.length || !v.every((s) => typeof s === 'string' && LOGIN_RE.test(s))) {
    fail('config-actors', `${where} must be a non-empty list of GitHub logins`);
  }
  return Object.freeze([...new Set(v.map((s) => s.toLowerCase()))]);
}

function wholeNumber(v, where, min, fallback) {
  if (v === undefined) return fallback;
  if (!Number.isInteger(v) || v < min) fail('config-number', `${where} must be an integer of at least ${min}`);
  return v;
}

function positive(v, where) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) fail('config-number', `${where} must be a positive number`);
  return v;
}

function unique(values, what) {
  const seen = new Set();
  for (const v of values) {
    const k = v.toLowerCase();
    if (seen.has(k)) fail('config-duplicate', `${what} ${v} is declared twice`);
    seen.add(k);
  }
}

// Write collaborators push branches into the repo itself, so a same-repo head is not proof the code
// is the owner's; without a declared list only the repository's owner may trigger a job.
function repoEntry(r, i, labels, actors) {
  const where = `config.repos[${i}]`;
  knownKeys(r, REPO_KEYS, where);
  if (typeof r.repo !== 'string' || !REPO_RE.test(r.repo)) fail('config-repos', `${where}.repo must be owner/name`);
  return Object.freeze({
    repo: r.repo,
    labels: r.labels === undefined ? labels : labelSet(r.labels, `${where}.labels`),
    actors: r.actors !== undefined ? actorSet(r.actors, `${where}.actors`) : actors || Object.freeze([r.repo.split('/')[0].toLowerCase()]),
  });
}

function slotEntry(s, i) {
  const where = `config.slots[${i}]`;
  knownKeys(s, SLOT_KEYS, where);
  if (typeof s.id !== 'string' || !SLOT_RE.test(s.id)) fail('config-slots', `${where}.id must match ${SLOT_RE}`);
  return Object.freeze({ id: s.id, cpus: positive(s.cpus, `${where}.cpus`), memGb: positive(s.memGb, `${where}.memGb`) });
}

/** Validate a parsed config. Throws RunnerConfigError naming the first fault. */
export function validateConfig(raw, { arch = process.arch } = {}) {
  knownKeys(raw, TOP_KEYS, 'config');
  const labels = raw.labels === undefined ? Object.freeze(defaultLabels(arch)) : labelSet(raw.labels, 'config.labels');
  if (!Array.isArray(raw.repos) || !raw.repos.length) fail('config-repos', 'config.repos must declare at least one repository');
  const actors = raw.actors === undefined ? null : actorSet(raw.actors, 'config.actors');
  const repos = raw.repos.map((r, i) => repoEntry(r, i, labels, actors));
  unique(repos.map((r) => r.repo), 'repository');
  if (!Array.isArray(raw.slots) || !raw.slots.length) fail('config-slots', 'config.slots must declare at least one slot');
  const slots = raw.slots.map(slotEntry);
  unique(slots.map((s) => s.id), 'slot');
  return Object.freeze({
    repos: Object.freeze(repos),
    labels,
    slots: Object.freeze(slots),
    pollSec: wholeNumber(raw.pollSec, 'config.pollSec', 10, DEFAULTS.pollSec),
    staleRunnerSec: wholeNumber(raw.staleRunnerSec, 'config.staleRunnerSec', 60, DEFAULTS.staleRunnerSec),
  });
}

/** Read and validate the config. Absent is an error: the dispatcher has nothing to serve without it. */
export function loadConfig({ path = runnerConfigPath(), arch = process.arch } = {}) {
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    fail(e.code === 'ENOENT' ? 'config-absent' : 'config-unreadable', `${path}: ${e.code || e.message}`);
  }
  let raw;
  try { raw = JSON.parse(text); } catch (e) { fail('config-unparseable', `${path}: ${e.message}`); }
  return validateConfig(raw, { arch });
}

/** The label set a repository's runners carry and its jobs must stay inside. */
export const labelsFor = (config, repo) =>
  (config.repos.find((r) => r.repo.toLowerCase() === String(repo).toLowerCase()) || {}).labels;

/** The GitHub logins whose runs a repository's runners take. */
export const actorsFor = (config, repo) =>
  (config.repos.find((r) => r.repo.toLowerCase() === String(repo).toLowerCase()) || {}).actors;
