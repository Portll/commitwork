// Carries out one tick's actions in decide's order. A GitHub failure is recorded and the tick goes
// on; the next tick sees the same queue and decides again. Anything but a GithubError is a defect.
import { GithubError } from './github.mjs';

const failure = (a, code, reason) => ({ repo: a.repo, runId: a.runId ?? null, jobId: a.jobId ?? null, admit: false, code, reason });

async function mint(a, { gh, claims, ledger, now }) {
  const r = await gh.generateJitConfig(a.repo, { name: a.name, labels: a.labels });
  const job = { jit: r.encoded_jit_config, repo: a.repo, name: a.name, jobId: a.jobId, runId: a.runId, actors: a.actors || [] };
  if (!claims.assign(a.slotId, job)) {
    // the claim closed between freeSlots() and the mint; an unheld runner would take the job anyway
    await gh.deleteRunner(a.repo, r.runner.id);
    ledger.recordDecision(failure(a, 'slot-gone', `${a.slotId} stopped claiming before ${a.name} was delivered; runner deleted`));
    return false;
  }
  const at = new Date(now()).toISOString();
  ledger.runnerMinted({ name: a.name, repo: a.repo, runId: a.runId, jobId: a.jobId, slotId: a.slotId, runnerId: r.runner.id, at });
  // assign answered the slot's open claim, so the JIT is in the slot's hands now
  ledger.runnerClaimed(a.name, a.slotId, at);
  return true;
}

const STEPS = {
  record: async (a, { ledger }) => { ledger.recordDecision(a.decision); return true; },
  cancel: async (a, { gh }) => { await gh.cancelRun(a.repo, a.runId); return true; },
  delete: async (a, { gh }) => { await gh.deleteRunner(a.repo, a.runnerId); return true; },
  mint,
};

/** (actions, { gh, claims, ledger, now }) → { done: {kind: n}, failed: [{kind, repo, status, reason}] } */
export async function execute(actions, deps) {
  const out = { done: {}, failed: [] };
  const ctx = { now: Date.now, ...deps };
  for (const a of actions) {
    const step = STEPS[a.kind];
    if (!step) throw new TypeError(`execute: unknown action kind ${a.kind}`);
    try {
      if (await step(a, ctx)) out.done[a.kind] = (out.done[a.kind] || 0) + 1;
    } catch (e) {
      if (!(e instanceof GithubError)) throw e;
      out.failed.push({ kind: a.kind, repo: a.repo, status: e.status, reason: e.reason });
      ctx.ledger.recordDecision(failure(a, 'action-failed', `${a.kind} failed: ${e.status} ${e.reason}`));
    }
  }
  return out;
}
