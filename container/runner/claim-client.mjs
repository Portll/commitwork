// The supervisor's half of runner/claim.mjs: long-poll for a job, then report what it cost.
// Node's fetch ignores HTTPS_PROXY, so these calls stay on the slot network to the dispatcher.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A refusal the slot cannot recover from by asking again. */
export class ClaimRefused extends Error {}

/**
 * Ask until a job arrives: { jit, repo, runnerName, jobId }. 204 is an empty poll; a network error
 * means the dispatcher is restarting, so wait and ask again. 401 and 409 end this lifetime.
 */
export async function claimJob({ url, secret, slotId, boot, fetch: f = fetch, backoffMs = [1000, 2000, 5000, 10000] }) {
  for (let fails = 0; ;) {
    let res;
    try {
      res = await f(`${url}/v1/claim`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ slotId, boot }) });
    } catch {
      await sleep(backoffMs[Math.min(fails++, backoffMs.length - 1)]);
      continue;
    }
    fails = 0;
    if (res.status === 200) return res.json();
    if (res.status === 204) continue;
    throw new ClaimRefused(`claim refused: ${res.status}`);
  }
}

/** Best effort: a lost report costs the ledger one job's figures, never the slot's restart. */
export async function reportJob({ url, secret, slotId, boot, report, fetch: f = fetch }) {
  try {
    const res = await f(`${url}/v1/report`, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: JSON.stringify({ slotId, boot, ...report }) });
    return res.status;
  } catch (e) {
    return `network: ${e.code || e.message}`;
  }
}
