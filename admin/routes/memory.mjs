// admin/routes/memory.mjs — the MEMORY VISUALISER: how a memory record was actually stored.
//
// Two routes, one model. The assembly lives in admin/lib/memory-view.mjs and is pure enough to test
// without a socket; this file is transport only, so a rule that matters can never live in the
// handler where the tests cannot reach it.
//
//   GET /api/memory-view[?id=&limit=]   the model as JSON
//   GET /api/memory-view.html[?id=&limit=]  the same model as ONE self-contained document
//
// The document inlines its data, the house tokens and the theme switch, links nothing and loads no
// font, and therefore still reads correctly after being saved to disk and opened over file://.
//
// NO RECORD CONTENT CROSSES THIS BOUNDARY. The model carries byte counts, hashes, tags, field NAMES
// and gate reasons — never the stored text. The redaction gate exists precisely because content
// carries credentials, and a viewer that reprints the content it is auditing has undone it.
//
// FAILURE IS A STATE, NOT AN EMPTY PAGE. A model that cannot be built answers 503 saying so; it
// never answers 200 with a calm, empty view. That inversion is the whole defect this page is for.
import { requireSession } from '../lib/route-auth.mjs';
import { buildModel, renderPage, renderUnavailable, esc } from '../lib/memory-view.mjs';

/** Session-checked here as well as by the dispatcher's gate — a route's own auth is not the
 *  dispatcher's to remember on its behalf. */

/** Query parsing that states its own refusals: a bad limit is clamped and REPORTED, not silent. */
function params(ctx) {
  const q = ctx.query;
  const rawId = q.get('id');
  const rawLimit = q.get('limit');
  const notes = [];
  let id = null;
  if (rawId !== null && rawId !== '') {
    if (rawId.length > 512) notes.push('the `id` given is longer than any external_id this store can hold and was ignored');
    else id = rawId;
  }
  let limit = 12;
  if (rawLimit !== null && rawLimit !== '') {
    const n = Number(rawLimit);
    if (!Number.isFinite(n) || n < 1) notes.push(`\`limit\` was not a positive number, so the default of ${limit} was used`);
    else limit = Math.min(100, Math.floor(n));
  }
  return { id, limit, notes };
}

export const routes = [
  {
    method: 'GET',
    path: '/api/memory-view',
    handle(ctx) {
      if (!requireSession(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
      const { id, limit, notes } = params(ctx);
      try {
        const model = buildModel({ id, limit });
        return ctx.send(200, { ok: true, ...model, ...(notes.length ? { requestNotes: notes } : {}) });
      } catch (e) {
        // 503 with the reason, never 200 with an empty model: an unbuildable view is unknown, and
        // an unknown rendered as a clean one is the failure this page was written to catch.
        return ctx.send(503, { ok: false, error: `the memory view could not be assembled: ${(e && e.message) || 'error'}` });
      }
    },
  },
  {
    method: 'GET',
    path: '/api/memory-view.html',
    handle(ctx) {
      if (!requireSession(ctx)) return ctx.send(401, { ok: false, error: 'authentication required' });
      const { id, limit, notes } = params(ctx);
      try {
        const model = buildModel({ id, limit });
        let html = renderPage(model);
        if (notes.length) {
          html = html.replace('</div></body>', `<p style="color:var(--part)">${notes.map(esc).join(' · ')}</p></div></body>`);
        }
        return ctx.send(200, html, 'text/html; charset=utf-8');
      } catch (e) {
        return ctx.send(503, renderUnavailable((e && e.message) || 'error'), 'text/html; charset=utf-8');
      }
    },
  },
];
