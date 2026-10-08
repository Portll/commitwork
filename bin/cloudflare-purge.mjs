#!/usr/bin/env node
// bin/cloudflare-purge.mjs — purge the Cloudflare CDN edge cache for the docsite's zone.
//
// A Cloudflare Pages deployment is correct at the deployment level the moment it completes (the
// deployment's own *.pages.dev URL always serves the new content), but a CUSTOM DOMAIN sitting in
// front of it goes through Cloudflare's separate edge cache, which does not get implicitly
// invalidated by a new deployment. Measured 2026-08-29: a stale fixture page kept serving from
// i.commitwork.online's edge cache for several minutes after the deployment that removed it was
// already confirmed correct via the direct *.pages.dev URL.
//
// Usage:
//   node bin/cloudflare-purge.mjs                        # purge everything in the zone
//   node bin/cloudflare-purge.mjs --files <url> [<url> ...]   # purge specific URLs only
//
// Requires CW_CLOUDFLARE_API_TOKEN (scoped to Zone:Cache Purge for the target zone) and
// CW_CLOUDFLARE_ZONE_ID. The token resolves via lib/secrets.mjs — an explicit env var wins, else
// the macOS Keychain ref declared with `node bin/secrets.mjs set CW_CLOUDFLARE_API_TOKEN` (never
// a .env file: same reasoning admin/serve.mjs's OAuth secrets already reject that, and the value
// is never typed as a CLI argument or passed through this repo's own tooling in plaintext). The
// zone id isn't sensitive the same way — plain env var, no keychain. Neither is bundled, defaulted,
// or read from wrangler's own OAuth session (~/.wrangler/config/*.toml) — that credential is
// scoped to wrangler's own operations and reusing it here would blur a boundary rather than
// declare one.
//
// CW_CLOUDFLARE_API_BASE overrides the API base URL — test override only, never set in production.

import { resolveInto, reportMissing } from '../lib/secrets.mjs';

const API_BASE = process.env.CW_CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4';

function die(msg, code = 2) { process.stderr.write(`cloudflare-purge: ${msg}\n`); process.exit(code); }

async function main() {
  const r = resolveInto(['CW_CLOUDFLARE_API_TOKEN'], { env: process.env });
  if (!r.ok) { reportMissing(r.missing, { context: 'cloudflare-purge' }); process.exit(2); }
  const token = r.env.CW_CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CW_CLOUDFLARE_ZONE_ID;
  if (!zoneId) die('CW_CLOUDFLARE_ZONE_ID is not set — the zone id for the domain being purged (Cloudflare dashboard, zone overview, right-hand sidebar).');

  const filesIdx = process.argv.indexOf('--files');
  const files = filesIdx >= 0 ? process.argv.slice(filesIdx + 1) : [];
  if (filesIdx >= 0 && files.length === 0) die('--files given with no urls following it');
  const body = files.length ? { files } : { purge_everything: true };

  let res;
  try {
    res = await fetch(`${API_BASE}/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    die(`request failed: ${e.message}`);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON error body handled below */ }
  if (!res.ok || !json || json.success !== true) {
    const errs = json && Array.isArray(json.errors) && json.errors.length
      ? json.errors.map((e) => `${e.code}: ${e.message}`).join('; ')
      : `HTTP ${res.status}`;
    die(`purge failed: ${errs}`);
  }
  process.stdout.write(files.length ? `purged ${files.length} url(s)\n` : 'purged entire zone cache\n');
  // fetch's keep-alive connection pool holds the event loop open otherwise — measured 2026-08-29:
  // the process hung indefinitely (never exited) on every success path without this.
  process.exit(0);
}

main();
