// Resolves agent configuration includes and environment indirection into source-attributed declarations, without reading disk.

export const MAX_INCLUDE_DEPTH = 64;
const MAX_NESTING = 32;

const VAR_RE = /\$\{(?:env:)?([A-Za-z_][A-Za-z0-9_]*)[^}]*\}|\$([A-Za-z_][A-Za-z0-9_]*)|%([A-Za-z_][A-Za-z0-9_]*)%/g;
const REMOTE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

const ENFORCEMENT = 'unmeasured';
const ENFORCEMENT_REASON = 'grants and denies are declarations; no enforcement adapter has measured their effect';

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);

const pointerPart = (s) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

function variableNames(s) {
  if (!s.includes('$') && !s.includes('%')) return [];
  const names = new Set();
  for (const m of s.matchAll(VAR_RE)) names.add(m[1] || m[2] || m[3]);
  return names.size < 2 ? [...names] : [...names].sort();
}

function substitute(s, env) {
  return s.replace(VAR_RE, (_, a, b, c) => env.get(a || b || c));
}

export const REDACTED = '[redacted]';
const SECRET_SHAPES = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\bsk_(?:live|test)_[A-Za-z0-9]{8,}|\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bxox[a-z]-[A-Za-z0-9-]{10,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bpypi-[A-Za-z0-9_-]{20,}/g,
  /\bdop_v1_[a-f0-9]{20,}/g,
];
// The credential after an auth scheme, a key header, a secret-named assignment, a URL's userinfo,
// curl's -u, a Slack webhook path or a secret-named query parameter; a bare variable reference there
// is a name, not a secret.
const CREDENTIAL_SLOTS = [
  /(\bAuthorization:\s*(?:(?:Bearer|Basic|Token)\s+)?|\bBearer\s+)([^\s"'`)]+)/gi,
  /(\bX-Api-Key:\s*)([^\s"'`)]+)/gi,
  /(\b[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*)([^\s"'`)]+)/g,
  /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/"'`]+:)([^\s@/"'`]+)(?=@)/gi,
  /(\bcurl\b[^|;&]*?\s(?:-u|--user)(?:\s+|=)[^\s:"'`]+:)([^\s"'`)]+)/g,
  /(\bhooks\.slack\.com\/services\/)([A-Za-z0-9_/-]+)/gi,
  /([?&](?:token|access_token|auth|api_key|apikey|key|secret|sig|signature|password|pwd)=)([^&#\s"'`)]+)/gi,
];
// Every SECRET_SHAPES and CREDENTIAL_SLOTS pattern contains one of these, so a rule without any is left as written.
const REDACTION_MARKERS = /gh[pousr]_|github_pat_|sk_live_|sk_test_|sk-|AKIA|ASIA|xox[a-z]-|npm_|glpat-|AIza|hf_|pypi-|dop_v1_|hooks\.slack\.com|authorization|bearer|x-api-key|=|:\/\/|curl/i;
const WHOLE_REFERENCE = /^(?:\$\{[^}]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%)$/;

/** Replace secret-shaped substrings of a rule with REDACTED; reports whether any were replaced. */
export function redactRule(text) {
  if (!REDACTION_MARKERS.test(text)) return { text, redacted: false };
  let out = text;
  for (const re of SECRET_SHAPES) out = out.replace(re, REDACTED);
  for (const re of CREDENTIAL_SLOTS) {
    out = out.replace(re, (m, prefix, value) => (WHOLE_REFERENCE.test(value) || value === REDACTED ? m : prefix + REDACTED));
  }
  return { text: out, redacted: out !== text };
}

/** Normalise a relative path against a base directory; returns {path} or {kind, reason}. */
function normalizePath(raw, base) {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.includes('\0')) return { kind: 'invalid-path', reason: 'empty or non-text path' };
  if (REMOTE.test(raw)) return { kind: 'traversal', reason: 'remote location outside the configuration tree' };
  const p = raw.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { kind: 'traversal', reason: 'absolute path' };
  if (p.startsWith('~')) return { kind: 'traversal', reason: 'home-relative path' };
  const parts = base ? base.split('/') : [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return { kind: 'traversal', reason: 'escapes the configuration root' };
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  if (!parts.length) return { kind: 'invalid-path', reason: 'resolves to the root directory, not a file' };
  return { path: parts.join('/') };
}

function fileTable(files, issues) {
  let entries;
  if (files instanceof Map) entries = [...files.entries()];
  else if (isPlainObject(files)) entries = Object.entries(files);
  else throw new TypeError('resolveAgentConfig: files must be a map of relative paths to parsed configuration objects');
  const table = new Map();
  const collided = new Set();
  for (const [key, doc] of entries) {
    const norm = normalizePath(key, '');
    if (!norm.path) { issues.push({ kind: norm.kind, source: null, pointer: null, target: String(key), reason: `files key: ${norm.reason}` }); continue; }
    if (collided.has(norm.path)) continue;
    if (table.has(norm.path)) {
      table.delete(norm.path);
      collided.add(norm.path);
      issues.push({ kind: 'malformed', source: norm.path, pointer: null, reason: 'more than one files key names this path; none is used' });
      continue;
    }
    table.set(norm.path, doc);
  }
  return table;
}

// Usable values by name; an empty or non-string value leaves its variable unresolved.
function envTable(env, issues) {
  const values = new Map();
  const empty = new Set();
  if (env === undefined) return { values, empty };
  let entries;
  if (env instanceof Map) entries = [...env.entries()];
  else if (isPlainObject(env)) entries = Object.entries(env);
  else throw new TypeError('resolveAgentConfig: env must be a map of declared variable names to string values');
  for (const [name, value] of entries) {
    const pointer = `/env/${pointerPart(name)}`;
    if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) { issues.push({ kind: 'malformed', source: null, pointer, reason: 'env name is not a variable name' }); continue; }
    if (typeof value !== 'string') { issues.push({ kind: 'malformed', source: null, pointer, reason: 'env value is not a string' }); continue; }
    if (value === '') { empty.add(name); continue; }
    values.set(name, value);
  }
  return { values, empty };
}

function rootList(root, issues) {
  const list = typeof root === 'string' ? [root] : root;
  if (!Array.isArray(list) || !list.length) throw new TypeError('resolveAgentConfig: root must be a relative path or a non-empty array of them');
  const out = [];
  for (const r of list) {
    const norm = normalizePath(r, '');
    if (!norm.path) { issues.push({ kind: norm.kind, source: null, pointer: null, target: String(r), reason: `root: ${norm.reason}` }); continue; }
    if (!out.includes(norm.path)) out.push(norm.path);
  }
  return out;
}

/** Every string leaf of a declaration, or null when it nests beyond MAX_NESTING or refers to itself. */
function stringLeaves(value, depth = 0, seen = new Set(), out = []) {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (value === null || typeof value !== 'object') return out;
  if (depth > MAX_NESTING || seen.has(value)) return null;
  seen.add(value);
  for (const v of Array.isArray(value) ? value : Object.values(value)) {
    if (stringLeaves(v, depth + 1, seen, out) === null) return null;
  }
  seen.delete(value);
  return out;
}

/**
 * Resolve the effective agent configuration reachable from root.
 * files: map of relative path -> parsed config {include, grants, denies, hooks, servers}.
 * env: map of declared variable name -> string value. Values never appear in the result.
 */
export function resolveAgentConfig({ files, env, root } = {}) {
  const unresolved = [];
  const table = fileTable(files, unresolved);
  const { values: declared, empty } = envTable(env, unresolved);
  const roots = rootList(root, unresolved);

  const visited = [];
  const includes = [];
  const grants = [];
  const denies = [];
  const hooks = [];
  const servers = [];
  const referenced = new Set();
  const seen = new Set();
  const stack = [];

  const malformed = (source, pointer, reason) => unresolved.push({ kind: 'malformed', source, pointer, reason });

  // Records undeclared variables of one declaration; returns all its variable names.
  const noteVariables = (names, source, pointer) => {
    for (const n of names) referenced.add(n);
    const missing = names.filter((n) => !declared.has(n));
    if (missing.length) unresolved.push({ kind: 'unresolved-variable', source, pointer, variables: missing, effect: 'value-undetermined' });
    return names;
  };

  const collectRules = (doc, key, source, sink) => {
    if (!Object.hasOwn(doc, key) || doc[key] === undefined) return;
    const list = doc[key];
    if (!Array.isArray(list)) { malformed(source, `/${key}`, 'expected an array of strings'); return; }
    list.forEach((value, i) => {
      const pointer = `/${key}/${i}`;
      if (typeof value !== 'string' || value.trim() === '') { malformed(source, pointer, 'expected a non-empty string'); return; }
      const variables = noteVariables(variableNames(value), source, pointer);
      const { text, redacted } = redactRule(value);
      sink.push({ value: text, redacted, source, pointer, variables, enforcement: ENFORCEMENT });
    });
  };

  const collectHooks = (doc, source) => {
    if (!Object.hasOwn(doc, 'hooks') || doc.hooks === undefined) return;
    if (!Array.isArray(doc.hooks)) { malformed(source, '/hooks', 'expected an array of hook declarations'); return; }
    doc.hooks.forEach((hook, i) => {
      const pointer = `/hooks/${i}`;
      if (!isPlainObject(hook)) { malformed(source, pointer, 'hook is not an object'); return; }
      if (typeof hook.event !== 'string' || hook.event.trim() === '') { malformed(source, pointer, 'hook has no event'); return; }
      if (hook.matcher !== undefined && typeof hook.matcher !== 'string') { malformed(source, pointer, 'hook matcher is not a string'); return; }
      if (hook.type !== undefined && typeof hook.type !== 'string') { malformed(source, pointer, 'hook type is not a string'); return; }
      if ((hook.type === undefined || hook.type === 'command') && (typeof hook.command !== 'string' || hook.command.trim() === '')) {
        malformed(source, pointer, 'command hook has no command'); return;
      }
      const leaves = stringLeaves(hook);
      if (leaves === null) { malformed(source, pointer, 'hook nests too deeply or refers to itself'); return; }
      const variables = noteVariables(variableNames(leaves.join('\n')), source, pointer);
      hooks.push({ event: hook.event, matcher: hook.matcher ?? null, type: hook.type ?? 'command', source, pointer, variables });
    });
  };

  const collectServers = (doc, source) => {
    if (!Object.hasOwn(doc, 'servers') || doc.servers === undefined) return;
    if (!isPlainObject(doc.servers)) { malformed(source, '/servers', 'expected an object of named server declarations'); return; }
    for (const name of Object.keys(doc.servers).sort()) {
      const srv = doc.servers[name];
      const pointer = `/servers/${pointerPart(name)}`;
      if (!isPlainObject(srv)) { malformed(source, pointer, 'server is not an object'); continue; }
      const hasCommand = typeof srv.command === 'string' && srv.command.trim() !== '';
      const hasUrl = typeof srv.url === 'string' && srv.url.trim() !== '';
      if (hasCommand === hasUrl) { malformed(source, pointer, hasCommand ? 'server declares both command and url' : 'server declares neither command nor url'); continue; }
      if (srv.env !== undefined && !isPlainObject(srv.env)) { malformed(source, `${pointer}/env`, 'server env is not an object'); continue; }
      const leaves = stringLeaves(srv);
      if (leaves === null) { malformed(source, pointer, 'server nests too deeply or refers to itself'); continue; }
      const variables = noteVariables(variableNames(leaves.join('\n')), source, pointer);
      servers.push({
        name, source, pointer, transport: hasCommand ? 'stdio' : 'remote',
        envKeys: srv.env ? Object.keys(srv.env).sort() : [], variables, conflict: false,
      });
    }
  };

  const followIncludes = (doc, source, depth) => {
    if (!Object.hasOwn(doc, 'include') || doc.include === undefined) return;
    if (!Array.isArray(doc.include)) { malformed(source, '/include', 'expected an array of paths'); return; }
    doc.include.forEach((raw, i) => {
      const pointer = `/include/${i}`;
      if (typeof raw !== 'string') { malformed(source, pointer, 'include is not a string'); return; }
      const variables = variableNames(raw);
      for (const n of variables) referenced.add(n);
      const missingVars = variables.filter((n) => !declared.has(n));
      if (missingVars.length) {
        unresolved.push({ kind: 'unresolved-variable', source, pointer, variables: missingVars, effect: 'include-not-followed', include: raw });
        return;
      }
      const norm = normalizePath(variables.length ? substitute(raw, declared) : raw, dirOf(source));
      if (!norm.path) { unresolved.push({ kind: norm.kind, source, pointer, include: raw, variables, reason: norm.reason }); return; }
      const target = norm.path;
      // A path built from a variable's value is shown only when it names a supplied file, so a value never leaks.
      if (!table.has(target)) {
        const rec = { kind: 'missing', source, pointer, include: raw, variables, reason: 'included file is not among the supplied files' };
        if (!variables.length) rec.target = target;
        unresolved.push(rec);
        return;
      }
      const at = stack.indexOf(target);
      if (at >= 0) {
        includes.push({ source, pointer, target, variables, state: 'cycle' });
        unresolved.push({ kind: 'cycle', source, pointer, target, chain: [...stack.slice(at), target], reason: 'include chain returns to a file still being resolved' });
        return;
      }
      if (seen.has(target)) { includes.push({ source, pointer, target, variables, state: 'already-visited' }); return; }
      if (depth + 1 > MAX_INCLUDE_DEPTH) {
        includes.push({ source, pointer, target, variables, state: 'depth-limit' });
        unresolved.push({ kind: 'depth-limit', source, pointer, target, reason: `include depth exceeds ${MAX_INCLUDE_DEPTH}` });
        return;
      }
      includes.push({ source, pointer, target, variables, state: 'followed' });
      visit(target, depth + 1);
    });
  };

  function visit(path, depth) {
    seen.add(path);
    visited.push({ path, depth, via: [...stack] });
    stack.push(path);
    const doc = table.get(path);
    if (!isPlainObject(doc)) malformed(path, '', 'configuration is not an object');
    else {
      collectRules(doc, 'grants', path, grants);
      collectRules(doc, 'denies', path, denies);
      collectHooks(doc, path);
      collectServers(doc, path);
      followIncludes(doc, path, depth);
    }
    stack.pop();
  }

  for (const r of roots) {
    if (seen.has(r)) continue;
    if (!table.has(r)) { unresolved.push({ kind: 'missing', source: null, pointer: null, target: r, reason: 'root configuration is not among the supplied files' }); continue; }
    visit(r, 0);
  }

  const byName = new Map();
  for (const s of servers) byName.set(s.name, [...(byName.get(s.name) || []), s]);
  for (const name of [...byName.keys()].sort()) {
    const decls = byName.get(name);
    if (decls.length < 2) continue;
    for (const d of decls) d.conflict = true;
    unresolved.push({ kind: 'server-conflict', name, sources: decls.map((d) => d.source), reason: 'server declared in more than one file; no precedence is assumed' });
  }

  return {
    schemaVersion: 1,
    roots,
    state: unresolved.length ? 'incomplete' : 'complete',
    enforcement: { state: ENFORCEMENT, reason: ENFORCEMENT_REASON },
    files: visited,
    unreachedFiles: [...table.keys()].filter((p) => !seen.has(p)).sort(),
    includes,
    grants,
    denies,
    hooks,
    servers,
    variables: [...referenced].sort().map((name) => ({ name, declared: declared.has(name), empty: empty.has(name) })),
    unresolved,
  };
}
