// The repo gate. A public repo is served only while GitHub holds every external contributor's
// fork-PR run for approval. A private repo is served: admission still refuses fork heads.

export const SERVING_POLICY = 'all_external_contributors';

const failed = (x) => !x || typeof x !== 'object' || 'error' in x;
const errorText = (x) => (x && x.error ? `${x.error.status} ${x.error.reason}` : 'no answer');

/** 'public', 'private', another visibility string, or undefined when the metadata is unreadable. */
export function visibilityOf(meta) {
  if (failed(meta)) return undefined;
  if (typeof meta.visibility === 'string') return meta.visibility;
  if (typeof meta.private === 'boolean') return meta.private ? 'private' : 'public';
  return undefined;
}

const policyOf = (p) => (typeof p === 'string' ? p : failed(p) ? undefined : p.approval_policy);

/** (repo metadata, fork-PR approval answer) → { served, code, reason }. */
export function repoGate(meta, approvalPolicy) {
  const visibility = visibilityOf(meta);
  if (visibility === undefined) {
    return { served: false, code: 'repo-unmeasured', reason: `repository metadata unreadable: ${errorText(meta)}` };
  }
  if (visibility === 'private') return { served: true, code: 'repo-private', reason: 'private repository' };
  if (visibility !== 'public') {
    return { served: false, code: 'repo-visibility-unsupported', reason: `visibility ${visibility} is neither public nor private` };
  }
  const policy = policyOf(approvalPolicy);
  if (typeof policy !== 'string') {
    return { served: false, code: 'repo-unmeasured', reason: `public repository; fork-PR approval policy unreadable: ${errorText(approvalPolicy)}` };
  }
  if (policy === SERVING_POLICY) {
    return { served: true, code: 'repo-public-approved', reason: `public repository; fork-PR approval is ${SERVING_POLICY}` };
  }
  return { served: false, code: 'repo-approval-weak', reason: `public repository; fork-PR approval is ${policy}, served only at ${SERVING_POLICY}` };
}
