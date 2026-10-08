// admin/routes/config-edit.mjs — the config page's WRITE half.
//
// /config read config from disk and wrote nothing, anywhere, and its apply controls were absent on
// the published port on the reasoning at config.html:100 — a control reachable through the tunnel
// is a control reachable from the internet. That boundary was raised explicitly and the operator
// chose to cross it: editing is session-gated and available on BOTH ports. This file therefore has
// to carry the weight that the port boundary used to, and the comments below say which guard is
// standing in for what, because "the operator decided" is a reason to build it, not a reason to
// build it loosely.
//
// WHAT AN EDITOR HERE CAN DO, stated plainly rather than discovered later: the projects registry
// decides what is scanned at all; gate-exemptions.json and annotations.json decide which findings
// are suppressed or re-graded; stub-allowlist.json decides which stubs pass. Every one of them can
// make the fleet look cleaner than it is. That is exactly why each write is validated, versioned
// against the bytes the editor was shown, and atomic.
//
// NEVER A PATH FROM THE REQUEST. The client sends a KEY from a closed set; the path is resolved
// here. A request cannot name a file, so no amount of traversal cleverness in the body reaches one.

import { requireSession } from '../lib/route-auth.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../../monitor/lockfile.mjs';
import { registryPathFor, annotationsPathFor, gateExemptionsPathFor, stubAllowlistPathFor } from '../../monitor/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Read at CALL time, never at module load: a const here would defeat the override for any test
// that sets it afterwards, and the test would pass while proving nothing.
const root = () => resolve(process.env.CW_CONFIG_ROOT || REPO);

/**
 * The closed set. A key that is not here is not editable, and that is the whole allowlist.
 *
 * `resolvePath` exists because a literal is not always the right answer. The registry moved to
 * monitor/private/ — a symlink to the sidecar — while this table went on naming
 * monitor/projects.json, so the editor read and wrote a file `monitor/registry.mjs` does not
 * resolve. Nothing failed: the panel reported a successful save, the bytes landed, and the fleet
 * kept scanning the registry it had always read. An editor writing to a path no reader consults is
 * worse than a broken editor, because a broken one announces itself. Anything whose location is
 * decided by a resolver must be reached THROUGH that resolver, not through a copy of its answer.
 */
export const EDITABLE = Object.freeze({
  projects:       { file: 'monitor/projects.json',        label: 'projects registry', resolvePath: registryPathFor },
  annotations:    { file: 'monitor/private/annotations.json',     label: 'scanner annotations', resolvePath: annotationsPathFor },
  gateExemptions: { file: 'monitor/private/gate-exemptions.json', label: 'gate exemptions', resolvePath: gateExemptionsPathFor },
  stubAllowlist:  { file: 'monitor/private/stub-allowlist.json',  label: 'stub allowlist', resolvePath: stubAllowlistPathFor },
});

export const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

const pathFor = (name) => {
  if (!Object.prototype.hasOwnProperty.call(EDITABLE, name)) return null;
  const e = EDITABLE[name];
  return e.resolvePath ? e.resolvePath(root()) : join(root(), e.file);
};

// What a response CALLS the file, derived from the resolved path rather than the declared literal.
// The two disagree for the registry, and a label naming the wrong file is precisely how an operator
// concludes they edited something they did not.
const displayFor = (name) => {
  const p = pathFor(name);
  if (!p) return null;
  const rel = relative(root(), p);
  return (!rel || rel.startsWith('..')) ? p : rel;
};

/**
 * Fail closed. ENOENT is the ONLY absence that reads as "legitimately not there"; a permission
 * error or an unreadable file must never come back as empty, because an empty editor that saves
 * would replace a file the operator could not read with whatever they typed over the top of it.
 */
function readOrThrow(p) {
  if (!existsSync(p)) return { text: null, missing: true };
  return { text: readFileSync(p, 'utf8'), missing: false };
}

export const routes = [
  // GET /api/config/file?name=<key> — the bytes, and the version they are.
  { method: 'GET', path: '/api/config/file', handle: (ctx) => {
    const { send } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    const name = String(ctx.query.get('name') || '');
    const p = pathFor(name);
    if (!p) return send(400, { ok: false, error: `not an editable config file: '${name}'` });
    let r;
    try { r = readOrThrow(p); }
    catch (e) { return send(500, { ok: false, error: `could not read ${displayFor(name)}: ${e.message}` }); }
    return send(200, {
      ok: true, name, file: displayFor(name), label: EDITABLE[name].label,
      missing: r.missing, text: r.text, hash: r.text === null ? null : hashOf(r.text),
    });
  } },

  // POST /api/config/file {name, text, baseHash} — write it, or refuse and say why.
  { method: 'POST', path: '/api/config/file', handle: (ctx) => {
    const { req, send, readJsonBody } = ctx;
    if (!requireSession(ctx)) return send(401, { ok: false, error: 'authentication required' });
    return readJsonBody(req, (body, err) => {
      if (err) return send(400, { ok: false, error: err });
      const name = String((body && body.name) || '');
      const p = pathFor(name);
      if (!p) return send(400, { ok: false, error: `not an editable config file: '${name}'` });
      const text = (body && typeof body.text === 'string') ? body.text : null;
      if (text === null) return send(400, { ok: false, error: 'text must be a string' });

      // PARSE BEFORE WRITE. These files are read by the sweep and the rollup; saving something that
      // does not parse takes the fleet's scanning down and the editor is the last place that can
      // still say so with a line number.
      try { JSON.parse(text); }
      catch (e) { return send(400, { ok: false, error: `not valid JSON, nothing was written: ${e.message}` }); }

      // CONFLICT RATHER THAN CLOBBER. baseHash is the version the editor was shown. If the file
      // moved underneath — another session, a script, a git checkout — the write is refused and the
      // current bytes come back, because silently overwriting somebody's change is the one outcome
      // an editor must never produce. A caller may not opt out by omitting it.
      let cur;
      try { cur = readOrThrow(p); }
      catch (e) { return send(500, { ok: false, error: `could not read the current file: ${e.message}` }); }
      const curHash = cur.text === null ? null : hashOf(cur.text);
      const baseHash = (body && typeof body.baseHash === 'string') ? body.baseHash : null;
      if (baseHash === null) return send(400, { ok: false, error: 'baseHash is required — a write with no base version cannot detect a conflict' });
      if (baseHash !== (curHash || '')) {
        return send(409, {
          ok: false, error: 'the file changed since it was opened — nothing was written',
          currentHash: curHash, currentText: cur.text,
        });
      }

      try { writeAtomic(p, text); }
      catch (e) { return send(500, { ok: false, error: `write failed, the file is unchanged: ${e.message}` }); }
      return send(200, { ok: true, name, file: displayFor(name), hash: hashOf(text), bytes: Buffer.byteLength(text, 'utf8') });
    });
  } },
];
