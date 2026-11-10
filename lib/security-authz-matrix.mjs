// lib/security-authz-matrix.mjs — every actor × resource × operation case from an explicit
// allowlist, default deny. Generates cases only; it never calls a live target.

const byCodePoint = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const tupleKey = (...parts) => JSON.stringify(parts);

function indexById(list, name, fields) {
  if (!Array.isArray(list)) throw new TypeError(`${name} must be an array`);
  const byId = new Map();
  for (const [i, item] of list.entries()) {
    if (!item || typeof item !== 'object') throw new TypeError(`${name}[${i}] must be an object`);
    for (const f of ['id', ...fields]) {
      if (typeof item[f] !== 'string' || item[f] === '') throw new TypeError(`${name}[${i}].${f} must be a non-empty string`);
    }
    if (byId.has(item.id)) throw new Error(`duplicate ${name} id: ${item.id}`);
    byId.set(item.id, item);
  }
  return byId;
}

export function expandAuthzMatrix({ actors, resources, operations, permissions } = {}) {
  const actorById = indexById(actors, 'actors', ['tenant', 'role']);
  const resourceById = indexById(resources, 'resources', ['tenant', 'owner']);
  const operationById = indexById(operations, 'operations', ['method', 'path']);
  if (!Array.isArray(permissions)) throw new TypeError('permissions must be an array');

  const allowed = new Set();
  for (const [i, p] of permissions.entries()) {
    if (!p || typeof p !== 'object') throw new TypeError(`permissions[${i}] must be an object`);
    if (!actorById.has(p.actor)) throw new Error(`permissions[${i}] references unknown actor: ${p.actor}`);
    if (!resourceById.has(p.resource)) throw new Error(`permissions[${i}] references unknown resource: ${p.resource}`);
    if (!operationById.has(p.operation)) throw new Error(`permissions[${i}] references unknown operation: ${p.operation}`);
    const key = tupleKey(p.actor, p.resource, p.operation);
    if (allowed.has(key)) throw new Error(`duplicate permission: ${key}`);
    allowed.add(key);
  }

  const cases = [];
  for (const actor of actorById.values()) {
    for (const resource of resourceById.values()) {
      for (const operation of operationById.values()) {
        const id = tupleKey(actor.id, resource.id, operation.id);
        cases.push({
          id,
          actor: actor.id,
          resource: resource.id,
          operation: operation.id,
          method: operation.method,
          path: operation.path,
          role: actor.role,
          sameTenant: actor.tenant === resource.tenant,
          owner: resource.owner === actor.id,
          expected: allowed.has(id) ? 'allow' : 'deny',
        });
      }
    }
  }
  return cases.sort((a, b) => byCodePoint(a.id, b.id));
}
