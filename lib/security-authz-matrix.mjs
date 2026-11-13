// Expand a declared actor x resource x operation authorization matrix into sorted default-deny cases; it never calls a target.
import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const MAX_CASES = 100000;
export const MAX_ERRORS = 100;
export const MAX_ID_LENGTH = 128;
export const MAX_PATH_LENGTH = 2048;
export const METHODS = Object.freeze(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
export const ROLES = Object.freeze(['admin', 'user']);
export const VULN_CLASSES = Object.freeze(['bfla', 'bola', 'cross-tenant']);

const EFFECT = new Map([
  ['GET', 'read'], ['HEAD', 'read'], ['OPTIONS', 'read'],
  ['POST', 'write'], ['PUT', 'write'], ['PATCH', 'write'],
  ['DELETE', 'delete'],
]);
const INPUT_FIELDS = Object.freeze(['actors', 'operations', 'permissions', 'resources']);
const OPTION_FIELDS = Object.freeze(['maxCases']);
const KINDS = Object.freeze({
  actors: { fields: Object.freeze(['id', 'role', 'tenant']), optional: [] },
  resources: { fields: Object.freeze(['disposable', 'id', 'owner', 'tenant', 'type']), optional: ['disposable', 'type'] },
  operations: { fields: Object.freeze(['id', 'method', 'path', 'type']), optional: ['type'] },
});
const DEFAULTS = new Map([['disposable', false], ['type', null]]);
const PERMISSION_FIELDS = Object.freeze(['actor', 'operation', 'resource']);
const REFERENCES = [['actor', 'actors'], ['resource', 'resources'], ['operation', 'operations']];
const MISSING = Object.freeze({ status: 'missing' });
const MALFORMED = Object.freeze({ status: 'malformed' });
const TOKEN = /^[A-Za-z0-9._:-]+$/;
const SEGMENT = /^[A-Za-z0-9\-._~!&()*+,=:@]+$/;
const ID_SEGMENT = /^[A-Za-z0-9\-._~!&()*+,=:@]*\{id\}[A-Za-z0-9\-._~!&()*+,=:@]*$/;

// Proxies and module namespaces are refused before any reflection, so no trap runs and no later read can throw.
function isRecord(v) {
  if (v === null || typeof v !== 'object' || types.isProxy(v) || types.isModuleNamespaceObject(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

function isList(v) {
  return !types.isProxy(v) && Array.isArray(v);
}

// Own enumerable data properties only: inherited values, accessors and non-enumerable fields are not evidence, and no getter runs.
function own(obj, key) {
  const d = Object.getOwnPropertyDescriptor(obj, key);
  if (d === undefined) return MISSING;
  if (!Object.hasOwn(d, 'value') || d.enumerable !== true) return MALFORMED;
  if (d.value === undefined || d.value === null) return MISSING;
  return { status: 'ok', value: d.value };
}

function fieldsStatus(obj, allowed) {
  return Reflect.ownKeys(obj).every((k) => allowed.includes(k)) ? 'ok' : 'unknown-field';
}

// A list may hold its length and its indices; any other own key would be a qualifier the generator ignores.
function listKeysStatus(list) {
  return Reflect.ownKeys(list.items).every((k) => k === 'length'
    || (typeof k === 'string' && /^(?:0|[1-9]\d*)$/.test(k) && Number(k) < list.length)) ? 'ok' : 'unknown-field';
}

// A shape rule, not a content filter: a token that passes is still untrusted text.
function isToken(v) {
  return typeof v === 'string' && v.length <= MAX_ID_LENGTH && TOKEN.test(v) && v !== '.' && !v.includes('..');
}

// An allow-list for routes on the declared base: the number of {id} segments, or -1 when any segment falls outside it.
function idSegments(v) {
  if (typeof v !== 'string' || v.length > MAX_PATH_LENGTH || !v.startsWith('/')) return -1;
  let ids = 0;
  for (const s of v.slice(1).split('/')) {
    if (ID_SEGMENT.test(s)) ids += 1;
    else if (!SEGMENT.test(s) || s === '.' || s === '..') return -1;
  }
  return ids;
}

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// Tokens hold no newline, so a newline separator keeps these keys injective.
const tripleKey = (actor, resource, operation) => `${actor}\n${resource}\n${operation}`;
const pairKey = (resource, operation) => `${resource}\n${operation}`;
// Length-prefixed fields: no field's content can shift a boundary, whatever characters it holds.
const encode = (fields) => fields.map((f) => `${f.length}:${f}`).join('');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function errorSink() {
  const list = [];
  let total = 0;
  return {
    add(entry) { total += 1; if (list.length < MAX_ERRORS) list.push(entry); },
    get total() { return total; },
    entries() {
      return total > list.length ? [...list, { field: 'errors', reason: 'more-errors-omitted', count: total - list.length }] : list;
    },
  };
}

function readList(f, label, errs, allowEmpty) {
  if (f.status !== 'ok' || !isList(f.value)) {
    errs.add({ field: label, reason: f.status === 'missing' ? 'missing' : 'malformed' });
    return null;
  }
  const length = f.value.length;
  if (length === 0 && !allowEmpty) { errs.add({ field: label, reason: 'empty' }); return null; }
  return { items: f.value, length };
}

function readOptions(options, errs) {
  if (options === undefined) return MAX_CASES;
  if (!isRecord(options)) { errs.add({ field: 'options', reason: 'malformed' }); return MAX_CASES; }
  const fields = fieldsStatus(options, OPTION_FIELDS);
  if (fields !== 'ok') { errs.add({ field: 'options', reason: fields, allowed: [...OPTION_FIELDS] }); return MAX_CASES; }
  const m = own(options, 'maxCases');
  if (m.status === 'ok' && Number.isInteger(m.value) && m.value >= 1 && m.value <= MAX_CASES) return m.value;
  if (m.status !== 'missing') errs.add({ field: 'options.maxCases', reason: 'malformed' });
  return MAX_CASES;
}

// The reason a present field value is refused, or null when it is valid.
function refusal(name, v) {
  if (name === 'role') return ROLES.includes(v) ? null : 'unsupported-role';
  if (name === 'method') return typeof v === 'string' && EFFECT.has(v) ? null : 'malformed';
  if (name === 'disposable') return typeof v === 'boolean' ? null : 'malformed';
  if (name === 'path') {
    const ids = idSegments(v);
    return ids === 1 ? null : ids === 0 ? 'missing-placeholder' : ids > 1 ? 'extra-placeholder' : 'malformed';
  }
  return isToken(v) ? null : 'malformed';
}

// Each entity's id is registered as soon as the id itself is valid, so duplicates surface in the same pass as other errors.
function readEntities(kind, list, errs) {
  const { fields, optional } = KINDS[kind];
  const byId = new Map();
  for (let i = 0; i < list.length; i++) {
    const at = `${kind}[${i}]`;
    const el = own(list.items, String(i));
    if (el.status !== 'ok' || !isRecord(el.value)) { errs.add({ field: at, reason: el.status === 'missing' ? 'missing' : 'malformed' }); continue; }
    const status = fieldsStatus(el.value, fields);
    if (status !== 'ok') errs.add({ field: at, reason: status, allowed: [...fields] });
    const entity = { index: i };
    for (const name of fields) {
      const f = own(el.value, name);
      if (f.status === 'missing' && optional.includes(name)) { entity[name] = DEFAULTS.get(name); continue; }
      const why = f.status === 'ok' ? refusal(name, f.value) : f.status;
      if (why === null) entity[name] = f.value;
      else errs.add({ field: `${at}.${name}`, reason: why });
    }
    if (entity.id === undefined) continue;
    const first = byId.get(entity.id);
    if (first !== undefined) errs.add({ field: `${at}.id`, reason: 'duplicate-id', first: `${kind}[${first.index}].id` });
    else byId.set(entity.id, entity);
  }
  return byId;
}

// A router may match paths without regard to case, so two operations equal apart from case could be one probe with two expectations.
function checkRequests(operations, errs) {
  const seen = new Map();
  for (const o of operations.values()) {
    if (o.method === undefined || o.path === undefined) continue;
    const key = `${o.method} ${o.path.replace('{id}', '{}').toLowerCase()}`;
    if (seen.has(key)) errs.add({ field: `operations[${o.index}]`, reason: 'duplicate-request', first: `operations[${seen.get(key)}]` });
    else seen.set(key, o.index);
  }
}

function checkOwners(resources, actors, errs) {
  for (const r of resources.values()) {
    if (r.owner === undefined) continue;
    const owner = actors.get(r.owner);
    const at = `resources[${r.index}].owner`;
    if (!owner) errs.add({ field: at, reason: 'unknown-reference' });
    else if (owner.tenant !== undefined && r.tenant !== undefined && owner.tenant !== r.tenant) {
      errs.add({ field: at, reason: 'owner-tenant-mismatch' });
    }
  }
}

function readPermissions(list, maps, errs) {
  const granted = new Map();
  for (let i = 0; i < list.length; i++) {
    const at = `permissions[${i}]`;
    const el = own(list.items, String(i));
    if (el.status !== 'ok' || !isRecord(el.value)) { errs.add({ field: at, reason: el.status === 'missing' ? 'missing' : 'malformed' }); continue; }
    const status = fieldsStatus(el.value, PERMISSION_FIELDS);
    if (status !== 'ok') errs.add({ field: at, reason: status, allowed: [...PERMISSION_FIELDS] });
    const refs = [];
    for (const [name, kind] of REFERENCES) {
      const f = own(el.value, name);
      if (f.status !== 'ok' || !isToken(f.value)) { errs.add({ field: `${at}.${name}`, reason: f.status === 'missing' ? 'missing' : 'malformed' }); continue; }
      const target = maps[kind].get(f.value);
      if (!target) errs.add({ field: `${at}.${name}`, reason: 'unknown-reference' });
      else refs.push(target);
    }
    if (refs.length !== REFERENCES.length) continue;
    const [a, r, o] = refs;
    if (r.type !== undefined && o.type !== undefined && r.type !== o.type) { errs.add({ field: at, reason: 'unpaired-cell' }); continue; }
    const key = tripleKey(a.id, r.id, o.id);
    const first = granted.get(key);
    if (first !== undefined) errs.add({ field: at, reason: 'duplicate-permission', first: `permissions[${first.index}]` });
    else granted.set(key, { index: i, actor: a, resource: r, operation: o });
  }
  return granted;
}

function rejected(errs, reason, limit, size) {
  return { schemaVersion: 1, state: 'rejected', reason, limit, size, operations: null, cases: null, summary: null, errors: errs.entries() };
}

// bola-run's classify() precedence for a leak by a non-owner: bfla (admin owner, user actor), then cross-tenant, then bola.
function vulnClassOf(a, owner, expected) {
  if (expected !== 'deny' || a.id === owner.id) return null;
  if (owner.role === 'admin' && a.role === 'user') return 'bfla';
  return a.tenant !== owner.tenant ? 'cross-tenant' : 'bola';
}

// resourcesWithoutAllow names resources with no positive control: every case generated on them expects deny.
function summarise(cases, resources, counts) {
  const pair = () => ({ allow: 0, deny: 0 });
  const s = {
    ...counts,
    cases: cases.length, allow: 0, deny: 0,
    tenantCrossing: pair(), sameTenantNonOwner: pair(), roleBoundary: pair(), roleEscalation: pair(), functionLevel: pair(),
    vulnClasses: { bfla: 0, bola: 0, 'cross-tenant': 0 },
    effects: { read: pair(), write: pair(), delete: pair() },
    resourcesWithoutAllow: [],
  };
  const allowed = new Set();
  for (const c of cases) {
    s[c.expected] += 1;
    s.effects[c.effect][c.expected] += 1;
    if (c.crossesTenant) s.tenantCrossing[c.expected] += 1;
    else if (!c.ownsResource) s.sameTenantNonOwner[c.expected] += 1;
    if (c.crossesRole) s.roleBoundary[c.expected] += 1;
    if (c.escalatesRole) s.roleEscalation[c.expected] += 1;
    if (c.functionLevel) s.functionLevel[c.expected] += 1;
    if (c.vulnClass !== null) s.vulnClasses[c.vulnClass] += 1;
    if (c.expected === 'allow') allowed.add(c.resource);
  }
  s.resourcesWithoutAllow = resources.filter((r) => !allowed.has(r.id)).map((r) => r.id);
  return s;
}

/**
 * One case per actor x resource x operation whose types match, minus write and delete cells on resources not declared
 * disposable. permissions is the only source of 'allow'; every other case is 'deny'. Roles are 'user' or 'admin'.
 *   ownsResource  the actor is the resource's owner.
 *   crossesTenant the actor's tenant differs from the resource's tenant (always the owner's tenant).
 *   crossesRole   the actor's role differs from the owner's role.
 *   escalatesRole the actor is a user and the owner is an admin.
 *   functionLevel on a deny case, the actor is a user and an admin of the actor's tenant is granted this operation on
 *                 this resource; owner cells included.
 *   vulnClass     on a deny case whose actor is not the owner, the class bola-run's classify() gives a leak there:
 *                 'bfla' (owner admin, actor user), else 'cross-tenant', else 'bola'; null otherwise.
 *   definition    sha256 over what the id does not name: the actor's tenant and role, the resource's tenant, owner,
 *                 owner role, disposability and type (which its operations share), the operation's method and path, and
 *                 the expectation.
 * A typed operation pairs only with resources of its type, and an untyped one only with untyped resources.
 * authz-wire must key stored evidence by target as well as by id and definition.
 * Cases carry declared identifiers verbatim: treat them as untrusted data, never as model instructions.
 * Invalid input is rejected whole: operations, cases and summary are null and errors name positions, never values.
 */
export function expandAuthzMatrix(input, options) {
  const errs = errorSink();
  const limit = readOptions(options, errs);
  if (!isRecord(input)) {
    errs.add({ field: 'input', reason: input === undefined || input === null ? 'missing' : 'malformed' });
    return rejected(errs, 'invalid-input', limit, null);
  }
  const fields = fieldsStatus(input, INPUT_FIELDS);
  if (fields !== 'ok') errs.add({ field: 'input', reason: fields, allowed: [...INPUT_FIELDS] });
  const lists = {};
  for (const key of INPUT_FIELDS) lists[key] = readList(own(input, key), key, errs, key === 'permissions');
  const { actors: la, resources: lr, operations: lo } = lists;
  const size = la && lr && lo ? la.length * lr.length * lo.length : null;
  if (errs.total) return rejected(errs, 'invalid-input', limit, size);
  // Both bounds are decided from lengths alone, so an oversized input is refused before any entry is read.
  if (size > limit) {
    errs.add({ field: 'input', reason: 'matrix-too-large', size, limit });
    return rejected(errs, 'matrix-too-large', limit, size);
  }
  if (lists.permissions.length > limit) {
    errs.add({ field: 'permissions', reason: 'too-many', limit });
    return rejected(errs, 'invalid-input', limit, size);
  }
  for (const key of INPUT_FIELDS) {
    const status = listKeysStatus(lists[key]);
    if (status !== 'ok') errs.add({ field: key, reason: status });
  }

  const maps = { actors: readEntities('actors', la, errs), resources: readEntities('resources', lr, errs), operations: readEntities('operations', lo, errs) };
  checkRequests(maps.operations, errs);
  checkOwners(maps.resources, maps.actors, errs);
  const granted = readPermissions(lists.permissions, maps, errs);
  if (errs.total) return rejected(errs, 'invalid-input', limit, size);

  const adminTenants = new Map();
  for (const g of granted.values()) {
    if (g.actor.role !== 'admin') continue;
    const key = pairKey(g.resource.id, g.operation.id);
    if (!adminTenants.has(key)) adminTenants.set(key, new Set());
    adminTenants.get(key).add(g.actor.tenant);
  }

  const sorted = (m) => [...m.values()].sort((x, y) => compare(x.id, y.id));
  const actors = sorted(maps.actors);
  const resources = sorted(maps.resources);
  const operations = sorted(maps.operations);
  const cases = [];
  const withheld = { notDisposable: 0, typeMismatch: 0 };
  for (const a of actors) {
    for (const r of resources) {
      const owner = maps.actors.get(r.owner);
      for (const o of operations) {
        if (r.type !== o.type) { withheld.typeMismatch += 1; continue; }
        const effect = EFFECT.get(o.method);
        if (effect !== 'read' && !r.disposable) { withheld.notDisposable += 1; continue; }
        const key = tripleKey(a.id, r.id, o.id);
        const expected = granted.has(key) ? 'allow' : 'deny';
        const definition = encode([a.tenant, a.role, r.tenant, r.owner, owner.role, String(r.disposable), r.type ?? '', o.method, o.path, expected]);
        cases.push({
          id: `authz:${sha256(key)}`,
          definition: `sha256:${sha256(definition)}`,
          actor: a.id, actorTenant: a.tenant, actorRole: a.role,
          resource: r.id, resourceTenant: r.tenant, resourceOwner: r.owner, ownerRole: owner.role,
          resourceType: r.type, disposable: r.disposable,
          operation: o.id, effect,
          expected,
          ownsResource: a.id === r.owner,
          crossesTenant: a.tenant !== r.tenant,
          crossesRole: a.role !== owner.role,
          escalatesRole: a.role === 'user' && owner.role === 'admin',
          functionLevel: expected === 'deny' && a.role === 'user' && adminTenants.get(pairKey(r.id, o.id))?.has(a.tenant) === true,
          vulnClass: vulnClassOf(a, owner, expected),
        });
      }
    }
  }
  // Every cell of the declared cross product is a case or a counted withholding; any other total is a defect.
  if (cases.length + withheld.notDisposable + withheld.typeMismatch !== size) {
    errs.add({ field: 'input', reason: 'case-count-mismatch', size, cases: cases.length });
    return rejected(errs, 'invalid-input', limit, size);
  }
  const table = operations.map((o) => ({ id: o.id, method: o.method, path: o.path, type: o.type, effect: EFFECT.get(o.method) }));
  const summary = summarise(cases, resources, {
    actors: actors.length, resources: resources.length, operations: operations.length, permissions: granted.size, withheld,
  });
  return { schemaVersion: 1, state: 'expanded', reason: 'cases-generated', limit, size, operations: table, cases, summary, errors: [] };
}
