/**
 * @param {{ before: { subjects: Array<{ id: string, kind: string, value: any, measured: boolean }> }, after: { subjects: Array<{ id: string, kind: string, value: any, measured: boolean }> } }} input
 * @returns {{ transitions: Array<{ kind: string, id: string, change: string|string[], before: any, after: any, reviewCandidate: boolean }>, added: Array<{ kind: string, id: string, measured: boolean }>, removed: Array<{ kind: string, id: string, measured: boolean }>, unknown: Array<{ kind: string, id: string, reason: string }> }}
 */
export function securityDrift({ before, after }) {
  // Validate top-level structure
  if (!before || typeof before !== 'object' || !Array.isArray(before.subjects)) {
    throw new TypeError('before.subjects must be an array');
  }
  if (!after || typeof after !== 'object' || !Array.isArray(after.subjects)) {
    throw new TypeError('after.subjects must be an array');
  }

  const KINDS = new Set(['dependency-origin', 'workflow-permissions', 'agent-grant', 'suppression']);

  // Helper to validate a subject and return its composite key
  function validateSubject(subject, snapshotName) {
    if (!subject || typeof subject !== 'object') {
      throw new TypeError(snapshotName + ' subject must be an object');
    }
    const { id, kind, value, measured } = subject;
    if (typeof id !== 'string' || id === '') {
      throw new TypeError(snapshotName + ' subject id must be a non-empty string');
    }
    if (typeof kind !== 'string' || !KINDS.has(kind)) {
      throw new TypeError(snapshotName + ' subject kind must be one of: dependency-origin, workflow-permissions, agent-grant, suppression');
    }
    if (typeof measured !== 'boolean') {
      throw new TypeError(snapshotName + ' subject measured must be a boolean');
    }
    if (measured) {
      validateValue(kind, value, snapshotName);
    }
    return JSON.stringify([kind, id]);
  }

  // Validate value shape per kind when measured
  function validateValue(kind, value, snapshotName) {
    if (!value || typeof value !== 'object') {
      throw new TypeError(snapshotName + ' subject value must be an object when measured');
    }
    switch (kind) {
      case 'dependency-origin': {
        if (typeof value.source !== 'string' || !['registry', 'git', 'archive', 'path'].includes(value.source)) {
          throw new TypeError(snapshotName + ' dependency-origin value.source must be one of: registry, git, archive, path');
        }
        break;
      }
      case 'workflow-permissions': {
        if (!value.scopes || typeof value.scopes !== 'object') {
          throw new TypeError(snapshotName + ' workflow-permissions value.scopes must be an object');
        }
        for (const [scope, level] of Object.entries(value.scopes)) {
          if (typeof scope !== 'string' || scope === '') {
            throw new TypeError(snapshotName + ' workflow-permissions scope name must be a non-empty string');
          }
          if (!['none', 'read', 'write'].includes(level)) {
            throw new TypeError(snapshotName + ' workflow-permissions scope level must be none, read, or write');
          }
        }
        break;
      }
      case 'agent-grant': {
        if (!Array.isArray(value.tools)) {
          throw new TypeError(snapshotName + ' agent-grant value.tools must be an array');
        }
        for (const tool of value.tools) {
          if (typeof tool !== 'string' || tool === '') {
            throw new TypeError(snapshotName + ' agent-grant tool must be a non-empty string');
          }
        }
        break;
      }
      case 'suppression': {
        if (typeof value.reason !== 'string' || value.reason === '') {
          throw new TypeError(snapshotName + ' suppression value.reason must be a non-empty string');
        }
        if (value.expiresAt !== null) {
          if (typeof value.expiresAt !== 'string') {
            throw new TypeError(snapshotName + ' suppression value.expiresAt must be a string or null');
          }
          if (!isValidTimestamp(value.expiresAt)) {
            throw new TypeError(snapshotName + ' suppression value.expiresAt must be a valid ISO-8601 instant with explicit zone');
          }
        }
        break;
      }
    }
  }

  // Timestamp validation: ISO-8601 with explicit zone (Z or +hh:mm) and real calendar day
  function isValidTimestamp(str) {
    // Regex for ISO-8601 with explicit zone: YYYY-MM-DDTHH:mm:ss.sssZ or +-hh:mm
    const regex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;
    const match = str.match(regex);
    if (!match) return false;
    const [, year, month, day, hour, minute, second, ms] = match;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10) - 1; // 0-indexed
    const d = parseInt(day, 10);
    const h = parseInt(hour, 10);
    const min = parseInt(minute, 10);
    const s = parseInt(second, 10);
    const msVal = ms ? parseInt(ms.padEnd(3, '0').slice(0, 3), 10) : 0;
    // Use Date.UTC to check for rollover
    const utc = Date.UTC(y, m, d, h, min, s, msVal);
    const date = new Date(utc);
    // Verify components match (no rollover)
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m || date.getUTCDate() !== d ||
        date.getUTCHours() !== h || date.getUTCMinutes() !== min || date.getUTCSeconds() !== s ||
        date.getUTCMilliseconds() !== msVal) {
      return false;
    }
    // Zone is already validated by regex
    return true;
  }

  // Build maps for before and after
  const beforeMap = new Map();
  const afterMap = new Map();
  const beforeKeys = new Set();
  const afterKeys = new Set();

  // Process before subjects
  for (const subject of before.subjects) {
    const key = validateSubject(subject, 'before');
    if (beforeKeys.has(key)) {
      throw new Error('Duplicate identity in before: ' + key);
    }
    beforeKeys.add(key);
    beforeMap.set(key, subject);
  }

  // Process after subjects
  for (const subject of after.subjects) {
    const key = validateSubject(subject, 'after');
    if (afterKeys.has(key)) {
      throw new Error('Duplicate identity in after: ' + key);
    }
    afterKeys.add(key);
    afterMap.set(key, subject);
  }

  // Prepare result arrays
  const transitions = [];
  const added = [];
  const removed = [];
  const unknown = [];

  // All identities
  const allKeys = new Set([...beforeKeys, ...afterKeys]);

  for (const key of allKeys) {
    const beforeSub = beforeMap.get(key);
    const afterSub = afterMap.get(key);
    const [kind, id] = JSON.parse(key);

    if (beforeSub && afterSub) {
      // Present in both
      if (beforeSub.measured && afterSub.measured) {
        // Both measured: compare values
        if (!valuesEqual(kind, beforeSub.value, afterSub.value)) {
          const transition = computeTransition(kind, id, beforeSub.value, afterSub.value);
          transitions.push(transition);
        }
        // else equal -> ignore
      } else {
        // At least one unmeasured
        if (!beforeSub.measured) {
          unknown.push({ kind, id, reason: 'unmeasured-before' });
        }
        if (!afterSub.measured) {
          unknown.push({ kind, id, reason: 'unmeasured-after' });
        }
      }
    } else if (beforeSub) {
      // Only in before
      removed.push({ kind, id, measured: beforeSub.measured });
    } else {
      // Only in after
      added.push({ kind, id, measured: afterSub.measured });
    }
  }

  // Sort each array by kind then id (using string comparison)
  const sortByKindId = (a, b) => {
    if (a.kind < b.kind) return -1;
    if (a.kind > b.kind) return 1;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  };

  transitions.sort(sortByKindId);
  added.sort(sortByKindId);
  removed.sort(sortByKindId);
  unknown.sort(sortByKindId);

  return { transitions, added, removed, unknown };
}

const LEVEL = { none: 0, read: 1, write: 2 };
// An absent scope grants nothing, so it reads as none; own keys only, so a scope named
// constructor never resolves to Object.prototype.
const levelOf = (scopes, scope) => (Object.hasOwn(scopes, scope) ? scopes[scope] : 'none');
// One instant can be written in several zones, so expiries compare as instants, never as strings.
const instantOf = (expiresAt) => (expiresAt === null ? null : Date.parse(expiresAt));

function valuesEqual(kind, a, b) {
  switch (kind) {
    case 'dependency-origin':
      return a.source === b.source;
    case 'workflow-permissions':
      return scopesEqual(a.scopes, b.scopes);
    case 'agent-grant':
      return toolsEqual(a.tools, b.tools);
    case 'suppression':
      return a.reason === b.reason && instantOf(a.expiresAt) === instantOf(b.expiresAt);
  }
  return false;
}

function scopesEqual(a, b) {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (levelOf(a, k) !== levelOf(b, k)) return false;
  }
  return true;
}

function toolsEqual(a, b) {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((t) => y.has(t));
}

// Compute transition for a kind
function computeTransition(kind, id, beforeVal, afterVal) {
  switch (kind) {
    case 'dependency-origin': {
      const change = beforeVal.source === 'registry' && ['git', 'archive', 'path'].includes(afterVal.source)
        ? 'left-registry'
        : 'origin-changed';
      const reviewCandidate = change === 'left-registry';
      return { kind, id, change, before: beforeVal, after: afterVal, reviewCandidate };
    }
    case 'workflow-permissions': {
      const widened = isWidened(beforeVal.scopes, afterVal.scopes);
      const change = widened ? 'widened' : 'narrowed';
      const reviewCandidate = widened;
      return { kind, id, change, before: beforeVal, after: afterVal, reviewCandidate };
    }
    case 'agent-grant': {
      const broadened = isBroadened(beforeVal.tools, afterVal.tools);
      const change = broadened ? 'broadened' : 'narrowed';
      const reviewCandidate = broadened;
      return { kind, id, change, before: beforeVal, after: afterVal, reviewCandidate };
    }
    case 'suppression': {
      const changes = [];
      let reviewCandidate = false;
      // reason-changed
      if (beforeVal.reason !== afterVal.reason) {
        changes.push('reason-changed');
      }
      const beforeExp = instantOf(beforeVal.expiresAt);
      const afterExp = instantOf(afterVal.expiresAt);
      if (beforeExp === null && afterExp !== null) {
        changes.push('expiry-added');
      } else if (beforeExp !== null && afterExp === null) {
        changes.push('expiry-removed');
        reviewCandidate = true;
      } else if (beforeExp !== null && afterExp !== null) {
        if (afterExp > beforeExp) {
          changes.push('expiry-extended');
          reviewCandidate = true;
        } else if (afterExp < beforeExp) {
          changes.push('expiry-shortened');
        }
      }
      // If no changes? Should not happen because valuesEqual would have caught equality.
      return { kind, id, change: changes, before: beforeVal, after: afterVal, reviewCandidate };
    }
  }
}

function isWidened(beforeScopes, afterScopes) {
  for (const scope of new Set([...Object.keys(beforeScopes), ...Object.keys(afterScopes)])) {
    if (LEVEL[levelOf(afterScopes, scope)] > LEVEL[levelOf(beforeScopes, scope)]) return true;
  }
  return false;
}

function isBroadened(beforeTools, afterTools) {
  // If after has '*' and before didn't, broadened
  if (afterTools.includes('*') && !beforeTools.includes('*')) {
    return true;
  }
  // If before has '*', after cannot be broader (since * means all tools)
  if (beforeTools.includes('*')) {
    return false;
  }
  // Check if any tool in after is not in before
  const beforeSet = new Set(beforeTools);
  for (const tool of afterTools) {
    if (!beforeSet.has(tool)) {
      return true;
    }
  }
  return false;
}
