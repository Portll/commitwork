// validates a remediation document and returns an object with an errors array (lib/remediation-contract.mjs validateRemediation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRemediation } from '../remediation-contract.mjs';

test('returns early with errors when doc is null', () => {
  const input = null;
  const result = validateRemediation(input);
  assert.deepEqual(result, { errors: ["(root): expected object, got null"] });
});

test('adds an error when a finding identity does not start with required prefixes', () => {
  const input = {
    findings: [
      {
        identity: 'bad|id',
        occurrence: 1,
        candidates: []
      }
    ]
  };
  const result = validateRemediation(input);
  assert.deepEqual(result, { errors: ["(root): required key 'schema' is missing", "(root): required key 'generatedAt' is missing", "(root): required key 'tool' is missing", "(root): required key 'repository' is missing", "(root): required key 'commit' is missing", "(root): required key 'undetermined' is missing", "(root): required key 'notMeasured' is missing", "findings[0]: required key 'ruleId' is missing", "findings[0]: required key 'lane' is missing", "findings[0]: required key 'file' is missing", "findings[0]: required key 'severity' is missing", "findings[0]: required key 'actions' is missing", "findings[0].identity: \"bad|id\" does not match ^(sc|f)\\|", "finding bad|id: identity must start with \"sc|\" or \"f|\""] });
});

test('detects duplicate identity and occurrence across findings', () => {
  const input = {
    findings: [
      { identity: 'sc|foo', occurrence: 2, candidates: [] },
      { identity: 'sc|foo', occurrence: 2, candidates: [] }
    ]
  };
  const result = validateRemediation(input);
  assert.deepEqual(result, { errors: ["(root): required key 'schema' is missing", "(root): required key 'generatedAt' is missing", "(root): required key 'tool' is missing", "(root): required key 'repository' is missing", "(root): required key 'commit' is missing", "(root): required key 'undetermined' is missing", "(root): required key 'notMeasured' is missing", "findings[0]: required key 'ruleId' is missing", "findings[0]: required key 'lane' is missing", "findings[0]: required key 'file' is missing", "findings[0]: required key 'severity' is missing", "findings[0]: required key 'actions' is missing", "findings[1]: required key 'ruleId' is missing", "findings[1]: required key 'lane' is missing", "findings[1]: required key 'file' is missing", "findings[1]: required key 'severity' is missing", "findings[1]: required key 'actions' is missing", "finding sc|foo occurrence 2: identity and occurrence are already used by findings[0]"] });
});

test('candidate verification "verified" status missing required fields produces multiple rule errors', () => {
  const input = {
    findings: [
      {
        identity: 'sc|example',
        occurrence: 0,
        candidates: [
          {
            tier: 'gold',
            patch: 'patch-1',
            verification: {
              status: 'verified',
            }
          }
        ]
      }
    ]
  };
  const result = validateRemediation(input);
  assert.deepEqual(result, { errors: ["(root): required key 'schema' is missing", "(root): required key 'generatedAt' is missing", "(root): required key 'tool' is missing", "(root): required key 'repository' is missing", "(root): required key 'commit' is missing", "(root): required key 'undetermined' is missing", "(root): required key 'notMeasured' is missing", "findings[0]: required key 'ruleId' is missing", "findings[0]: required key 'lane' is missing", "findings[0]: required key 'file' is missing", "findings[0]: required key 'severity' is missing", "findings[0]: required key 'actions' is missing", "findings[0].candidates[0]: required key 'id' is missing", "findings[0].candidates[0]: required key 'provenance' is missing", "findings[0].candidates[0]: required key 'cached' is missing", "findings[0].candidates[0].tier: \"gold\" is not one of [\"deterministic\",\"rule\",\"codemod\",\"llm\"]", "findings[0].candidates[0].verification: required key 'witness' is missing", "findings[0].candidates[0].verification: required key 'newFindings' is missing", "findings[0].candidates[0].verification: required key 'tests' is missing", "findings[0].candidates[0].verification: required key 'reason' is missing", "finding sc|example candidate (no id): status \"verified\" requires witness.lanes to name the lane(s) that re-ran", "finding sc|example candidate (no id): status \"verified\" requires witness.before > 0", "finding sc|example candidate (no id): status \"verified\" requires witness.after to be 0", "finding sc|example candidate (no id): status \"verified\" requires newFindings to be empty", "finding sc|example candidate (no id): status \"verified\" requires tests.status \"passed\" or \"notDeclared\", not undefined"] });
});

test('candidate with null patch and status "failed" yields a specific rule error about allowed statuses', () => {
  const input = {
    findings: [
      {
        identity: 'f|example',
        occurrence: 3,
        candidates: [
          {
            tier: 'silver',
            patch: null,
            verification: {
              status: 'failed',
              reason: 'some reason',
              witness: { after: 1 }
            }
          }
        ]
      }
    ]
  };
  const result = validateRemediation(input);
  assert.deepEqual(result, { errors: ["(root): required key 'schema' is missing", "(root): required key 'generatedAt' is missing", "(root): required key 'tool' is missing", "(root): required key 'repository' is missing", "(root): required key 'commit' is missing", "(root): required key 'undetermined' is missing", "(root): required key 'notMeasured' is missing", "findings[0]: required key 'ruleId' is missing", "findings[0]: required key 'lane' is missing", "findings[0]: required key 'file' is missing", "findings[0]: required key 'severity' is missing", "findings[0]: required key 'actions' is missing", "findings[0].candidates[0]: required key 'id' is missing", "findings[0].candidates[0]: required key 'provenance' is missing", "findings[0].candidates[0]: required key 'cached' is missing", "findings[0].candidates[0].tier: \"silver\" is not one of [\"deterministic\",\"rule\",\"codemod\",\"llm\"]", "findings[0].candidates[0].verification: required key 'newFindings' is missing", "findings[0].candidates[0].verification: required key 'tests' is missing", "findings[0].candidates[0].verification.witness: required key 'lanes' is missing", "findings[0].candidates[0].verification.witness: required key 'before' is missing", "findings[0].candidates[0].verification.witness: required key 'digest' is missing", "finding f|example candidate (no id): a candidate with a null patch can only be \"unverified\" or \"undetermined\", not \"failed\""] });
});
