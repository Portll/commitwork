#!/usr/bin/env node
// usage: model-artefacts.mjs [rootDir]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_MODEL_MAX_BYTES (whole-file read cap, default 256 MiB),
//   CW_MODELSCAN (path to modelscan, or 'off'; default probes PATH), CW_SCAN_EXCLUDE_DIRS
// output: {tool, summary:{findings, byRule, filesScanned, unreadable, skippedOversize, ...}, findings[]}
//   module names, opcode counts, key paths, paths and rule ids only — never file contents.
//
// Keras: a Lambda layer carries serialised Python that runs on load. Read from a .keras zip's
// config.json, a SavedModel's keras_metadata.pb, and a Keras-2 .h5 — the last two by locating every
// config blob by its own opening anywhere in the bytes (h5py stores the attribute as a heap-referenced
// vlen string), NOT an HDF5 or protobuf reader; the model_config attribute name is only the witness
// that a config was declared, and declared-but-unlocated or unparseable is unreadable, never clean.
//
// TensorFlow graphs (saved_model.pb, *.pb, *.pbtxt): NodeDef ops by protobuf signature (tag 0x12,
// one-byte length, exact op name). ReadFile/WriteFile reach the filesystem at inference; PyFunc-class
// ops run arbitrary Python. A graph in which no op-shaped string was seen is counted apart, because
// a scan that read nothing has nothing to be quiet about.
import { readdirSync, lstatSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';
import { inflateRawSync, inflateSync, gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { dirExcluder } from './scan-exclusions.mjs';

export const TOOL = 'model-artefacts';

// CWE-94 for the template rule rather than CWE-1427: the dataset loader RENDERS the template and
// executes what it yields, which is code generation from an untrusted config file. CWE-1427 is
// injection into an LLM prompt, a mechanism no loader config ever reaches.
export const RULE_CWE = Object.freeze({
  'pickle-dangerous-global': 'CWE-502',
  'safetensors-header-invalid': 'CWE-502',
  'dataset-config-template': 'CWE-94',
  'dataset-config-remote-scheme': 'CWE-829',
  'hf-trust-remote-code': 'CWE-829',
  'hf-unpinned-revision': 'CWE-1357',
  'keras-lambda-layer': 'CWE-502',
  'tf-graph-file-op': 'CWE-73',
  'tf-graph-python-op': 'CWE-94',
});

export const RULE_SEV = Object.freeze({
  'pickle-dangerous-global': 'crit',
  'safetensors-header-invalid': 'med',
  'dataset-config-template': 'crit',
  'dataset-config-remote-scheme': 'high',
  'hf-trust-remote-code': 'high',
  'hf-unpinned-revision': 'med',
  'keras-lambda-layer': 'high',
  'tf-graph-file-op': 'high',
  'tf-graph-python-op': 'crit',
});

export const TF_FILE_OPS = Object.freeze(['ReadFile', 'WriteFile']);
export const TF_PYTHON_OPS = Object.freeze(['PyFunc', 'PyFuncStateless', 'EagerPyFunc']);

export const DANGEROUS_MODULES = new Set([
  'os', 'subprocess', 'builtins', 'importlib', 'socket', 'runpy', 'sys', 'shutil', 'posix', 'nt',
  'pty', 'commands', '__builtin__',
]);

const MODEL_EXT = /\.(pkl|pickle|pt|pth|bin|ckpt|joblib)$/i;
const SAFETENSORS_EXT = /\.safetensors$/i;
const KERAS_EXT = /\.keras$/i;
const H5_EXT = /\.(h5|hdf5)$/i;
const PB_EXT = /\.pb$/i;
const PBTXT_EXT = /\.pbtxt$/i;
const HDF5_SIG = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const MODEL_CONFIG_ATTR = Buffer.from('model_config\0', 'latin1');
const CONFIG_OPENERS = ['{"class_name"', '{"module"'].map((m) => Buffer.from(m, 'latin1'));
const PBTXT_OP_RE = /^\s*op\s*:\s*"([A-Za-z][A-Za-z0-9_]*)"/gm;
const OP_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const LAYER_NAME_MAX = 64;
const YAML_EXT = /\.ya?ml$/i;
const PY_EXT = /\.py$/i;
const DATASET_JSON_NAMES = new Set(['dataset_infos.json', 'dataset_info.json']);
const JSON_SURFACE_RE = /"(?:data_files|refs)"\s*:/;
const YAML_SURFACE_RE = /^\s*(?:-\s*)?(?:data_files|configs|dataset_info|target_protocol|fo)\s*:|reference:\/\/|^\s*protocol\s*:\s*['"]?reference\b/m;
const DATA_PATH_KEYS = new Set(['data_files', 'data_dir', 'path', 'paths', 'fo', 'target', 'refs', 'base_path', 'glob']);
// Where a template is executed rather than displayed: the loader fields plus kerchunk's own
// `templates` block. A `{{` in a description is counted apart, never published as a finding.
const LOADER_KEYS = new Set([...DATA_PATH_KEYS, 'configs', 'dataset_info', 'splits', 'templates', 'reference',
  'target_options', 'storage_options', 'offset', 'target_protocol', 'remote_options']);
const TEMPLATE_RE = /\{\{|\{%|\$\{/;
const REMOTE_RE = /^(reference|s3|gs|https?|file):\/\//i;
const HF_CALL_RE = /\b(from_pretrained|hf_hub_download|load_dataset|snapshot_download)\s*\(/g;
const SHA_REVISION_RE = /\brevision\s*=\s*(['"])[0-9a-fA-F]{40}\1/;
const LITERAL_REVISION_RE = /\brevision\s*=\s*['"]/;
const ANY_REVISION_RE = /\brevision\s*=/;
const TRUST_RE = /\btrust_remote_code\s*=\s*True\b/;
const SAFETENSORS_HEADER_MAX = 100 * 1024 * 1024;
const LIST_CAP = 50;

export const maxBytes = () => {
  const n = Number(process.env.CW_MODEL_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 256 * 1024 * 1024;
};
// Root-relative directories never walked: the scan canary's dirty tree plants a live os.system
// pickle, and counting it would report a fixture built to fire as this repository having it.
export const skipPaths = () => (process.env.CW_MODEL_SKIP_PATHS ?? 'fixtures/scan-canary/dirty')
  .split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean);

// ── pickle opcode walker ────────────────────────────────────────────────────────────────────────
const OBJ = Object.freeze({ obj: true });
const isDangerous = (mod) => DANGEROUS_MODULES.has(String(mod).split('.')[0]);
const unquote = (s) => s.replace(/^(['"])(.*)\1$/s, '$2');

export function walkPickle(buf) {
  const r = { ok: false, opcodes: 0, globals: [], reduce: 0, build: 0, ext: 0, error: null };
  const stack = []; const marks = []; const memo = new Map();
  let pos = 0;
  const need = (n) => { if (pos + n > buf.length) throw new Error(`truncated after opcode ${r.opcodes}`); };
  const pop = () => { if (!stack.length) throw new Error(`stack underflow at opcode ${r.opcodes}`); return stack.pop(); };
  const popMark = () => { if (!marks.length) throw new Error(`no MARK at opcode ${r.opcodes}`); return stack.splice(marks.pop()); };
  const top = () => (stack.length ? stack[stack.length - 1] : OBJ);
  const line = () => {
    const nl = buf.indexOf(0x0a, pos);
    if (nl < 0) throw new Error(`unterminated text argument at opcode ${r.opcodes}`);
    const s = buf.toString('latin1', pos, Math.min(nl, pos + 4096)); pos = nl + 1; return s;
  };
  const text = (n) => { need(n); const s = buf.toString('utf8', pos, pos + Math.min(n, 4096)); pos += n; return s; };
  const skip = (n) => { need(n); pos += n; };
  const len1 = () => { need(1); return buf[pos++]; };
  const len4 = () => { need(4); const n = buf.readUInt32LE(pos); pos += 4; return n; };
  const len8 = () => { need(8); const n = Number(buf.readBigUInt64LE(pos)); pos += 8; return n; };
  const str = (v) => (typeof v === 'string' ? v : '?');
  const global = (module, name, via) => { const g = { module, name, via, reduced: false, built: false }; r.globals.push(g); return { g }; };
  const callee = (v, how) => { if (v && v.g) v.g[how] = true; };
  try {
    while (pos < buf.length) {
      const op = buf[pos++]; r.opcodes++;
      switch (op) {
        case 0x28: marks.push(stack.length); break;
        case 0x2e: r.ok = true; return r;
        case 0x30: pop(); break;
        case 0x31: popMark(); break;
        case 0x32: stack.push(top()); break;
        case 0x46: case 0x49: case 0x4c: line(); stack.push(OBJ); break;
        case 0x4a: skip(4); stack.push(OBJ); break;
        case 0x4b: skip(1); stack.push(OBJ); break;
        case 0x4d: skip(2); stack.push(OBJ); break;
        case 0x4e: stack.push(OBJ); break;
        case 0x50: line(); stack.push(OBJ); break;
        case 0x51: pop(); stack.push(OBJ); break;
        case 0x52: { pop(); callee(pop(), 'reduced'); r.reduce++; stack.push(OBJ); break; }
        case 0x53: stack.push(unquote(line())); break;
        case 0x54: stack.push(text(len4())); break;
        case 0x55: stack.push(text(len1())); break;
        case 0x56: stack.push(line()); break;
        case 0x58: stack.push(text(len4())); break;
        case 0x61: pop(); break;
        case 0x62: pop(); r.build++; break;
        case 0x63: { const m = line(); const n = line(); stack.push(global(m, n, 'GLOBAL')); break; }
        case 0x64: popMark(); stack.push(OBJ); break;
        case 0x7d: stack.push(OBJ); break;
        case 0x65: popMark(); break;
        case 0x67: stack.push(memo.get(line().trim()) ?? OBJ); break;
        case 0x68: stack.push(memo.get(String(len1())) ?? OBJ); break;
        case 0x69: { const m = line(); const n = line(); popMark(); const g = global(m, n, 'INST'); g.g.built = true; stack.push(g); break; }
        case 0x6a: stack.push(memo.get(String(len4())) ?? OBJ); break;
        case 0x6c: popMark(); stack.push(OBJ); break;
        case 0x5d: stack.push(OBJ); break;
        case 0x6f: { const items = popMark(); callee(items[0], 'built'); stack.push(OBJ); break; }
        case 0x70: memo.set(line().trim(), top()); break;
        case 0x71: memo.set(String(len1()), top()); break;
        case 0x72: memo.set(String(len4()), top()); break;
        case 0x73: pop(); pop(); break;
        case 0x74: popMark(); stack.push(OBJ); break;
        case 0x29: stack.push(OBJ); break;
        case 0x75: popMark(); break;
        case 0x47: skip(8); stack.push(OBJ); break;
        case 0x80: skip(1); break;
        case 0x81: { pop(); callee(pop(), 'built'); stack.push(OBJ); break; }
        case 0x82: skip(1); r.ext++; stack.push(OBJ); break;
        case 0x83: skip(2); r.ext++; stack.push(OBJ); break;
        case 0x84: skip(4); r.ext++; stack.push(OBJ); break;
        case 0x85: pop(); stack.push(OBJ); break;
        case 0x86: pop(); pop(); stack.push(OBJ); break;
        case 0x87: pop(); pop(); pop(); stack.push(OBJ); break;
        case 0x88: case 0x89: stack.push(OBJ); break;
        case 0x8a: skip(len1()); stack.push(OBJ); break;
        case 0x8b: skip(len4()); stack.push(OBJ); break;
        case 0x42: skip(len4()); stack.push(OBJ); break;
        case 0x43: skip(len1()); stack.push(OBJ); break;
        case 0x8c: stack.push(text(len1())); break;
        case 0x8d: stack.push(text(len8())); break;
        case 0x8e: skip(len8()); stack.push(OBJ); break;
        case 0x8f: stack.push(OBJ); break;
        case 0x90: popMark(); break;
        case 0x91: popMark(); stack.push(OBJ); break;
        case 0x92: { pop(); pop(); callee(pop(), 'built'); stack.push(OBJ); break; }
        case 0x93: { const n = pop(); const m = pop(); stack.push(global(str(m), str(n), 'STACK_GLOBAL')); break; }
        case 0x94: memo.set(String(memo.size), top()); break;
        case 0x95: skip(8); break;
        case 0x96: skip(len8()); stack.push(OBJ); break;
        case 0x97: stack.push(OBJ); break;
        case 0x98: break;
        default: throw new Error(`unknown opcode 0x${op.toString(16)} at byte ${pos - 1}`);
      }
    }
    throw new Error('no STOP opcode');
  } catch (e) {
    r.error = e.message;
    return r;
  }
}

// ── zip reader (STORED and DEFLATE members, zip64 aware) ────────────────────────────────────────
export function zipMembers(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('no end-of-central-directory record');
  let count = buf.readUInt16LE(eocd + 10);
  let cdSize = buf.readUInt32LE(eocd + 12);
  let cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) {
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip64 fields set but no zip64 locator');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (z64 + 56 > buf.length || buf.readUInt32LE(z64) !== 0x06064b50) throw new Error('zip64 end record missing');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdSize = Number(buf.readBigUInt64LE(z64 + 40));
    cdOff = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const out = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory entry ${i} unreadable`);
    const method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20);
    let usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (usize === 0xffffffff || csize === 0xffffffff || offset === 0xffffffff) {
      let e = p + 46 + nameLen; const end = e + extraLen;
      while (e + 4 <= end) {
        const id = buf.readUInt16LE(e); const len = buf.readUInt16LE(e + 2); let q = e + 4;
        if (id === 1) {
          if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
          if (offset === 0xffffffff) { offset = Number(buf.readBigUInt64LE(q)); q += 8; }
        }
        e += 4 + len;
      }
    }
    out.push({ name, method, csize, usize, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// guard: a member's declared inflated size is checked before anything is inflated
export function zipRead(buf, m, cap = maxBytes()) {
  if (m.usize > cap) throw new Error(`${m.name} declares ${m.usize} inflated bytes, over the ${cap}-byte cap`);
  if (m.offset + 30 > buf.length || buf.readUInt32LE(m.offset) !== 0x04034b50) throw new Error(`local header for ${m.name} unreadable`);
  const nameLen = buf.readUInt16LE(m.offset + 26);
  const extraLen = buf.readUInt16LE(m.offset + 28);
  const start = m.offset + 30 + nameLen + extraLen;
  if (start + m.csize > buf.length) throw new Error(`${m.name} data runs past end of file`);
  const data = buf.subarray(start, start + m.csize);
  if (m.method === 0) return data;
  if (m.method === 8) return inflateRawSync(data);
  throw new Error(`${m.name} uses compression method ${m.method}`);
}

// ── model artefact (pickle family) ──────────────────────────────────────────────────────────────
const isZip = (b) => b.length >= 4 && b.readUInt32LE(0) === 0x04034b50;
const isGzip = (b) => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;
const isZlib = (b) => b.length >= 2 && b[0] === 0x78 && ((b[0] << 8) | b[1]) % 31 === 0;

function walkStream(buf, member, acc) {
  const r = walkPickle(buf);
  const bad = r.globals.filter((g) => isDangerous(g.module));
  for (const g of bad) acc.dangerous.push({ ...g, member });
  acc.opcodes += r.opcodes; acc.reduce += r.reduce; acc.walked += 1;
  if (!r.ok) acc.errors.push(`${member ? `${member}: ` : ''}${r.error}`);
}

export function scanModelBuffer(buf) {
  const acc = { kind: 'pickle', dangerous: [], opcodes: 0, reduce: 0, walked: 0, errors: [], members: 0 };
  try {
    if (isZip(buf)) {
      acc.kind = 'zip';
      const members = zipMembers(buf).filter((m) => /\.pkl$/i.test(m.name));
      acc.members = members.length;
      for (const m of members) {
        try { walkStream(zipRead(buf, m), m.name, acc); } catch (e) { acc.errors.push(`${m.name}: ${e.message}`); }
      }
    } else if (isGzip(buf)) {
      acc.kind = 'gzip+pickle'; walkStream(gunzipSync(buf), '', acc);
    } else if (isZlib(buf)) {
      acc.kind = 'zlib+pickle'; walkStream(inflateSync(buf), '', acc);
    } else {
      walkStream(buf, '', acc);
    }
  } catch (e) {
    acc.errors.push(e.message);
  }
  return acc;
}

function pickleDetail(acc) {
  const names = [...new Set(acc.dangerous.map((g) => {
    const how = [g.via, g.reduced ? 'REDUCE' : '', g.built ? 'BUILD/NEWOBJ' : ''].filter(Boolean).join('+');
    return `${g.module}.${g.name} (${how}${g.member ? `, member ${g.member}` : ''})`;
  }))];
  return `dangerous globals: ${names.join('; ')}; opcodes ${acc.opcodes}; reduce ${acc.reduce}`
    + (acc.kind === 'zip' ? `; ${acc.members} pickle member(s)` : '')
    + (acc.errors.length ? `; walk incomplete: ${acc.errors[0]}` : '');
}

// ── keras: Lambda layers ────────────────────────────────────────────────────────────────────────
const sanitiseName = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9_./-]/g, '_').slice(0, LAYER_NAME_MAX) : null);

// A Lambda is any object whose class_name is "Lambda", wherever it sits (Sequential, Functional,
// nested models). The function body is never read; the layer NAME is sanitised and capped.
export function findLambdaLayers(config) {
  const layers = [];
  const walk = (v) => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (!v || typeof v !== 'object') return;
    if (v.class_name === 'Lambda') layers.push(sanitiseName(v.config && v.config.name) || '(unnamed)');
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(config);
  return layers;
}

export function scanKerasConfigText(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { unreadable: 'config is not JSON', layers: [] }; }
  return { unreadable: null, layers: findLambdaLayers(j) };
}

export function scanKerasZip(buf, cap = maxBytes()) {
  const out = { config: false, layers: [], unreadable: null };
  let members;
  try { members = zipMembers(buf); } catch (e) { out.unreadable = e.message; return out; }
  const cfg = members.find((m) => m.name === 'config.json' || m.name.endsWith('/config.json'));
  if (!cfg) return out;
  out.config = true;
  let text;
  try { text = zipRead(buf, cfg, cap).toString('utf8'); } catch (e) { out.unreadable = e.message; return out; }
  const r = scanKerasConfigText(text);
  out.layers = r.layers; out.unreadable = r.unreadable;
  return out;
}

// fact: the HDF5 signature may sit at 0 or at 512·2^n, the user-block sizes / a file with none is not HDF5 and is unreadable, never a weights-only clean (expiry: never, prev: not built)
export function isHdf5(buf) {
  for (let off = 0; off + 8 <= buf.length; off = off === 0 ? 512 : off * 2) {
    if (buf.subarray(off, off + 8).equals(HDF5_SIG)) return true;
  }
  return false;
}

// Bracket-matched, quote-aware JSON extraction from a byte offset; returns the end offset or -1.
function jsonEnd(buf, start, limit) {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < limit; i++) {
    const c = buf[i];
    if (inStr) { if (esc) esc = false; else if (c === 0x5c) esc = true; else if (c === 0x22) inStr = false; continue; }
    if (c === 0x22) inStr = true;
    else if (c === 0x7b) depth++;
    else if (c === 0x7d && --depth === 0) return i + 1;
  }
  return -1;
}

// fact: h5py stores a str attribute as a VARIABLE-LENGTH string whose data is a 16-byte global-heap id, so the JSON is not adjacent to the attribute name / a search anchored on the name found nothing on a real Keras-2 file and read it unreadable (expiry: never, prev: wrong)
// Every Keras config blob in the file is located by its own opening (`{"class_name"` or `{"module"`),
// wherever HDF5 or protobuf stored it; the attribute name is only the witness that a config was
// DECLARED. A declared config with no located blob is unreadable, never clean.
export function findConfigBlobs(buf) {
  const blobs = []; const seen = new Set(); let unreadable = null; let cursor = 0;
  for (;;) {
    let open = -1;
    for (const m of CONFIG_OPENERS) { const i = buf.indexOf(m, cursor); if (i >= 0 && (open < 0 || i < open)) open = i; }
    if (open < 0) break;
    const end = jsonEnd(buf, open, buf.length);
    if (end < 0) { unreadable = unreadable || 'a Keras config JSON is unterminated'; break; }
    const text = buf.toString('utf8', open, end);
    cursor = end;
    if (seen.has(text)) continue; // the same config stored at two offsets is one config
    seen.add(text);
    const r = scanKerasConfigText(text);
    if (r.unreadable) unreadable = unreadable || `Keras config: ${r.unreadable}`;
    else blobs.push({ at: open, layers: r.layers });
  }
  return { blobs, unreadable };
}

export function scanH5Buffer(buf) {
  const out = { hdf5: isHdf5(buf), declared: false, configs: 0, layers: [], unreadable: null };
  if (!out.hdf5) { out.unreadable = 'no HDF5 signature at 0 or at a user-block boundary'; return out; }
  out.declared = buf.indexOf(MODEL_CONFIG_ATTR) >= 0;
  const { blobs, unreadable } = findConfigBlobs(buf);
  out.configs = blobs.length;
  for (const b of blobs) for (const l of b.layers) out.layers.push(l);
  out.unreadable = unreadable;
  if (!out.unreadable && out.declared && !out.configs) out.unreadable = 'model_config attribute declared but no JSON config located';
  return out;
}

// ── tensorflow graphs: NodeDef ops by protobuf signature ────────────────────────────────────────
// NodeDef.op is field 2 (tag 0x12) as a length-delimited string; a name is field 1 (0x0a), so a node
// NAMED "ReadFile" does not match. One-byte lengths only: no TF op name is 128+ characters.
export function scanGraphBuffer(buf) {
  const hits = {}; let opsSeen = 0;
  for (let i = 0; i + 2 < buf.length; i++) {
    if (buf[i] !== 0x12) continue;
    const len = buf[i + 1];
    if (len < 1 || len > 63 || i + 2 + len > buf.length) continue;
    const s = buf.toString('latin1', i + 2, i + 2 + len);
    if (!OP_NAME_RE.test(s)) continue;
    opsSeen++;
    if (TF_FILE_OPS.includes(s) || TF_PYTHON_OPS.includes(s)) hits[s] = (hits[s] || 0) + 1;
  }
  return { opsSeen, hits };
}

export function scanGraphText(text) {
  const hits = {}; let opsSeen = 0;
  PBTXT_OP_RE.lastIndex = 0;
  let m;
  while ((m = PBTXT_OP_RE.exec(text))) {
    opsSeen++;
    if (TF_FILE_OPS.includes(m[1]) || TF_PYTHON_OPS.includes(m[1])) hits[m[1]] = (hits[m[1]] || 0) + 1;
  }
  return { opsSeen, hits };
}

const opDetail = (hits, ops) => ops.filter((o) => hits[o]).map((o) => `${o} ×${hits[o]}`).join(', ');
const lambdaDetail = (layers, where) => `${layers.length} Lambda layer(s) in ${where}: ${[...new Set(layers)].slice(0, 10).join(', ')} — a Lambda carries serialised Python that runs on load`;

// ── safetensors ─────────────────────────────────────────────────────────────────────────────────
export function scanSafetensorsFile(abs, size) {
  if (size < 8) return { invalid: `file is ${size} bytes, shorter than the 8-byte header length` };
  const fd = openSync(abs, 'r');
  try {
    const head = Buffer.alloc(8); readSync(fd, head, 0, 8, 0);
    const n = head.readBigUInt64LE(0);
    if (n > BigInt(size - 8)) return { invalid: `header length ${n} exceeds file size ${size}` };
    if (n > BigInt(SAFETENSORS_HEADER_MAX)) return { invalid: `header length ${n} exceeds the format's 100 MiB bound` };
    const len = Number(n);
    const hdr = Buffer.alloc(len); readSync(fd, hdr, 0, len, 8);
    let j;
    try { j = JSON.parse(hdr.toString('utf8')); } catch { return { invalid: 'header is not JSON' }; }
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { invalid: 'header JSON is not an object' };
    return { invalid: null };
  } finally { closeSync(fd); }
}

// ── dataset configs ─────────────────────────────────────────────────────────────────────────────
function walkJson(v, path, visit) {
  if (typeof v === 'string') visit(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkJson(x, [...path, String(i)], visit));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walkJson(v[k], [...path, k], visit);
}

export function scanDatasetJson(text) {
  let j;
  try { j = JSON.parse(text); } catch { return { unreadable: 'not JSON' }; }
  const hits = { template: [], remote: [], templateInProse: 0 };
  walkJson(j, [], (s, path) => {
    const where = path.join('.') || '(root)';
    if (TEMPLATE_RE.test(s)) { if (path.some((k) => LOADER_KEYS.has(k))) hits.template.push(where); else hits.templateInProse++; }
    const m = REMOTE_RE.exec(s);
    if (m && path.some((k) => DATA_PATH_KEYS.has(k))) hits.remote.push(`${m[1].toLowerCase()}:// at ${where}`);
  });
  return { hits };
}

const stripYamlComment = (line) => {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
};
const yamlScalar = (s) => unquote(s.trim());

export function scanDatasetYaml(text) {
  const hits = { template: [], remote: [], templateInProse: 0 };
  const stack = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = stripYamlComment(lines[i].replace(/\r$/, ''));
    if (!raw.trim() || raw.trim() === '---') continue;
    const indent = raw.match(/^\s*/)[0].length;
    let key = null; let value = null; let context;
    const kv = /^(\s*)(-\s+)?([^\s'"#{}[\]][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(raw);
    const item = /^(\s*)-\s+(.*)$/.exec(raw);
    if (kv) {
      key = kv[3].trim(); value = kv[4] == null ? '' : kv[4];
      const keyIndent = indent + (kv[2] ? kv[2].length : 0);
      while (stack.length && stack[stack.length - 1].indent >= keyIndent) stack.pop();
      context = [...stack.map((s) => s.key), key];
      stack.push({ indent: keyIndent, key });
    } else if (item) {
      value = item[2];
      while (stack.length && stack[stack.length - 1].indent >= indent + 1 && stack[stack.length - 1].indent > indent) stack.pop();
      context = stack.map((s) => s.key);
    } else {
      value = raw;
      context = stack.filter((s) => s.indent < indent).map((s) => s.key);
    }
    if (!value) continue;
    const where = `${context.join('.') || '(root)'} line ${i + 1}`;
    if (TEMPLATE_RE.test(value)) { if (context.some((k) => LOADER_KEYS.has(k))) hits.template.push(where); else hits.templateInProse++; }
    const m = REMOTE_RE.exec(yamlScalar(value));
    if (m && context.some((k) => DATA_PATH_KEYS.has(k))) hits.remote.push(`${m[1].toLowerCase()}:// at ${where}`);
  }
  return { hits };
}

function frontMatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  return end < 0 ? null : text.slice(0, end + 4);
}

// ── python ──────────────────────────────────────────────────────────────────────────────────────
function callArgs(src, from) {
  let depth = 0; let q = null;
  for (let i = from; i < src.length && i < from + 20000; i++) {
    const c = src[i];
    if (q) {
      if (c === '\\') { i++; continue; }
      if (src.startsWith(q, i)) { i += q.length - 1; q = null; }
      continue;
    }
    if (c === '"' || c === "'") { q = src.startsWith(c.repeat(3), i) ? c.repeat(3) : c; i += q.length - 1; continue; }
    if (c === '#') { const nl = src.indexOf('\n', i); if (nl < 0) break; i = nl; continue; }
    if (c === '(') depth++;
    else if (c === ')') { if (--depth === 0) return src.slice(from + 1, i); }
  }
  return null;
}

export function scanPython(src) {
  const out = { trust: [], unpinned: [], nonLiteral: 0 };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*#/.test(l)) continue;
    const code = l.replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""').replace(/#.*$/, '');
    if (TRUST_RE.test(code)) out.trust.push(i + 1);
  }
  HF_CALL_RE.lastIndex = 0;
  let m;
  while ((m = HF_CALL_RE.exec(src))) {
    const lineNo = src.slice(0, m.index).split('\n').length;
    if (/^\s*#/.test(lines[lineNo - 1] || '')) continue;
    const args = callArgs(src, m.index + m[0].length - 1);
    if (args == null) continue;
    if (SHA_REVISION_RE.test(args)) continue;
    if (LITERAL_REVISION_RE.test(args)) out.unpinned.push(`${m[1]} line ${lineNo} (revision is a branch or tag, not a commit sha)`);
    else if (ANY_REVISION_RE.test(args)) out.nonLiteral++;
    else out.unpinned.push(`${m[1]} line ${lineNo} (no revision=)`);
  }
  return out;
}

// ── the walk ────────────────────────────────────────────────────────────────────────────────────
const firstLine = (s) => Number((/line (\d+)/.exec(s) || [])[1]) || 0;

export function scanTree(root) {
  const cap = maxBytes();
  const skipDir = dirExcluder();
  const skipRel = new Set(skipPaths());
  const summary = {
    findings: 0, byRule: {}, filesScanned: 0, unreadable: 0, skippedOversize: 0,
    surfaces: { modelArtefacts: 0, safetensors: 0, datasetConfigs: 0, python: 0, kerasConfigs: 0, tfGraphs: 0 },
    pickleMembersWalked: 0, revisionNonLiteral: 0, templateInProse: 0, maxBytes: cap,
    kerasWithoutConfig: 0, tfGraphsWithoutNodes: 0,
    skippedPaths: [], unreadableFiles: [], oversizeFiles: [], kerasWithoutConfigFiles: [], tfGraphsWithoutNodesFiles: [],
  };
  const findings = [];
  const add = (rule, path, detail, line) => {
    const f = { rule, path, sev: RULE_SEV[rule], cwe: RULE_CWE[rule], detail };
    if (line) f.line = line;
    findings.push(f);
  };
  const listed = (arr, entry) => { if (arr.length < LIST_CAP) arr.push(entry); };
  const unreadable = (rel, why) => { summary.unreadable++; listed(summary.unreadableFiles, { path: rel, why }); };

  const file = (abs, rel, size) => {
    const name = basename(abs);
    const isModel = MODEL_EXT.test(name);
    const isSt = SAFETENSORS_EXT.test(name);
    const isJsonSurface = DATASET_JSON_NAMES.has(name) || (/\.json$/i.test(name) && !/^package(-lock)?\.json$/.test(name));
    const isYaml = YAML_EXT.test(name) || /^README\.md$/i.test(name);
    const isPy = PY_EXT.test(name);
    const isKeras = KERAS_EXT.test(name);
    const isH5 = H5_EXT.test(name);
    const isKerasMeta = name === 'keras_metadata.pb';
    const isGraph = !isKerasMeta && name !== 'fingerprint.pb' && (PB_EXT.test(name) || PBTXT_EXT.test(name)); // a SavedModel's fingerprint carries hashes, never NodeDefs
    if (!isModel && !isSt && !isJsonSurface && !isYaml && !isPy && !isKeras && !isH5 && !isKerasMeta && !isGraph) return;

    if (isSt) {
      summary.filesScanned++; summary.surfaces.safetensors++;
      let r;
      try { r = scanSafetensorsFile(abs, size); } catch (e) { unreadable(rel, `safetensors read failed: ${e.message}`); return; }
      if (r.invalid) add('safetensors-header-invalid', rel, r.invalid);
      return;
    }
    if (size > cap) {
      summary.skippedOversize++; listed(summary.oversizeFiles, { path: rel, bytes: size });
      return;
    }
    let buf;
    try { buf = readFileSync(abs); } catch (e) { summary.filesScanned++; unreadable(rel, `read failed: ${e.code || e.message}`); return; }

    if (isKeras || isH5) {
      summary.filesScanned++; summary.surfaces.kerasConfigs++;
      const r = isKeras ? scanKerasZip(buf, cap) : scanH5Buffer(buf);
      const hasConfig = isKeras ? r.config : r.configs > 0;
      if (r.unreadable) unreadable(rel, `${isKeras ? 'keras zip' : 'h5'}: ${r.unreadable}`);
      else if (!hasConfig) { summary.kerasWithoutConfig++; listed(summary.kerasWithoutConfigFiles, rel); }
      if (r.layers.length) add('keras-lambda-layer', rel, lambdaDetail(r.layers, isKeras ? 'config.json' : `${r.configs} model_config attribute(s)`));
      return;
    }
    if (isKerasMeta) {
      summary.filesScanned++; summary.surfaces.kerasConfigs++;
      const r = findConfigBlobs(buf);
      if (r.unreadable) unreadable(rel, `keras metadata: ${r.unreadable}`);
      else if (!r.blobs.length) { summary.kerasWithoutConfig++; listed(summary.kerasWithoutConfigFiles, rel); }
      const layers = r.blobs.flatMap((b) => b.layers);
      if (layers.length) add('keras-lambda-layer', rel, lambdaDetail(layers, `${r.blobs.length} config blob(s) of the SavedModel's Keras metadata`));
      return;
    }
    if (isGraph) {
      summary.filesScanned++; summary.surfaces.tfGraphs++;
      const r = PBTXT_EXT.test(name) ? scanGraphText(buf.toString('utf8')) : scanGraphBuffer(buf);
      if (!r.opsSeen) { summary.tfGraphsWithoutNodes++; listed(summary.tfGraphsWithoutNodesFiles, rel); return; }
      const fileOps = opDetail(r.hits, TF_FILE_OPS);
      const pyOps = opDetail(r.hits, TF_PYTHON_OPS);
      if (fileOps) add('tf-graph-file-op', rel, `filesystem op(s) in the graph: ${fileOps}; ${r.opsSeen} op-shaped string(s) seen — reads or writes a path at inference time`);
      if (pyOps) add('tf-graph-python-op', rel, `python op(s) in the graph: ${pyOps}; ${r.opsSeen} op-shaped string(s) seen — runs arbitrary Python on the loading process`);
      return;
    }
    if (isModel) {
      summary.filesScanned++; summary.surfaces.modelArtefacts++;
      const acc = scanModelBuffer(buf);
      summary.pickleMembersWalked += acc.walked;
      if (acc.dangerous.length) add('pickle-dangerous-global', rel, pickleDetail(acc));
      if (acc.errors.length) unreadable(rel, `${acc.kind}: ${acc.errors[0]}`);
      return;
    }
    const text = buf.toString('utf8');
    if (isJsonSurface) {
      if (!DATASET_JSON_NAMES.has(name) && !JSON_SURFACE_RE.test(text.slice(0, 4096))) return;
      summary.filesScanned++; summary.surfaces.datasetConfigs++;
      const r = scanDatasetJson(text);
      if (r.unreadable) { unreadable(rel, r.unreadable); return; }
      summary.templateInProse += r.hits.templateInProse;
      if (r.hits.template.length) add('dataset-config-template', rel, `${r.hits.template.length} template marker(s) in string values; first at ${r.hits.template[0]}`);
      if (r.hits.remote.length) add('dataset-config-remote-scheme', rel, `${r.hits.remote.length} remote scheme(s) in data path fields; first ${r.hits.remote[0]}`);
      return;
    }
    if (isYaml) {
      const body = YAML_EXT.test(name) ? text : frontMatter(text);
      if (!body || !YAML_SURFACE_RE.test(body)) return;
      summary.filesScanned++; summary.surfaces.datasetConfigs++;
      const r = scanDatasetYaml(body);
      summary.templateInProse += r.hits.templateInProse;
      if (r.hits.template.length) add('dataset-config-template', rel, `${r.hits.template.length} template marker(s) in string values; first at ${r.hits.template[0]}`, firstLine(r.hits.template[0]));
      if (r.hits.remote.length) add('dataset-config-remote-scheme', rel, `${r.hits.remote.length} remote scheme(s) in data path fields; first ${r.hits.remote[0]}`, firstLine(r.hits.remote[0]));
      return;
    }
    if (isPy) {
      summary.filesScanned++; summary.surfaces.python++;
      const r = scanPython(text);
      summary.revisionNonLiteral += r.nonLiteral;
      if (r.trust.length) add('hf-trust-remote-code', rel, `${r.trust.length} occurrence(s) of trust_remote_code=True; first at line ${r.trust[0]}`, r.trust[0]);
      if (r.unpinned.length) add('hf-unpinned-revision', rel, `${r.unpinned.length} hub call(s) without a commit-sha revision; first ${r.unpinned[0]}`, firstLine(r.unpinned[0]));
    }
  };

  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable(relative(root, dir) || '.', `readdir failed: ${e.code || e.message}`); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = join(dir, e.name);
      let st;
      try { st = lstatSync(abs); } catch (err) { unreadable(relative(root, abs), `lstat failed: ${err.code || err.message}`); continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const rel = relative(root, abs).split('\\').join('/');
        if (skipRel.has(rel)) { summary.skippedPaths.push(rel); continue; }
        if (!skipDir(rel)) walk(abs);
        continue;
      }
      if (st.isFile()) file(abs, relative(root, abs).split('\\').join('/'), st.size);
    }
  };
  walk(root);

  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  summary.findings = findings.length;
  if (summary.filesScanned === 0 && summary.unreadable === 0 && summary.skippedOversize === 0) {
    summary.voidReason = 'no model surface — no model artefact, dataset or loader config, or hub-loading source in the tree. '
      + 'The lane runs on every repository because its surface is decided by content, and records this absence as a void, not a clean result';
  }
  return { tool: TOOL, summary, findings };
}

// ── optional second witness ─────────────────────────────────────────────────────────────────────
export function secondWitness(root) {
  const cfg = process.env.CW_MODELSCAN;
  if (cfg === 'off') return { tool: 'modelscan', state: 'off' };
  const bin = cfg || 'modelscan';
  let stdout = ''; let stderr = ''; let status = 0;
  try {
    stdout = execFileSync(bin, ['-p', root, '-r', 'json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, maxBuffer: 64 << 20 });
  } catch (e) {
    if (e.code === 'ENOENT') return { tool: 'modelscan', state: 'absent' };
    if (typeof e.status !== 'number') return { tool: 'modelscan', state: 'failed', why: e.code || 'did not exit' };
    stdout = String(e.stdout || ''); stderr = String(e.stderr || ''); status = e.status;
  }
  const start = stdout.indexOf('{');
  // guard: a witness that printed nothing names its exit and first stderr line — exit 126 under the host sandbox is a denied read of its install, not a verdict
  if (start < 0) return { tool: 'modelscan', state: 'failed', why: `no JSON output (exit ${status})${stderr.trim() ? `: ${stderr.trim().split('\n').pop().slice(0, 160)}` : ''}` };
  let j;
  // fact: modelscan -r json wraps its output at 80 columns INSIDE string literals, so raw newlines sit in strings / every control character becomes a space before the parse, which is a no-op for JSON's own whitespace (expiry: when modelscan stops wrapping, prev: broken)
  try { j = JSON.parse(stdout.slice(start).replace(/[\u0000-\u001f]/g, ' ')); } catch { return { tool: 'modelscan', state: 'failed', why: 'output was not JSON' }; }
  const issues = j && j.summary && typeof j.summary.total_issues === 'number' ? j.summary.total_issues
    : Array.isArray(j && j.issues) ? j.issues.length : null;
  if (issues == null) return { tool: 'modelscan', state: 'failed', why: 'no issue count in output' };
  const errors = Array.isArray(j.errors) ? j.errors.length : 0;
  return { tool: 'modelscan', state: 'ran', issues, ...(errors ? { errors } : {}) };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`model-artefacts: cannot read ${root}: ${e.code || e.message}\n`); process.exit(2); }
  if (!st.isDirectory()) { process.stderr.write(`model-artefacts: ${root} is not a directory\n`); process.exit(2); }
  let report;
  try { report = scanTree(root); } catch (e) { process.stderr.write(`model-artefacts: could not run: ${e.message}\n`); process.exit(2); }
  report.summary.secondWitness = secondWitness(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
