// Evaluate a scanner command's declared execution boundary against its measured containment effects.
import { createHash } from 'node:crypto';

export const NETWORK_MODES = Object.freeze(['none', 'restricted', 'open']);

// Mirrors FORBIDDEN_SEGMENTS in bin/lib/sandbox.mjs; the test suite fails if that list grows past this one.
export const FORBIDDEN_CREDENTIAL_SEGMENTS = Object.freeze(['.ssh', '.aws', '.gnupg', '.docker', '.kube', 'Keychains', '.netrc']);

const FORBIDDEN_SEGMENTS_LC = FORBIDDEN_CREDENTIAL_SEGMENTS.map((s) => s.toLowerCase());
const CREDENTIAL_LOCATIONS = ['/library/keychains', '~/library/keychains'];
const HOME_DIRECTORY = /^(?:\/root|\/var\/root|\/home(?:\/[^/]+)?|\/users(?:\/[^/]+)?|[a-z]:\/users(?:\/[^/]+)?)$/;
const HOST_EQUIVALENT = ['/var/run/docker.sock', '/run/docker.sock', '/etc', '/dev', '/proc', '/sys'];
const EFFECTS = [
  { control: 'credential-read', key: 'credentialReadDenied', violation: 'credential-read' },
  { control: 'egress', key: 'egressDenied', violation: 'egress-not-denied' },
  { control: 'write-escape', key: 'writeEscapeDenied', violation: 'write-escape' },
];
const MAX_PATH = 4096;
const MAX_ENTRIES = 1024;
const MAX_COMMAND = 65536;
// Scanner programs named in manifests/security-baseline.map.json (tools) and bin/lib/sandbox.mjs (lanes);
// generic interpreters, toolchains and package managers are left out because their name says nothing.
export const SCANNER_LABELS = Object.freeze([
  'actionlint', 'bandit', 'bearer', 'betterleaks', 'brakeman', 'bundle-audit', 'cargo-audit', 'cargo-clippy',
  'cdxgen', 'cobolwork', 'codeql', 'cppcheck', 'depscan', 'flawfinder', 'gitleaks', 'golangci-lint', 'gosec',
  'govulncheck', 'guarddog', 'hadolint', 'hlint', 'joern-scan', 'nuclei', 'opengrep', 'osv-scanner', 'phpcs',
  'pmd', 'prowler', 'psalm', 'ruff', 'schemathesis', 'scorecard', 'semgrep', 'shellcheck', 'sobelow', 'socket',
  'syft', 'trivy', 'trufflehog', 'zizmor',
]);
const MALFORMED = Symbol('malformed');

const isRecord = (v) => v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Object]';
const within = (p, root) => p === root || p.startsWith(`${root}/`);
const byKeys = (...keys) => (a, b) => {
  for (const k of keys) {
    const x = String(a[k] ?? ''); const y = String(b[k] ?? '');
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
};

// Own data properties only: an inherited value or a getter is not evidence, and a getter is never invoked.
function own(obj, key) {
  let d;
  try { d = Object.getOwnPropertyDescriptor(obj, key); } catch { return { status: 'malformed' }; }
  if (!d) return { status: 'missing' };
  if (!('value' in d)) return { status: 'malformed' };
  if (d.value === undefined || d.value === null) return { status: 'missing' };
  return { status: 'ok', value: d.value };
}

function arrayLength(v) {
  if (!Array.isArray(v)) return -1;
  const n = own(v, 'length');
  return n.status === 'ok' && Number.isInteger(n.value) ? n.value : -1;
}

function normPath(raw, allowRelative) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PATH) return null;
  if (/[\x00-\x1f\x7f]/.test(raw)) return null;
  let s = raw.replace(/\\/g, '/');
  if (s.startsWith('//')) return null;
  let head;
  const drive = /^([A-Za-z]:)\//.exec(s);
  if (s.startsWith('/')) { head = '/'; s = s.slice(1); }
  else if (drive) { head = `${drive[1]}/`; s = s.slice(3); }
  else if (s === '~' || s.startsWith('~/')) { head = '~'; s = s.slice(1); }
  else if (allowRelative && !s.startsWith('~')) head = '';
  else return null;
  const segs = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..' || /[:=]/.test(seg)) return null;
    segs.push(seg);
  }
  if (head === '') return segs.length ? segs.join('/') : null;
  if (head === '~') return segs.length ? `~/${segs.join('/')}` : '~';
  return head + segs.join('/');
}

function forbiddenReason(path) {
  const l = path.toLowerCase();
  const segs = l.split('/').filter(Boolean);
  if (l === '/' || /^[a-z]:\/$/.test(l)) return 'filesystem-root';
  if (segs.some((s) => FORBIDDEN_SEGMENTS_LC.includes(s))) return 'credential-material';
  if (l === '~' || HOME_DIRECTORY.test(l)) return 'home-directory';
  if (CREDENTIAL_LOCATIONS.some((c) => within(l, c) || within(c, l))) return 'credential-material';
  if (segs.at(-1) === 'docker.sock') return 'host-equivalent';
  if (HOST_EQUIVALENT.some((h) => within(l, h) || within(h, l))) return 'host-equivalent';
  return null;
}

function readCommand(raw, unknowns) {
  let text; let label = null;
  if (raw === undefined || raw === null) {
    unknowns.push({ field: 'command', reason: 'missing' });
    return null;
  }
  if (typeof raw === 'string' && raw.trim() !== '' && raw.length <= MAX_COMMAND && !raw.includes('\0')) {
    text = raw;
  } else if (arrayLength(raw) > 0 && arrayLength(raw) <= MAX_ENTRIES) {
    const argv = [];
    for (let i = 0; i < arrayLength(raw); i++) {
      const a = own(raw, String(i));
      if (a.status !== 'ok' || typeof a.value !== 'string' || a.value.includes('\0')) {
        unknowns.push({ field: 'command', reason: 'malformed' });
        return null;
      }
      argv.push(a.value);
    }
    if (argv[0] === '' || JSON.stringify(argv).length > MAX_COMMAND) {
      unknowns.push({ field: 'command', reason: 'malformed' });
      return null;
    }
    text = JSON.stringify(argv);
    const base = argv[0].replace(/\\/g, '/').split('/').pop().replace(/\.(?:exe|cmd)$/i, '');
    if (SCANNER_LABELS.includes(base)) label = base;
  } else {
    unknowns.push({ field: 'command', reason: 'malformed' });
    return null;
  }
  // The raw command can carry tokens or instructions, so the report holds only a known scanner name and a digest.
  return {
    label,
    digest: `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`,
  };
}

function readBool(obj, key, prefix, unknowns) {
  const f = own(obj, key);
  if (f.status === 'ok' && typeof f.value === 'boolean') return f.value;
  unknowns.push({ field: `${prefix}.${key}`, reason: f.status === 'missing' ? 'missing' : 'malformed' });
  return null;
}

function readPaths(obj, key, allowRelative, unknowns, violations) {
  const field = `declared.${key}`;
  const f = own(obj, key);
  if (f.status === 'missing') { unknowns.push({ field, reason: 'missing' }); return null; }
  const length = f.status === 'ok' ? arrayLength(f.value) : -1;
  if (length < 0 || length > MAX_ENTRIES) {
    unknowns.push({ field, reason: 'malformed' });
    return null;
  }
  const paths = new Set();
  let complete = true;
  for (let i = 0; i < length; i++) {
    const entry = own(f.value, String(i));
    const p = entry.status === 'ok' ? normPath(entry.value, allowRelative) : null;
    if (p === null) {
      complete = false;
      unknowns.push({ field: `${field}[${i}]`, reason: 'malformed' });
      continue;
    }
    paths.add(p);
    const reason = forbiddenReason(p);
    if (reason) violations.push({ kind: 'forbidden-credential-mount', source: 'declared', field, path: p, reason });
  }
  return complete ? [...paths].sort() : null;
}

function readDeclared(raw, unknowns, violations) {
  const out = { executesRepoCode: null, network: null, readRoots: null, writeRoots: null, credentialsMounted: null };
  if (raw === undefined || raw === null) { unknowns.push({ field: 'declared', reason: 'missing' }); return out; }
  if (!isRecord(raw)) { unknowns.push({ field: 'declared', reason: 'malformed' }); return out; }
  out.executesRepoCode = readBool(raw, 'executesRepoCode', 'declared', unknowns);
  const n = own(raw, 'network');
  if (n.status === 'ok' && NETWORK_MODES.includes(n.value)) out.network = n.value;
  else unknowns.push({ field: 'declared.network', reason: n.status === 'missing' ? 'missing' : 'malformed' });
  out.readRoots = readPaths(raw, 'readRoots', false, unknowns, violations);
  out.writeRoots = readPaths(raw, 'writeRoots', false, unknowns, violations);
  const cm = own(raw, 'credentialsMounted');
  if (cm.status === 'ok' && typeof cm.value === 'boolean') {
    // true names no paths, so nothing bounds which credentials the command can read.
    out.credentialsMounted = cm.value ? true : [];
    if (cm.value) {
      violations.push({ kind: 'forbidden-credential-mount', source: 'declared', field: 'declared.credentialsMounted', reason: 'unspecified-credentials' });
    }
  } else {
    out.credentialsMounted = readPaths(raw, 'credentialsMounted', true, unknowns, violations);
  }
  if (out.executesRepoCode === true && out.network === 'open') {
    violations.push({ kind: 'repo-code-with-open-egress', source: 'declared', field: 'declared.network' });
  }
  return out;
}

// Effects count only from a run that is itself evidenced; a claimed effect without one is kept as a claim.
function readMeasured(raw, egressRequired, unknowns) {
  const out = { ran: null, egressDenied: null, writeEscapeDenied: null, credentialReadDenied: null };
  if (raw === undefined || raw === null || !isRecord(raw)) {
    unknowns.push({ field: 'measured', reason: raw === undefined || raw === null ? 'missing' : 'malformed' });
    return out;
  }
  const ran = own(raw, 'ran');
  const ranOk = ran.status === 'ok' && typeof ran.value === 'boolean';
  if (ranOk) out.ran = ran.value;
  else unknowns.push({ field: 'measured.ran', reason: ran.status === 'missing' ? 'missing' : 'malformed' });
  for (const { key } of EFFECTS) {
    const required = key === 'egressDenied' ? egressRequired !== false : true;
    const f = own(raw, key);
    const field = `measured.${key}`;
    if (f.status === 'malformed' || (f.status === 'ok' && typeof f.value !== 'boolean')) {
      unknowns.push({ field, reason: 'malformed' });
    } else if (f.status === 'missing') {
      if (required) unknowns.push({ field, reason: 'missing' });
    } else if (out.ran === true) {
      out[key] = f.value;
    } else if (required) {
      unknowns.push({ field, reason: out.ran === false ? 'not-run' : 'run-unevidenced', claimed: f.value });
    }
  }
  return out;
}

/**
 * @param {{command?: string|string[], declared?: object, measured?: object}} input
 * @returns {{schemaVersion: 1, command: {label: string|null, digest: string}|null,
 *   state: 'pass'|'finding'|'unmeasured', reason: string, declarationRejected: boolean,
 *   declared: object, measured: object, controls: object[], violations: object[], unknowns: object[]}}
 */
export function evaluateBoundary(input) {
  const unknowns = [];
  const violations = [];
  const arg = isRecord(input) ? input : {};
  if (!isRecord(input)) unknowns.push({ field: 'input', reason: input === undefined || input === null ? 'missing' : 'malformed' });
  const field = (k) => { const f = own(arg, k); return f.status === 'ok' ? f.value : f.status === 'malformed' ? MALFORMED : undefined; };

  const command = readCommand(field('command'), unknowns);
  const declared = readDeclared(field('declared'), unknowns, violations);
  const egressRequired = declared.network === null ? null : declared.network !== 'open';
  const measured = readMeasured(field('measured'), egressRequired, unknowns);

  const controls = EFFECTS.map(({ control, key, violation }) => {
    const required = key === 'egressDenied' ? egressRequired : true;
    const value = measured[key];
    const outcome = value === true ? 'denied' : value === false ? 'not-denied' : 'unknown';
    if (value === false && required === true) {
      violations.push({ kind: violation, source: 'measured', field: `measured.${key}` });
    } else if (value === false && required === null) {
      unknowns.push({ field: `control.${control}`, reason: 'not-evaluable' });
    }
    return { control, field: `measured.${key}`, required, outcome };
  });

  violations.sort(byKeys('kind', 'field', 'path'));
  unknowns.sort(byKeys('field', 'reason'));
  const state = violations.length ? 'finding' : unknowns.length ? 'unmeasured' : 'pass';
  return {
    schemaVersion: 1,
    command,
    state,
    reason: state === 'finding' ? 'violations-found' : state === 'unmeasured' ? 'evidence-incomplete' : 'required-controls-held',
    declarationRejected: violations.some((v) => v.kind === 'forbidden-credential-mount'),
    declared,
    measured,
    controls,
    violations,
    unknowns,
  };
}
