// lib/remediation-verify.mjs — the verdict on one fix candidate, and on the combined patch. The
// caller does the work (apply the patch in a scratch copy, re-run the lanes, run the declared tests)
// and passes what it observed; this library only decides. A step that did not run leaves the status
// undetermined rather than letting an unmeasured step count as a pass, and a fix can only be verified
// against a finding that was measured before it was applied.

const TESTS_STATUSES = Object.freeze(['passed', 'failed', 'notRun', 'notDeclared']);

const IDENTITY_STILL_PRESENT = 'the identity is still present after the patch';
const NEW_FINDINGS_APPEARED = 'new findings appeared in the touched files';
const TESTS_FAILED = 'the test command failed';
const BEFORE_NOT_PRESENT = 'the finding was not present before the fix, so its absence afterwards shows nothing';
const TESTS_DID_NOT_RUN = 'the declared test command did not run';
const NO_FIX_INCLUDED = 'no fix was included';
const COMBINED_STILL_PRESENT = 'included identities are still present after the combined patch';
const RERUN_NEVER_ATTEMPTED = 'the re-run was never attempted';
const LANE_NOT_RERUN = 'a lane that reported the finding did not re-run';

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (xs) => [...new Set(xs)].sort(cmpStr);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasText = (v) => typeof v === 'string' && v.trim() !== '';

const fail = (msg) => { throw new TypeError(`remediation-verify: ${msg}`); };

function stringList(value, field, { required = true } = {}) {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value)) fail(`${field} must be an array of non-empty strings`);
  for (const [i, s] of value.entries()) {
    if (!hasText(s)) fail(`${field}[${i}] must be a non-empty string`);
  }
  return value;
}

function readBefore(before) {
  if (!isObject(before)) fail('before must be an object with lanes and count');
  stringList(before.lanes, 'before.lanes');
  if (!Number.isInteger(before.count) || before.count < 0) fail('before.count must be a non-negative integer');
  if (before.count > 0 && before.lanes.length === 0) fail('before.lanes must name the lane(s) that reported the finding when before.count is above 0');
  return { count: before.count, lanes: sortedUnique(before.lanes) };
}

function readTests(tests) {
  if (!isObject(tests)) fail('tests must be an object with command and status');
  if (!TESTS_STATUSES.includes(tests.status)) {
    fail(`tests.status must be one of ${TESTS_STATUSES.join(', ')}: ${JSON.stringify(tests.status)}`);
  }
  if (tests.status === 'notDeclared') {
    if (tests.command !== null) fail('tests.command must be null when tests.status is "notDeclared"');
  } else if (!hasText(tests.command)) {
    fail(`tests.command must be a non-empty string when tests.status is "${tests.status}"`);
  }
  return { command: tests.command, status: tests.status };
}

// null means verification was never attempted; an object says what the re-run saw. The lanes,
// identities and newIdentities a non-run re-run would have are irrelevant, so they may be omitted
// there and still may not be malformed when supplied.
function readRerun(rerun) {
  if (rerun === null) return null;
  if (!isObject(rerun)) fail('rerun must be null or an object');
  if (typeof rerun.ran !== 'boolean') fail('rerun.ran must be a boolean');
  const required = rerun.ran;
  const lanes = stringList(rerun.lanes, 'rerun.lanes', { required });
  const identities = stringList(rerun.identities, 'rerun.identities', { required });
  const newIdentities = stringList(rerun.newIdentities, 'rerun.newIdentities', { required });
  if (rerun.digest !== undefined && rerun.digest !== null && typeof rerun.digest !== 'string') {
    fail('rerun.digest must be a string or null when present');
  }
  if (rerun.reason !== undefined && typeof rerun.reason !== 'string') {
    fail('rerun.reason must be a string when present');
  }
  if (!rerun.ran) {
    if (!hasText(rerun.reason)) fail('rerun.reason must be a non-empty string when rerun.ran is false');
  } else if (lanes.length === 0) {
    fail('rerun.lanes must name at least one lane when the re-run ran');
  }
  return {
    ran: rerun.ran,
    reason: rerun.reason ?? null,
    lanes: sortedUnique(lanes),
    identities,
    newIdentities,
    digest: rerun.digest ?? null,
  };
}

const verification = (status, witness, newFindings, tests, reason) => ({
  status,
  witness,
  newFindings,
  tests,
  reason,
});

/**
 * -> a remediation `verification` object for one candidate. `rerun` is what the lane re-run over the
 * patched copy observed, or null when it never happened; `tests` is the declared command and how it
 * ended. The decision order is the contract's: an attempted-but-failed re-run or an unmeasured
 * finding makes the result undetermined before any failure evidence is read, because absence is only
 * evidence against a finding that was there.
 */
export function verificationFor(input = {}) {
  if (!isObject(input)) fail('verificationFor expects an object');
  const { identity, before, rerun, tests } = input;
  if (!hasText(identity)) fail('identity must be a non-empty string');
  const { count: beforeCount, lanes: beforeLanes } = readBefore(before);
  const testResult = readTests(tests);
  const seen = readRerun(rerun);

  const witness = (lanes, after, digest) => ({ lanes, before: beforeCount, after, digest });
  const result = (status, lanes, after, digest, newFindings, reason) =>
    verification(status, witness(lanes, after, digest), newFindings, testResult, reason);

  if (seen === null) return result('unverified', [], null, null, [], null);

  if (!seen.ran) return result('undetermined', seen.lanes, null, seen.digest, [], seen.reason);

  if (beforeCount === 0) {
    return result('undetermined', seen.lanes, null, seen.digest, sortedUnique(seen.newIdentities), BEFORE_NOT_PRESENT);
  }

  const after = seen.identities.filter((x) => x === identity).length;
  const newFindings = sortedUnique(seen.newIdentities);
  const causes = [];
  if (after > 0) causes.push(IDENTITY_STILL_PRESENT);
  if (newFindings.length > 0) causes.push(`${NEW_FINDINGS_APPEARED}: ${newFindings.join(', ')}`);
  if (testResult.status === 'failed') causes.push(TESTS_FAILED);
  if (causes.length > 0) return result('failed', seen.lanes, after, seen.digest, newFindings, causes.join('; '));

  // Measured failure stands whatever was skipped; "gone" is only shown by the lanes that reported it.
  const notRerun = beforeLanes.filter((lane) => !seen.lanes.includes(lane));
  if (notRerun.length > 0) {
    return result('undetermined', seen.lanes, null, seen.digest, [], `${LANE_NOT_RERUN}: ${notRerun.join(', ')}`);
  }

  if (testResult.status === 'notRun') return result('undetermined', seen.lanes, null, seen.digest, [], TESTS_DID_NOT_RUN);

  return result('verified', seen.lanes, after, seen.digest, newFindings, null);
}

/**
 * -> `{ status, reason, stillPresent, newFindings }` for the combined patch. Each included fix was
 * verified alone, so the combination needs its own re-run; with nothing included there is nothing to
 * judge, and a failure the combined re-run measured outranks a test step that never ran.
 */
export function verifyCombined(input = {}) {
  if (!isObject(input)) fail('verifyCombined expects an object');
  const { included, rerun, tests } = input;
  if (!Array.isArray(included)) fail('included must be an array');
  const identities = included.map((entry, i) => {
    if (!isObject(entry) || !hasText(entry.identity)) fail(`included[${i}].identity must be a non-empty string`);
    return entry.identity;
  });
  const testResult = readTests(tests);
  const seen = readRerun(rerun);

  const judged = (status, reason, stillPresent = [], newFindings = []) =>
    ({ status, reason, stillPresent, newFindings });

  if (identities.length === 0) return judged('undetermined', NO_FIX_INCLUDED);
  if (seen === null) return judged('undetermined', RERUN_NEVER_ATTEMPTED);
  if (!seen.ran) return judged('undetermined', seen.reason);

  const reported = new Set(seen.identities);
  const stillPresent = sortedUnique(identities.filter((id) => reported.has(id)));
  const newFindings = sortedUnique(seen.newIdentities);
  const causes = [];
  if (stillPresent.length > 0) causes.push(`${COMBINED_STILL_PRESENT}: ${stillPresent.join(', ')}`);
  if (newFindings.length > 0) causes.push(`${NEW_FINDINGS_APPEARED}: ${newFindings.join(', ')}`);
  if (testResult.status === 'failed') causes.push(TESTS_FAILED);
  if (causes.length > 0) return judged('failed', causes.join('; '), stillPresent, newFindings);

  if (testResult.status === 'notRun') return judged('undetermined', TESTS_DID_NOT_RUN);

  return judged('verified', null);
}
