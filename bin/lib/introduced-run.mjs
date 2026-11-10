// bin/lib/introduced-run.mjs — `commitwork deps --introduced`: read the lockfile before and after an
// update (two files, or two git refs of one repository), resolve both graphs, look up the pairs that
// decide the answer, and issue the verdict (bin/lib/introduced-verdict.mjs).
//
// A lockfile absent before the update is an empty graph: every advisory after it is introduced. A
// lockfile absent after it, or one that cannot be read, is a graph that could not be resolved.

import { readFileSync } from 'node:fs';
import { scannedGit } from './git-env.mjs';
import { GRAPH_READERS, LOCKFILE } from './npm-graph.mjs';
import { computeVerdict, lookupSet, DEFAULT_BLOCKING } from './introduced-verdict.mjs';
import { osvLookup } from './osv-advisories.mjs';

const empty = (ecosystem) => ({ ecosystem, source: 'absent', packages: new Map(), unresolved: [] });

/** { text } | { absent } | { error } for a file path. Only ENOENT is absence. */
export function fromFile(path) {
  try { return { text: readFileSync(path, 'utf8') }; } catch (e) {
    return e.code === 'ENOENT' ? { absent: true } : { error: `${path} could not be read (${e.code || e.message})` };
  }
}

/** { text } | { absent } | { error } for `<ref>:<path>` in a repository. */
export function fromRef(repo, ref, path) {
  const r = scannedGit(repo, ['show', `${ref}:${path}`]);
  if (r.status === 0) return { text: r.stdout };
  const msg = (r.stderr || r.error?.message || '').trim().split('\n')[0];
  if (/does not exist|exists on disk, but not in/i.test(msg)) return { absent: true };
  return { error: `${ref}:${path} could not be read (${msg || `git exited ${r.status}`})` };
}

function graphOf(input, side, lockfile) {
  const reader = Object.hasOwn(GRAPH_READERS, lockfile) ? GRAPH_READERS[lockfile] : null;
  if (!reader) return { ecosystem: null, error: `${lockfile} has no graph reader` };
  const eco = reader.ecosystem;
  if (input.error) return { ecosystem: eco, error: input.error };
  if (input.absent) return side === 'before' ? empty(eco) : { ecosystem: eco, error: `no ${lockfile} after the update: the install would resolve the tree itself` };
  return reader.read(input.text, { label: `${lockfile} (${side})` });
}

async function ask(lookup, pairs) {
  const wanted = pairs.filter((p) => p.registry);
  if (!wanted.length) return new Map();
  try { return await lookup(wanted); } catch (e) {
    return new Map(wanted.map((p) => [`${p.name}@${p.version}`, { error: `the advisory lookup failed: ${e.message}` }]));
  }
}

/**
 * The verdict for one update. `before`/`after` are fromFile/fromRef results; `lookupBefore` and
 * `lookupAfter` default to one OSV lookup for both sides.
 */
export async function introducedVerdict({ before, after, lockfile = LOCKFILE, lookupBefore = null, lookupAfter = null, includeDev = true,
  blocking = DEFAULT_BLOCKING, subject = null, source = 'osv', nowMs = Date.now() }) {
  const gb = graphOf(before, 'before', lockfile);
  const ga = graphOf(after, 'after', lockfile);
  const osv = lookupBefore && lookupAfter ? null : osvLookup({ ecosystem: ga.ecosystem || gb.ecosystem || 'npm' });
  const set = lookupSet(gb, ga, { includeDev });
  const findingsBefore = await ask(lookupBefore || osv, set.before);
  const findingsAfter = await ask(lookupAfter || osv, set.after);
  return computeVerdict({ before: gb, after: ga, findingsBefore, findingsAfter, includeDev, blocking, subject,
    source: { graph: lockfile, advisories: source }, generatedAt: new Date(nowMs).toISOString() });
}

/** The two inputs a CLI run names: files, or `<base>..<head>` in the repository holding `dir`. */
export function inputsOf({ range, beforeFile, afterFile, top, pkgPath }) {
  const path = pkgPath && pkgPath !== '.' ? `${pkgPath}/${LOCKFILE}` : LOCKFILE;
  if (beforeFile || afterFile) {
    return { before: fromFile(beforeFile), after: fromFile(afterFile), subject: { repo: null, path: null, before: { file: beforeFile }, after: { file: afterFile } } };
  }
  const [base, head] = range.split('..');
  return { before: fromRef(top, base, path), after: fromRef(top, head || 'HEAD', path),
    subject: { repo: top, path: pkgPath || '.', before: { ref: base }, after: { ref: head || 'HEAD' } } };
}

const SEV_W = 8;
export function renderIntroduced(v) {
  const scope = v.scope.includeDev ? 'devDependencies included' : 'devDependencies excluded';
  const lines = [`introduced advisories · ${v.ecosystem || 'unknown ecosystem'} · ${scope} · blocking: ${v.scope.blocking.join(', ')}`];
  const head = { clear: 'clear — no advisory introduced at a blocking severity', introduces: `introduces ${v.counts.blocking} advisor${v.counts.blocking === 1 ? 'y' : 'ies'} at a blocking severity`,
    unmeasured: 'not measured — this is not a pass' }[v.state];
  lines.push(`  verdict: ${head}`);
  for (const r of v.reasons) lines.push(`  ${r}`);
  for (const i of v.introduced) {
    lines.push(`    ${i.severity.padEnd(SEV_W)} ${i.advisory}  ${i.package}@${i.versions.join(', ')} (${i.exposure})${i.blocking ? '' : '  [not blocking]'}`);
    if (i.paths[0]) lines.push(`             via ${i.paths[0].join(' › ')}`);
  }
  for (const u of v.unmeasured.slice(0, 20)) lines.push(`    not measured: ${u.package ? `${u.package}@${u.version}` : u.location} (${u.side}) — ${u.reason}`);
  if (v.unmeasured.length > 20) lines.push(`    and ${v.unmeasured.length - 20} more not measured`);
  lines.push(`  introduced ${v.counts.introduced} · resolved ${v.counts.resolved} · persisting ${v.counts.persisting} · looked up ${v.counts.looked}`);
  return `${lines.join('\n')}\n`;
}
