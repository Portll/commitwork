// The slots' side of the dispatcher. A slot's root supervisor long-polls POST /v1/claim with its
// secret and the boot nonce of this container lifetime; a mint for that slot answers the poll with
// the JIT config. Free slots are exactly those holding an open claim, so a slot that crashed or is
// mid-job is never minted for. One JIT per boot: a second claim on a delivered boot is refused.
import { timingSafeEqual } from 'node:crypto';

const MAX_BODY = 4096;
const BOOT = /^[0-9a-f]{16,64}$/;

const same = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((done) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) req.destroy(); else parts.push(c); });
    req.on('end', () => { try { done(JSON.parse(Buffer.concat(parts).toString('utf8'))); } catch { done(null); } });
    req.on('error', () => done(null));
  });
}

/** secrets: { slotId: secret }. holdMs bounds a long-poll so proxies and timeouts never see it hang. */
export function createClaims({ secrets, holdMs = 50_000, now = Date.now, onReport = () => {} }) {
  const slots = new Map(Object.keys(secrets).map((id) => [id, { id, state: 'unknown', since: now(), boot: null, waiting: null, job: null }]));
  const delivered = new Set();

  const authorised = (req, body) => {
    const slot = slots.get(body?.slotId);
    const token = String(req.headers.authorization || '').replace(/^Bearer /, '');
    return slot && BOOT.test(String(body.boot)) && same(token, secrets[slot.id]) ? slot : null;
  };
  const move = (slot, state, extra = {}) => Object.assign(slot, { state, since: now(), ...extra });

  function claim(slot, boot, res) {
    if (delivered.has(`${slot.id}:${boot}`)) return send(res, 409, { error: 'this boot already took a job' });
    if (slot.waiting) send(slot.waiting.res, 204);
    clearTimeout(slot.waiting?.timer);
    const timer = setTimeout(() => { if (slot.waiting?.res === res) { slot.waiting = null; move(slot, 'unknown'); send(res, 204); } }, holdMs);
    slot.waiting = { res, timer };
    res.on('close', () => { if (slot.waiting?.res === res) { clearTimeout(timer); slot.waiting = null; move(slot, 'unknown'); } });
    move(slot, 'idle', { boot, job: null });
  }

  async function handle(req, res) {
    const route = `${req.method} ${req.url}`;
    if (route !== 'POST /v1/claim' && route !== 'POST /v1/report') return send(res, 404);
    const body = await readJson(req);
    const slot = authorised(req, body);
    if (!slot) return send(res, 401);
    if (route === 'POST /v1/claim') return claim(slot, body.boot, res);
    if (slot.boot !== body.boot || slot.state !== 'running') return send(res, 409, { error: 'no job on this boot' });
    onReport({ ...body, slotId: slot.id, runnerName: slot.job.name, repo: slot.job.repo, jobId: slot.job.jobId, runId: slot.job.runId });
    move(slot, 'restarting');
    return send(res, 204);
  }

  /** Answer slotId's open claim with a JIT config. False when the claim went away since freeSlots(). */
  function assign(slotId, job) {
    const slot = slots.get(slotId);
    if (!slot?.waiting) return false;
    const { res, timer } = slot.waiting;
    clearTimeout(timer);
    slot.waiting = null;
    delivered.add(`${slot.id}:${slot.boot}`);
    move(slot, 'running', { job: { name: job.name, repo: job.repo, jobId: job.jobId, runId: job.runId } });
    send(res, 200, { jit: job.jit, repo: job.repo, runnerName: job.name, jobId: job.jobId, actors: job.actors || [] });
    return true;
  }

  return {
    handle,
    assign,
    freeSlots: () => [...slots.values()].filter((s) => s.waiting).map((s) => s.id),
    states: () => [...slots.values()].map(({ id, state, since, job }) => ({ id, state, since: new Date(since).toISOString(), job })),
  };
}
