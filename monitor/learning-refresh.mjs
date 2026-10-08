import { loadPolicy } from './remediation-policy.mjs';
import { rebuildLearning, saveLearning } from './learning.mjs';

export function refreshLearningView(issuesDoc, { now, policy = null, path = undefined } = {}) {
  if (process.env.CW_ISSUES && !process.env.CW_LEARNING && path === undefined) {
    return { ok: false, state: 'stale', error: 'CW_ISSUES is overridden but CW_LEARNING is not; refusing to mix stores' };
  }
  try {
    const view = rebuildLearning({ issuesDoc, now, policy: policy || loadPolicy() });
    saveLearning(view, path === undefined ? {} : { path });
    return { ok: true, state: 'rebuilt', generatedAt: view.generatedAt, patterns: Object.keys(view.patterns).length };
  } catch (error) {
    return { ok: false, state: 'stale', error: error.message };
  }
}
