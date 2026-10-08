#!/usr/bin/env node
/**
 * commitwork generic IDOR runner. Sibling to bin/bola-run.mjs, reusing its actor-minting,
 * object-resolution, HTTP and trust-gate machinery rather than forking it — same evidence
 * contract ({ran:false,skipped:true,reason} void shape), same manifest file, a new declaration
 * inside it (`idorProbe`).
 *
 * WHY A SIBLING FILE, NOT A NEW MODE INSIDE bola-run.mjs: BOLA holds identity fixed and varies
 * WHO is asking; IDOR holds identity fixed and varies WHICH OBJECT is asked for. They share
 * minting/resolution but the comparator is different — BOLA's classify() needs a second actor's
 * reference body to discriminate a real cross-read from a filtered response; a single-actor
 * id-walk has no such reference and must not borrow that logic (see the severity note below).
 *
 * A second strategy — substituting a peer actor's real object id into THIS actor's request — was
 * considered and dropped: bin/bola-run.mjs's own Pass 2 already probes every owned object against
 * every actor at its fixed path, so that is not new coverage, it is a redescription of coverage
 * that already ships (evaluations/SPEC-idor-mass-assignment-2026-09-01.md, /overloop finding).
 *
 * usage: node bin/idor-run.mjs --manifest <path|name> [--base URL] [--trust-repo-manifest]
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolveManifestPath, assertTrusted, loadManifest, resolveActors, req, disclosesObject, voidResult } from './bola-run.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Same conservatism as bola-run.mjs's CAP_ACTORS=16/CAP_OBJECTS=200/CAP_DISCOVER=40: this probe
// fires real requests against CW_TARGET_URL, not a mock, so an unbounded id-walk is a resource/
// abuse risk a manifest must not be able to request past. A manifest asking for more VOIDS rather
// than silently truncating — silent truncation would make "how far did this actually probe" a
// question nobody could answer from the result alone.
export const CAP_IDOR_RANGE = 25;

/** True when `s` is a base-10 integer string with no sign/decimal ambiguity — the id must parse
 *  exactly the way it will be re-serialised into the URL, or `id ± range` is comparing apples to
 *  a string that merely looked numeric. */
export function isPlainInteger(s) {
  return /^\d+$/.test(String(s ?? ''));
}

/** Extract the numeric id bola-run.mjs's resolveObjects() substituted into an item's path, given
 *  the same pathTemplate (`.../{id}`) the manifest declares for the probe. Returns null rather
 *  than guessing when the template's prefix/suffix don't bound the path the way they should —
 *  a shape this cannot verify must never be treated as a numeric id. */
export function idFromPath(pathTemplate, itemPath) {
  const at = pathTemplate.indexOf('{id}');
  if (at < 0) return null;
  const prefix = pathTemplate.slice(0, at), suffix = pathTemplate.slice(at + 4);
  if (!itemPath.startsWith(prefix) || !itemPath.endsWith(suffix)) return null;
  const mid = itemPath.slice(prefix.length, itemPath.length - suffix.length || undefined);
  return isPlainInteger(mid) ? mid : null;
}

/** Pure, so the walk-and-classify logic is unit-testable without a network call.
 *  `probe(id)` is injected — it performs one request for a candidate id and returns disclosesObject()'s
 *  verdict plus the raw response shape needed for the finding. */
export async function runIdorRange({ ownedId, range, probeFn, path: pathTemplate, actorName }) {
  const from = Number(range.from), to = Number(range.to);
  const span = to - from;
  if (!Number.isFinite(from) || !Number.isFinite(to) || span < 0) {
    return { void: `idorProbe.range is not a valid {from,to} pair (got ${JSON.stringify(range)})` };
  }
  if (span > CAP_IDOR_RANGE) {
    return { void: `idorProbe.range spans ${span} ids, more than CAP_IDOR_RANGE=${CAP_IDOR_RANGE} — refusing rather than silently truncating an unbounded id-walk against a live target` };
  }
  const base = Number(ownedId);
  const findings = [], tested = [];
  for (let d = from; d <= to; d++) {
    if (d === 0) continue; // the actor's own id is the baseline, not a probe
    const candidate = String(base + d);
    if (candidate.startsWith('-')) continue; // a negative id is not a valid id to request
    const path = pathTemplate.replace('{id}', candidate);
    const res = await probeFn(path);
    tested.push({ path, candidate, status: res.status, len: res.len });
    if (disclosesObject(res)) {
      // `high`, not `critical`: unlike BOLA's cross-actor read, there is no second actor's
      // reference body here to discriminate "this is really someone else's object" from "this
      // endpoint returns generic content for any id" — the SPEC's own stated limitation, kept
      // rather than silently upgraded once code made it easy to.
      findings.push({
        type: 'idor', severity: 'high', path, triedId: candidate,
        detail: `${actorName} requested id ${candidate} (not its own, offset ${d >= 0 ? '+' : ''}${d}) at ${path} and received a non-empty response (HTTP ${res.status}) — an authorization check may exist on the endpoint but not on this specific object id`,
      });
    }
  }
  return { findings, tested };
}

export async function run(manifest, opts = {}) {
  const say = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const base = String(opts.base || process.env.CW_TARGET_URL || manifest.base || '').replace(/\/+$/, '');
  if (!base) return voidResult('no target: set manifest.base, pass --base, or export CW_TARGET_URL.', base);

  const p = manifest.idorProbe;
  if (!p) return voidResult('manifest declares no idorProbe block — nothing to probe.', base);
  if (!p.actor || !p.pathTemplate || !p.pathTemplate.includes('{id}') || !p.range) {
    return voidResult('idorProbe requires actor, pathTemplate (containing {id}), and range {from,to}.', base);
  }

  const actors = await resolveActors(manifest.actors || []);
  const actor = actors.find((a) => a.name === p.actor);
  if (!actor) return voidResult(`idorProbe.actor "${p.actor}" is not a declared actor.`, base, { actors });
  if (actor.void) return voidResult(`idorProbe.actor "${p.actor}" could not be minted: ${actor.void}`, base, { actors });

  // Reuse bola-run.mjs's own object model to find an id this actor legitimately owns — no second
  // discovery mechanism, no idPath of our own; the SAME seed/declared resolution BOLA already
  // trusts, so this probe inherits its correctness rather than re-deriving it.
  const { resolveObjects } = await import('./bola-run.mjs');
  const byName = new Map(actors.map((a) => [a.name, a]));
  const { items, voids: objVoids } = await resolveObjects(base, manifest.objects, byName);
  const owned = items.find((i) => i.owner === p.actor && (!p.objectType || i.type === p.objectType));
  if (!owned) return voidResult(`no object owned by "${p.actor}"${p.objectType ? ` of type "${p.objectType}"` : ''} — idorProbe needs one owned id to walk from.`, base, { actors, voids: objVoids });

  const ownedId = idFromPath(p.pathTemplate, owned.path);
  if (ownedId === null) {
    return voidResult(`owned id at ${owned.path} is not a base-10 integer under pathTemplate "${p.pathTemplate}" — adjacent-id does not apply to non-numeric ids (UUID-keyed resources, for example). This is a real limitation stated, not a bug: use a manifest whose ids are sequential integers, or wait for a future strategy.`, base, { actors, voids: objVoids });
  }

  say(`walking id ${ownedId} ${p.range.from >= 0 ? '+' : ''}${p.range.from}..${p.range.to >= 0 ? '+' : ''}${p.range.to} as ${p.actor}`);
  const probeFn = (path) => req(base + path, { headers: actor.headers || {} });
  const outcome = await runIdorRange({ ownedId, range: p.range, probeFn, path: p.pathTemplate, actorName: p.actor });
  if (outcome.void) return voidResult(outcome.void, base, { actors, voids: objVoids });

  const { findings, tested } = outcome;
  const summary = {
    base, ran: true, actor: p.actor, ownedId, probed: tested.length, findings: findings.length,
    verdict: findings.length
      ? `POTENTIAL IDOR — ${findings.length} finding(s) across ${tested.length} probe(s); review.`
      : `no disclosure across ${tested.length} adjacent-id probe(s) around id ${ownedId}${objVoids.length ? ` — ${objVoids.length} coverage void(s)` : ''}.`,
  };
  return { tool: 'authz-idor', summary, findings, tested, actors, voids: objVoids };
}

// ── CLI, mirroring bola-run.mjs's shape ────────────────────────────────────────────────────────
async function main(argv) {
  const opts = { manifest: null, base: null, trustRepoManifest: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest' || a === '-m') opts.manifest = argv[++i];
    else if (a === '--base' || a === '--url') opts.base = argv[++i];
    else if (a === '--out' || a === '-o') opts.out = argv[++i];
    else if (a === '--trust-repo-manifest') opts.trustRepoManifest = true;
    else if (!opts.manifest && !a.startsWith('-')) opts.manifest = a;
    else { console.error(`idor-run: unknown argument "${a}"`); process.exit(2); }
  }
  let manifest;
  try {
    const { path, source } = resolveManifestPath(opts.manifest);
    assertTrusted(source, path, opts);
    manifest = loadManifest(path);
  } catch (e) { console.error(`idor-run: ${e.message}`); process.exit(2); }
  opts.onProgress = (line) => process.stderr.write(`[idor] ${line}\n`);
  const result = await run(manifest, opts);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (opts.out) {
    const tmp = `${opts.out}.tmp-${process.pid}`;
    try { writeFileSync(tmp, json); renameSync(tmp, opts.out); process.stderr.write(`[idor] wrote ${opts.out}\n`); }
    catch (e) { console.error(`idor-run: could not write --out ${opts.out}: ${e.message}`); process.exit(2); }
  }
  process.stdout.write(json);
}
if (isMainModule(import.meta.url)) main(process.argv.slice(2));
