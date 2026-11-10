// admin/routes/runner.mjs — the Actions runner page: the portll-stack dispatcher's slots, decisions,
// jobs and resource layers, read from its stack API through lib/stack-client.mjs.
//
//   GET /api/runner        the model as JSON
//   GET /api/runner.html   the page
//
// Under /api/, like the memory view, so the login gate covers both. A stopped stack is a state of
// the model: 200, with every figure UNMEASURED. A model that cannot be assembled is 503.
import { requireSession } from '../lib/route-auth.mjs';
import { buildRunnerModel, readRunner } from '../lib/runner-view.mjs';
import { PAGE_CSP, renderRunnerPage } from '../lib/runner-page.mjs';

const NO_STORE = { 'cache-control': 'no-store' };

async function answer(ctx, render) {
  if (!requireSession(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
  let model;
  try { model = buildRunnerModel(await readRunner()); } catch (e) {
    const why = `the runner view could not be assembled: ${(e && e.message) || 'error'}`;
    return ctx.send(503, { ok: false, error: why }, 'application/json', NO_STORE);
  }
  return render(model);
}

export const routes = [
  {
    method: 'GET',
    path: '/api/runner',
    handle: (ctx) => answer(ctx, (model) => ctx.send(200, { ok: true, ...model }, 'application/json', NO_STORE)),
  },
  {
    method: 'GET',
    path: '/api/runner.html',
    handle: (ctx) => answer(ctx, (model) => ctx.send(200, renderRunnerPage(model), 'text/html; charset=utf-8', {
      ...NO_STORE, 'x-robots-tag': 'noindex, nofollow', 'content-security-policy': PAGE_CSP,
    })),
  },
];
