// One patch.diff carrying every verified remediation fix, so a run can ship `git apply --check`-
// clean text next to the SARIF that code scanning ignores fixes[] in. A library: file text arrives
// through readText, and nothing here opens a file, reads the clock or spawns a process.

import { validateRemediation, chosenCandidate } from './remediation-contract.mjs';
import { unifiedDiff, parseUnifiedDiff, applyUnifiedDiff } from './unified-diff.mjs';

const cmpStr = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const byIdentityThenOccurrence = (a, b) => cmpStr(a.identity, b.identity)
  || (Number(a.occurrence) || 0) - (Number(b.occurrence) || 0);

const NO_PATCH = 'the candidate carries no patch';

/** The path a file entry names: a creation has no old side, a deletion no new side. */
const filePath = (f) => (f.oldPath === null ? f.newPath : f.oldPath);

const kindOf = (f) => (f.oldPath === null ? 'created' : f.newPath === null ? 'deleted' : 'edited');

// A rename would have to carry two paths through one entry, which unifiedDiff does not write; a
// creation and a deletion it does.
function unwritableReason(files) {
  for (const f of files) {
    if (f.oldPath !== null && f.newPath !== null && f.oldPath !== f.newPath) return 'the patch renames a file';
  }
  return null;
}

// A creation, a deletion and an edit each decide a path's whole content. Two of those on one path
// cannot both be honoured; edits of one existing file still stack on each other.
function conflictWith(files, kinds) {
  for (const f of files) {
    const path = filePath(f);
    const prior = kinds.get(path);
    if (prior === undefined) continue;
    if (f.oldPath !== null && f.newPath !== null && prior === 'edited') continue;
    return { path, prior };
  }
  return null;
}

function conflictReason({ path, prior }) {
  const verb = prior === 'created' ? 'creates' : prior === 'deleted' ? 'deletes' : 'changes';
  return `the patch conflicts with an earlier fix that ${verb} ${path}`;
}

// A candidate's patch is untrusted text (the llm tier writes one), and its paths reach readText and
// then `git apply`: neither may be steered out of the working tree or into git's own directory.
function escapingPath(files) {
  for (const f of files) {
    const path = filePath(f);
    // A header with /dev/null on both sides names no path; applyUnifiedDiff rejects it later.
    if (path === null) continue;
    const segments = path.split('/');
    if (path === '' || path.startsWith('/') || path.includes('\\') || path.includes('\0')
      || segments.some((s) => s === '..' || s.toLowerCase() === '.git')) return path;
  }
  return null;
}

function invalidDocumentError(errors) {
  const shown = errors.slice(0, 3).join('; ');
  return new Error(`remediation-patch: invalid document: ${shown}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}`);
}

/**
 * `{ patch, included, excluded }` for a commitwork.remediation/1 document. Only a finding's chosen
 * verified candidate is applied; findings are walked by identity then occurrence, and each candidate
 * lands for all of its files or for none. A candidate whose patch is byte-equal to one already
 * included is listed with `samePatchAs` instead of being applied twice. A path one candidate creates
 * or deletes is settled: a later candidate on it is excluded rather than merged. Each fix was
 * verified alone: the combination is unverified until the caller re-runs its lanes over the patched
 * tree.
 */
export function combinedPatch(doc, readText) {
  const { errors } = validateRemediation(doc);
  if (errors.length) throw invalidDocumentError(errors);

  // One entry per path: the text first read — null for a path a candidate creates — and the text as
  // committed fixes leave it — null for a path one deletes.
  const texts = new Map();
  const textFor = (path) => {
    let entry = texts.get(path);
    if (!entry) {
      const original = readText(path);
      entry = { original, working: original };
      texts.set(path, entry);
    }
    return entry;
  };
  // git refuses a whole patch file over one creation of an existing path, so that candidate is left out.
  const isPresent = (path) => {
    if (texts.has(path)) return true;
    try {
      readText(path);
      return true;
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      return false;
    }
  };

  const included = [];
  const excluded = [];
  const owners = new Map(); // patch text -> what the first inclusion of it touched
  const touched = new Set();
  const kinds = new Map(); // path -> what the first included candidate did to it

  for (const finding of [...doc.findings].sort(byIdentityThenOccurrence)) {
    const candidate = chosenCandidate(finding);
    if (!candidate) continue;
    const entry = { identity: finding.identity, occurrence: finding.occurrence, candidateId: candidate.id };
    const patch = candidate.patch;
    if (typeof patch !== 'string' || patch === '') { excluded.push({ ...entry, reason: NO_PATCH }); continue; }
    const files = parseUnifiedDiff(patch);
    if (!files.length) { excluded.push({ ...entry, reason: NO_PATCH }); continue; }
    const unwritable = unwritableReason(files);
    if (unwritable) { excluded.push({ ...entry, reason: unwritable }); continue; }
    const escaping = escapingPath(files);
    if (escaping !== null) { excluded.push({ ...entry, reason: `the patch names a path outside the repository: ${escaping}` }); continue; }
    if (!files.some((f) => f.hunks.length || f.oldPath === null || f.newPath === null)) { excluded.push({ ...entry, reason: NO_PATCH }); continue; }
    const owner = owners.get(patch);
    if (owner) {
      included.push({ ...entry, files: [...owner.files], samePatchAs: { identity: owner.identity, occurrence: owner.occurrence } });
      continue;
    }
    const conflict = conflictWith(files, kinds);
    if (conflict) { excluded.push({ ...entry, reason: conflictReason(conflict) }); continue; }

    const paths = [...new Set(files.map(filePath))].sort(cmpStr);
    const created = new Set(files.filter((f) => f.oldPath === null).map(filePath));
    let absent = null;
    let present = null;
    for (const path of paths) {
      if (created.has(path)) {
        if (isPresent(path)) { present = path; break; }
        continue;
      }
      try {
        textFor(path);
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
        absent = path;
        break;
      }
    }
    if (present !== null) { excluded.push({ ...entry, reason: `the patch creates a file that is already present: ${present}` }); continue; }
    if (absent !== null) { excluded.push({ ...entry, reason: `the file is absent: ${absent}` }); continue; }

    const pending = new Map();
    let failure = null;
    for (const file of files) {
      const path = filePath(file);
      const base = file.oldPath === null ? null : pending.has(path) ? pending.get(path) : texts.get(path)?.working;
      if (file.oldPath !== null && base === undefined) {
        failure = new Error(`the patch changes ${path} before it creates it`);
        break;
      }
      try {
        pending.set(path, applyUnifiedDiff(base, file));
      } catch (err) {
        failure = err;
        break;
      }
    }
    if (failure) {
      const afterEarlier = paths.some((p) => {
        const text = texts.get(p);
        return text !== undefined && text.working !== text.original;
      });
      excluded.push({ ...entry, reason: `does not apply ${afterEarlier ? 'after earlier fixes' : 'to the text as read'}: ${failure.message}` });
      continue;
    }

    for (const [path, text] of pending) {
      if (!texts.has(path)) texts.set(path, { original: null, working: null });
      texts.get(path).working = text;
      touched.add(path);
    }
    for (const file of files) {
      const path = filePath(file);
      const prior = kinds.get(path);
      if (prior !== 'created' && prior !== 'deleted') kinds.set(path, kindOf(file));
    }
    included.push({ ...entry, files: paths });
    owners.set(patch, { identity: finding.identity, occurrence: finding.occurrence, files: paths });
  }

  const patch = [...touched].sort(cmpStr)
    .map((path) => {
      const { original, working } = texts.get(path);
      if (original === null && working === null) return '';
      return unifiedDiff(path, original, working);
    })
    .filter((diff) => diff !== '')
    .join('');
  return { patch, included, excluded };
}
