#!/usr/bin/env node
/**
 * commitwork mass-assignment runner. Sibling to bin/bola-run.mjs and bin/idor-run.mjs, reusing
 * their actor-minting/HTTP/trust-gate machinery. A genuinely different mechanism from both,
 * stated plainly rather than dressed as a variant: BOLA and IDOR are READ-side probes (does a GET
 * leak an object); this is a WRITE-side probe (does a POST/PATCH accept and PERSIST a field the
 * client should not control). There is no disclosure comparator here — the comparator is a
 * field-value check after a create+reread round-trip.
 *
 * THE SINGLE HIGHEST-PRIORITY DESIGN CONSTRAINT, found by /overloop on
 * evaluations/SPEC-idor-mass-assignment-2026-09-01.md: a TRUE POSITIVE here means a real,
 * privilege-escalated object now exists in whatever system CW_TARGET_URL points to — the probe
 * that proves the vulnerability is also the thing that would leave it in place. Every code path
 * through runProbe() below — success, escalation confirmed, escalation rejected, or a partial
 * failure between create and reread — ends in an UNCONDITIONAL teardown call, never duplicated
 * per branch (a purge wired into each branch separately risks a future edit silently skipping one
 * of them; this sits below all of them in a `finally`-shaped structure instead).
 *
 * usage: node bin/mass-assign-run.mjs --manifest <path|name> [--base URL] [--trust-repo-manifest]
 */
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolveManifestPath, assertTrusted, loadManifest, resolveActors, req, voidResult, pluck } from './bola-run.mjs';
import { isMainModule } from '../lib/is-main.mjs';

/** Read a value out of a parsed JSON response body by dotted path, tolerant of a non-object body
 *  (a probe against a broken create/reread step must not throw — it must report "not persisted"
 *  honestly, which is what `undefined` already means to the caller). */
function pluckSafe(text, path) {
  let j; try { j = JSON.parse(text); } catch { return undefined; }
  return path ? pluck(j, path) : j;
}

/**
 * One field, fully round-tripped: create with the injected field, reread, teardown — UNCONDITIONALLY,
 * regardless of what the classification turns out to be. Pure enough to unit-test: `reqFn` is
 * injected so no network call is needed to prove the teardown-always-fires property, which is the
 * property this module exists to guarantee.
 *
 * @returns {{finding: object|null, teardownFailed: string|null, error: string|null}}
 */
export async function runOneField({ actor, createPath, readPath, teardownPath, idPath, field, reqFn }) {
  const body = JSON.stringify({ [field.name]: field.value, _probe: true });
  const headers = { ...(actor.headers || {}), 'Content-Type': 'application/json' };
  let createdId = null;
  let result = { finding: null, teardownFailed: null, error: null };
  try {
    const createRes = await reqFn(createPath, { method: 'POST', headers, body });
    if (createRes.status < 200 || createRes.status >= 300) {
      result.error = `create POST ${createPath} returned HTTP ${createRes.status} — cannot probe "${field.name}" without a created object`;
      return result; // nothing was created; there is nothing to tear down
    }
    createdId = idPath ? pluckSafe(createRes.text, idPath) : null;
    const readAt = createdId != null ? readPath.replace('{id}', encodeURIComponent(createdId)) : readPath;
    const rereadRes = await reqFn(readAt, { method: 'GET', headers: actor.headers || {} });
    const rereadBody = pluckSafe(rereadRes.text, null);
    const persisted = rereadBody && typeof rereadBody === 'object' && rereadBody[field.name] === field.value;

    if (field.expectRejected && persisted) {
      result.finding = {
        type: 'mass-assignment', severity: 'critical',
        detail: `${actor.name} set "${field.name}" to ${JSON.stringify(field.value)} on create and it was PERSISTED (re-read confirms, id=${createdId ?? 'unknown'}) — the server accepted a clientControlled field it should own itself`,
        field: field.name, createdId,
      };
    } else if (!field.expectRejected && !persisted) {
      // POSITIVE CONTROL, not a vulnerability: proves the create/reread mechanism itself actually
      // works, by declaring at least one field that SHOULD be settable and confirming it is — the
      // fleet's own "a guard that has only ever been seen to pass has no floor" discipline,
      // applied to this probe's own plumbing rather than to the target.
      result.finding = {
        type: 'mass-assignment-probe-broken', severity: 'medium',
        detail: `${actor.name} set "${field.name}" (declared expectRejected:false, i.e. legitimately settable) and it was NOT persisted — either this probe's own create/reread mechanism is broken, or the field silently no-ops; worth checking either way`,
        field: field.name, createdId,
      };
    }
  } catch (e) {
    result.error = String(e && e.message || e);
  } finally {
    if (createdId != null && teardownPath) {
      try {
        const at = teardownPath.replace('{id}', encodeURIComponent(createdId));
        const del = await reqFn(at, { method: 'DELETE', headers: actor.headers || {} });
        if (del.status < 200 || del.status >= 300) {
          result.teardownFailed = `DELETE ${at} returned HTTP ${del.status} — the probe object (id=${createdId}) may still exist in the target`;
        }
      } catch (e) {
        result.teardownFailed = `DELETE for id=${createdId} threw: ${String(e && e.message || e)} — the probe object may still exist in the target`;
      }
    }
  }
  return result;
}

export async function run(manifest, opts = {}) {
  const say = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  const base = String(opts.base || process.env.CW_TARGET_URL || manifest.base || '').replace(/\/+$/, '');
  if (!base) return voidResult('no target: set manifest.base, pass --base, or export CW_TARGET_URL.', base);

  const p = manifest.massAssignProbe;
  if (!p) return voidResult('manifest declares no massAssignProbe block — nothing to probe.', base);
  if (!p.actor || !p.createPath || !p.readPath || !Array.isArray(p.fields) || !p.fields.length) {
    return voidResult('massAssignProbe requires actor, createPath, readPath, and a non-empty fields[].', base);
  }
  if (!p.teardownPath) {
    // Refused outright, not merely warned: this is the ONE thing this module exists to guarantee,
    // and a manifest that omits it is asking to write escalated objects into a live target with no
    // way to remove them.
    return voidResult('massAssignProbe.teardownPath is required — this probe writes to the target and refuses to run without a declared way to remove what it creates.', base);
  }

  const actors = await resolveActors(manifest.actors || []);
  const actor = actors.find((a) => a.name === p.actor);
  if (!actor) return voidResult(`massAssignProbe.actor "${p.actor}" is not a declared actor.`, base, { actors });
  if (actor.void) return voidResult(`massAssignProbe.actor "${p.actor}" could not be minted: ${actor.void}`, base, { actors });

  say(`probing ${p.fields.length} field(s) as ${p.actor}, each with an unconditional teardown`);
  const reqFn = (path, o) => req(base + path, o);
  const findings = [], tested = [], voids = [];
  for (const field of p.fields) {
    if (!field || !field.name || field.value === undefined) { voids.push(`field ${JSON.stringify(field)} is missing name or value — skipped`); continue; }
    const r = await runOneField({ actor, createPath: p.createPath, readPath: p.readPath, teardownPath: p.teardownPath, idPath: p.idPath, field, reqFn });
    tested.push({ field: field.name, expectRejected: field.expectRejected !== false, error: r.error, teardownFailed: r.teardownFailed });
    if (r.error) voids.push(`field "${field.name}": ${r.error}`);
    if (r.finding) findings.push(r.finding);
    if (r.teardownFailed) {
      // A failed cleanup is ITS OWN finding, not a silent leftover — see the module header.
      findings.push({ type: 'mass-assignment-cleanup-failed', severity: 'high', field: field.name, detail: r.teardownFailed });
    }
  }

  const critical = findings.filter((f) => f.severity === 'critical').length;
  const summary = {
    base, ran: true, actor: p.actor, fieldsProbed: tested.length, findings: findings.length, critical,
    verdict: critical
      ? `POTENTIAL MASS ASSIGNMENT — ${critical} field(s) confirmed persisted; review immediately.`
      : findings.length
        ? `no confirmed escalation, but ${findings.length} finding(s) need review (probe-broken or cleanup-failed).`
        : `no mass-assignment across ${tested.length} field(s)${voids.length ? ` — ${voids.length} void(s)` : ''}.`,
  };
  return { tool: 'authz-mass-assignment', summary, findings, tested, actors, voids };
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
    else { console.error(`mass-assign-run: unknown argument "${a}"`); process.exit(2); }
  }
  let manifest;
  try {
    const { path, source } = resolveManifestPath(opts.manifest);
    assertTrusted(source, path, opts);
    manifest = loadManifest(path);
  } catch (e) { console.error(`mass-assign-run: ${e.message}`); process.exit(2); }
  opts.onProgress = (line) => process.stderr.write(`[mass-assign] ${line}\n`);
  const result = await run(manifest, opts);
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (opts.out) {
    const tmp = `${opts.out}.tmp-${process.pid}`;
    try { writeFileSync(tmp, json); renameSync(tmp, opts.out); process.stderr.write(`[mass-assign] wrote ${opts.out}\n`); }
    catch (e) { console.error(`mass-assign-run: could not write --out ${opts.out}: ${e.message}`); process.exit(2); }
  }
  process.stdout.write(json);
}
if (isMainModule(import.meta.url)) main(process.argv.slice(2));
