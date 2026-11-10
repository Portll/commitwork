// The dispatcher's decision vocabulary: every code a record can carry, and what decide does with it.
//   admit   mint a runner when a slot is free
//   refuse  record, and cancel the run so it does not sit queued for 24 h
//   wait    record only: a read failed or capacity is short, so the next tick decides again
//   skip    not addressed to this runner: no record, no cancel

export const CODES = Object.freeze({
  // repo gate
  'repo-private': 'admit',
  'repo-public-approved': 'admit',
  'repo-approval-weak': 'refuse',
  'repo-visibility-unsupported': 'refuse',
  'repo-unmeasured': 'wait',
  // event
  'event-privileged': 'refuse',
  'head-foreign': 'refuse',
  // actor
  'actor-foreign': 'refuse',
  'actor-unknown': 'refuse',
  // labels
  'not-addressed': 'skip',
  'repo-undeclared': 'skip',
  'labels-outside-set': 'refuse',
  // workflow, read statically: a remote docker action is not visible here and fails at runtime on
  // a docker-less slot, which costs a job, not isolation
  'workflow-unseen': 'refuse',
  'workflow-unreadable': 'refuse',
  'workflow-unmeasured': 'wait',
  'job-unmapped': 'refuse',
  'reusable-workflow': 'refuse',
  'needs-container': 'refuse',
  'needs-services': 'refuse',
  'needs-docker-action': 'refuse',
  'local-action-unseen': 'refuse',
  // tick
  admitted: 'admit',
  'run-refused': 'refuse',
  'runs-unmeasured': 'wait',
  'jobs-unmeasured': 'wait',
  'runners-unmeasured': 'wait',
  'runner-pending': 'wait',
  'capacity-wait': 'wait',
  // execution
  'action-failed': 'wait',
  'slot-gone': 'wait',
});

/** The outcome for a code. An unknown code waits: it can neither mint nor cancel. */
export const outcomeOf = (code) => (Object.hasOwn(CODES, code) ? CODES[code] : 'wait');
