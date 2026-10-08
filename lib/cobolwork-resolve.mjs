// lib/cobolwork-resolve.mjs — the one place commitwork finds cobolwork: CW_COBOLWORK_BIN when an
// operator or a test names one, else the verified install of the release manifests/tool-pins.json
// pins, else unavailable with a reason naming the pin and the install command. PATH is never read:
// the `cobolwork` there has been a working checkout, mid-merge. Env is read per call.

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../monitor/registry.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const TOOL = 'cobolwork';
export const PIN_SCHEMA = join(CW, 'schema', 'tool-pins.schema.json');
export const INSTALL_COMMAND = 'node bin/cobolwork-pin.mjs --install';
export const RECEIPT = 'install.json';
export const SCRIPT = 'package/bin/cobolwork.mjs';
export const REVISION = 'package/lib/revision.json';
export const MANIFEST = 'package/package.json';
// The interim contract until report schemas and a fingerprint golden exist: exactly these.
export const CAPABILITIES = Object.freeze({ tool: 'cobolwork-capabilities', schemaVersion: 1, identity: 'cobolwork/v1' });
const SCRIPT_RE = /\.(mjs|cjs|js)$/i;

export const pinsPath = (env = process.env) => env.CW_TOOL_PINS || join(CW, 'manifests', 'tool-pins.json');
export const toolsRoot = (env = process.env) => env.CW_TOOLS_ROOT || join(homedir(), '.commitwork', 'tools');
export const installDir = (pin, env = process.env) => join(toolsRoot(env), TOOL, pin.version);
export const pinUrl = (p) => `https://github.com/${p.repo}/releases/download/${p.tag}/${p.asset}`;
const shown = (p) => { const r = relative(CW, p); return r && !r.startsWith('..') ? r : p; };

// -> { ok, path, pin, doc } | { ok:false, path, reason }. Absent, unparseable or off-schema is refused, never defaulted.
export function readPin({ env = process.env, name = TOOL } = {}) {
  const path = pinsPath(env);
  let doc;
  try { doc = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { return { ok: false, path, reason: `the pin file ${shown(path)} could not be read (${e.code || e.message})` }; }
  const { errors } = validateAgainstSchema(doc, { path: PIN_SCHEMA });
  if (errors.length) return { ok: false, path, reason: `the pin file ${shown(path)} does not satisfy schema/tool-pins.schema.json: ${errors[0]}` };
  const pin = doc.tools[name];
  if (!pin) return { ok: false, path, reason: `${shown(path)} pins no ${name}` };
  if (pin.url !== pinUrl(pin)) return { ok: false, path, reason: `${shown(path)}: ${name}.url is not ${pinUrl(pin)}, the asset its repo, tag and asset name` };
  return { ok: true, path, pin, doc };
}

// Over paths and contents, sorted; modes are left out because Windows does not keep them.
export function digestEntries(entries) {
  const h = createHash('sha256');
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(`${e.path}\0${createHash('sha256').update(e.data).digest('hex')}\n`);
  }
  return h.digest('hex');
}

// Every regular file under <dir>/package; a link or a special file throws.
export function readTree(dir) {
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel))) {
      const r = `${rel}/${name}`;
      const st = lstatSync(join(dir, r));
      if (st.isDirectory()) walk(r);
      else if (st.isFile()) out.push({ path: r, data: readFileSync(join(dir, r)) });
      else throw new Error(`${r} is neither a file nor a directory`);
    }
  };
  walk('package');
  return out;
}

// The commit a packed cobolwork states in lib/revision.json, or why there is none.
export function statedCommit(entries) {
  const e = entries.find((x) => x.path === REVISION);
  if (!e) return { reason: `the package has no ${REVISION.slice('package/'.length)}, so it states no commit` };
  try {
    const c = JSON.parse(e.data.toString('utf8')).commit;
    return /^[0-9a-f]{40}$/.test(String(c)) ? { commit: c } : { reason: `${REVISION} states no commit id (${JSON.stringify(c)})` };
  } catch (err) { return { reason: `${REVISION} is not JSON (${err.message})` }; }
}

// -> { ok, dir, script, receipt } | { ok:false, dir, reason }. Reads files only; the capabilities
// run belongs to the installer and to --check.
export function verifyInstall(pin, { env = process.env, platform = process.platform } = {}) {
  const dir = installDir(pin, env);
  const fail = (reason) => ({ ok: false, dir, reason });
  let receipt;
  try { receipt = JSON.parse(readFileSync(join(dir, RECEIPT), 'utf8')); }
  catch (e) {
    if (e.code !== 'ENOENT') return fail(`${join(dir, RECEIPT)} could not be read (${e.code || e.message})`);
    return fail(existsSync(dir) ? `${dir} holds no install receipt, so nothing there was installed by the pin tool` : `nothing is installed at ${dir}`);
  }
  for (const k of ['version', 'sha256', 'commit']) {
    if (receipt[k] !== pin[k]) return fail(`${dir} was installed with ${k} ${JSON.stringify(receipt[k])}, and the pin says ${pin[k]}`);
  }
  let files;
  try { files = readTree(dir); } catch (e) { return fail(`${dir} could not be read whole (${e.code || e.message})`); }
  if (digestEntries(files) !== receipt.treeSha256) return fail(`the files under ${dir} are not the ones installed from ${pin.asset}`);
  const stated = statedCommit(files);
  if (stated.commit !== pin.commit) return fail(stated.reason || `${dir} states commit ${stated.commit}, and the pin says ${pin.commit}`);
  const script = join(dir, ...SCRIPT.split('/'));
  if (platform !== 'win32') {
    try { if (!(statSync(script).mode & 0o100)) return fail(`${script} is not executable`); }
    catch (e) { return fail(`${script} could not be read (${e.code || e.message})`); }
  }
  return { ok: true, dir, script, receipt };
}

// -> { ok:true, source:'override'|'pinned', path, file, args, ...pinned: dir, version, commit }
//  | { ok:false, source, reason }
// `file` + `args` start a spawn; `path` is what a shell lane runs, and is executable.
export function resolveCobolwork({ env = process.env, platform = process.platform } = {}) {
  const bin = env.CW_COBOLWORK_BIN;
  if (bin) return { ok: true, source: 'override', path: bin, ...(SCRIPT_RE.test(bin) ? { file: process.execPath, args: [bin] } : { file: bin, args: [] }) };
  const p = readPin({ env });
  if (!p.ok) return { ok: false, source: 'pinned', reason: `${p.reason}, so no cobolwork is available (a cobolwork on PATH is not used)` };
  const v = verifyInstall(p.pin, { env, platform });
  if (!v.ok) {
    return { ok: false, source: 'pinned', version: p.pin.version,
      reason: `cobolwork ${p.pin.version}, pinned in ${shown(p.path)}, is not installed: ${v.reason}. Run \`${INSTALL_COMMAND}\`, or set CW_COBOLWORK_BIN; a cobolwork on PATH is not used` };
  }
  return { ok: true, source: 'pinned', path: v.script, file: process.execPath, args: [v.script], dir: v.dir, version: p.pin.version, commit: p.pin.commit };
}

// Tools resolved this way rather than from PATH, and the variable a lane reads the result from.
const PINNED = Object.freeze({ cobolwork: resolveCobolwork });
export const isPinnedTool = (name) => Object.hasOwn(PINNED, name);
export const resolvePinnedTool = (name, opts) => (isPinnedTool(name) ? PINNED[name](opts) : null);
export const toolEnvVar = (name) => `CW_TOOL_${String(name).toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

// null when a `capabilities --json` document meets the contract, else what is wrong with it.
// `needs` maps a command to the options commitwork passes it.
export function capabilitiesProblem(doc, { needs = {} } = {}) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return 'it wrote no capabilities document';
  if (doc.tool !== CAPABILITIES.tool) return `it wrote ${JSON.stringify(doc.tool)}, not ${CAPABILITIES.tool}`;
  if (doc.schemaVersion !== CAPABILITIES.schemaVersion) return `its capabilities schemaVersion is ${JSON.stringify(doc.schemaVersion)}, and commitwork reads only ${CAPABILITIES.schemaVersion}`;
  const identity = doc.identity && doc.identity.version;
  if (identity !== CAPABILITIES.identity) return `its fingerprint identity is ${JSON.stringify(identity)}, and commitwork reads only ${CAPABILITIES.identity}`;
  for (const [cmd, options] of Object.entries(needs)) {
    const c = doc.commands && doc.commands[cmd];
    if (!c) return `it has no ${cmd} command`;
    const lacking = options.filter((o) => !(Array.isArray(c.options) && c.options.includes(o)));
    if (lacking.length) return `its ${cmd} takes no ${lacking.join(', ')}`;
  }
  return null;
}
