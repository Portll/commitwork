// The passkey routes over a real server — the relying-party policy resolves from the DECLARED
// hostname allowlist, never from the request. node:http, not fetch: Host is a forbidden fetch
// header and undici drops it silently.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createServer } from 'node:net';

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = join(HERE, '..', 'serve.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'cw-pkroute-'));
const DECLARED = 'panel.declared.test';

let localPort, pubPort, child, csrf;
const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
const hitOn = (targetPort, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const payload = body === null ? null : Buffer.from(JSON.stringify(body));
  const h = { ...headers };
  if (payload) { h['content-type'] = 'application/json'; h['content-length'] = String(payload.length); }
  const req = request({ host: '127.0.0.1', port: targetPort, path, method, headers: h }, (res) => {
    // Buffers, not `buf += d`. The login page carries 185 multi-byte characters (151 box-drawing
    // `─` alone), and += decodes each CHUNK independently, so a character split across a chunk
    // boundary becomes U+FFFD. Chunking varies with load, which is how that surfaces: intermittent,
    // only under contention, and only in whichever test parses the bytes rather than regexing them.
    const chunks = [];
    res.on('data', (d) => { chunks.push(d); });
    res.on('end', () => {
      const buf = Buffer.concat(chunks).toString('utf8');
      let json = null; try { json = JSON.parse(buf); } catch { /* html */ }
      resolve({ status: res.statusCode, body: buf, json });
    });
  });
  req.on('error', reject);
  if (payload) req.write(payload);
  req.end();
});
const hit = (path, opts) => hitOn(localPort, path, opts);
const post = (path, body, extra = {}) => hit(path, { method: 'POST', body, headers: { 'x-cw-csrf': csrf, ...extra } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  mkdirSync(join(TMP, 'reports', 'fixarea'), { recursive: true });
  // The declared hostname is the only thing that makes a non-loopback origin acceptable.
  writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
    reportsRoot: join(TMP, 'reports'),
    monitorOutput: 'fixarea',
    areas: [
      { slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true },
      {
        slug: 'commitwork-admin',
        label: 'panel',
        out: 'fixarea',
        // service/public/requiresAuth are schema-required on any `deploy` block
        deploy: {
          hostnames: [DECLARED], service: 'http://127.0.0.1:7878', public: true, requiresAuth: true,
        },
      },
    ],
    projects: [],
  }));
  // Bind an operator first — an unbootstrapped panel's 503 would mask the Host assertions.
  // CW_AUTH_STORE is read at module load, hence the dynamic import after the assignment.
  process.env.CW_AUTH_STORE = join(TMP, 'users.json');
  const auth = await import('../auth.mjs');
  auth.bootstrapRoot({ email: 'op@example.test', password: 'correct-horse-battery-staple' });

  const port = await freePort();
  pubPort = port;
  localPort = await freePort();
  child = spawn(process.execPath, [SERVE], {
    env: {
      ...process.env,
      CW_AUTH_STORE: join(TMP, 'users.json'),
      CW_REGISTRY: join(TMP, 'projects.json'),
      CW_ADMIN_PORT: String(port),
      CW_ADMIN_LOCAL_PORT: String(localPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 120 && !csrf; i++) {
    try { const r = await hit('/api/csrf'); if (r.status === 200) csrf = r.json.token; } catch { /* not up yet */ }
    if (!csrf) await sleep(100);
  }
  assert.ok(csrf, 'panel did not come up');
});

after(() => {
  child?.kill('SIGKILL');
  rmSync(TMP, { recursive: true, force: true });
});

describe('passkey routes — the RP policy is declared, not asked for', () => {
  test('an UNDECLARED Host gets no ceremony at all', async () => {
    // Refused before any store read — the panel never issues a challenge it cannot honestly verify.
    const r = await post('/auth/passkey/register/begin', { email: 'a@b.test', password: 'x' },
      { host: 'evil.tld' });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /does not answer to 'evil\.tld'/);
    assert.match(r.json.error, /declared hostname/, 'and it says what would fix it');
  });

  test('a DECLARED Host is accepted and the rpId is the bare hostname', async () => {
    // A WebAuthn RP ID is a bare domain — not the origin, not host:port.
    const r = await post('/auth/passkey/login/begin', {}, { host: `${DECLARED}:443` });
    assert.equal(r.status, 200);
    assert.equal(r.json.rpId, DECLARED);
    assert.ok(r.json.challenge && r.json.challengeId, 'a challenge is issued');
  });

  test('loopback still works — local sign-in must not need a declared name', async () => {
    const r = await post('/auth/passkey/login/begin', {});
    assert.equal(r.status, 200);
    assert.equal(r.json.rpId, '127.0.0.1');
    assert.ok(r.json.challenge);
  });

  test('every begin issues a DIFFERENT challenge', async () => {
    const a = await post('/auth/passkey/login/begin', {});
    const b = await post('/auth/passkey/login/begin', {});
    assert.notEqual(a.json.challenge, b.json.challenge, 'a reused challenge is a replayable login');
    assert.notEqual(a.json.challengeId, b.json.challengeId);
  });

  test('enrolment over HTTP still demands the password', async () => {
    // /auth/ is exempt from the login gate, so this route is reachable unauthenticated and remotely.
    const r = await post('/auth/passkey/register/begin', { email: 'nobody@example.test', password: 'wrong' });
    assert.equal(r.status, 401);
    assert.match(r.json.error, /invalid credentials/);
    assert.equal(r.json.challengeId, undefined, 'and no challenge leaks to an unauthenticated caller');
  });

  test('a garbage assertion is refused, not accepted and not a 500', async () => {
    const r = await post('/auth/passkey/login/finish', {
      challengeId: 'nope', credentialId: 'nope',
      clientDataJSON: Buffer.from('{}').toString('base64'),
      authenticatorData: Buffer.from('short').toString('base64'),
      signature: Buffer.from('x').toString('base64'),
    });
    assert.equal(r.status, 401);
    assert.equal(r.json.ok, false);
    assert.ok(!/set-cookie/i.test(r.body), 'no session may be minted by a failed assertion');
  });

  test('an unknown stage 404s rather than falling through to something else', async () => {
    const r = await post('/auth/passkey/not-a-stage', {});
    assert.equal(r.status, 404);
  });
});

describe('the login page carries a ceremony that can actually run', () => {
  test('the sign-in page offers the passkey button', async () => {
    const r = await hitOn(pubPort, '/', { headers: { accept: 'text/html' } });
    // Accept: text/html is load-bearing. Asserted as "an HTML page, whatever the status" — the
    // status is the gate's business, the button is this test's.
    assert.match(String(r.body).slice(0, 200), /<!doctype html|<html/i, `expected a page, got ${r.status}`);
    assert.match(r.body, /id="passkey"/);
    assert.match(r.body, /Sign in with a passkey/);
  });

  test('the ceremony converts base64url IN and standard base64 OUT — the two are not the same', async () => {
    // Getting these backwards fails only for values containing + or / — intermittent.
    const { body } = await hitOn(pubPort, '/', { headers: { accept: 'text/html' } });
    assert.match(body, /navigator\.credentials\.get/);
    assert.match(body, /b64uToBuf/, 'the challenge arrives base64url and must be decoded as such');
    assert.match(body, /replace\(\/-\/g,'\+'\)\.replace\(\/_\/g,'\/'\)/, 'base64url → standard, before atob');
    assert.match(body, /bufToB64/, 'the response blobs go back as standard base64, per the route');
  });

  test('a browser without WebAuthn is never shown a control that cannot work', async () => {
    const { body } = await hitOn(pubPort, '/', { headers: { accept: 'text/html' } });
    assert.match(body, /id="passkey"[^>]*hidden/, 'ships hidden');
    assert.match(body, /window\.PublicKeyCredential/, 'and is only revealed on feature detection');
  });

  // The two assertions above passed for the whole life of the button while it rendered anyway:
  // `hidden` is enforced by the UA sheet's [hidden]{display:none}, and ANY author rule setting
  // display wins on origin regardless of specificity. `.sso{display:flex}` did exactly that, so the
  // control a browser without WebAuthn "is never shown" was shown to all of them. Asserting the
  // attribute is asserting the intent; this asserts the effect.
  //
  // Derived from the page, never from a list: the classes checked are whatever the served markup
  // actually puts on a hidden element, so a new one is covered the day it ships.
  test('and the cascade does not override the hidden that hides it', async () => {
    const { body } = await hitOn(pubPort, '/', { headers: { accept: 'text/html' } });
    const css = [...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
    assert.ok(css.trim(), 'no inline stylesheet found — this test would otherwise pass vacuously');

    // Scan markup only: script bodies carry `<`, `>` and the word `hidden` (pk.hidden=false). Strip
    // the blocks rather than cutting at the first one — on this page <script> PRECEDES <body>.
    const markup = body.split(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/i).join('').split(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/i).join('');
    // Per ELEMENT, not a flat class set: which rules match depends on the whole class list.
    // Attribute position only. \bhidden\b also matches inside aria-hidden (the `-` is a word
    // boundary) and inside overflow:hidden, and the wordmark carries the first of those.
    const hiddenEls = [];
    for (const [, attrs] of markup.matchAll(/<[a-z][a-z0-9-]*\b([^>]*\shidden(?=[\s/>=])[^>]*)>/gi)) {
      hiddenEls.push({
        id: /\bid="([^"]*)"/.exec(attrs)?.[1] || '(no id)',
        classes: new Set((/\bclass="([^"]*)"/.exec(attrs)?.[1] || '').split(/\s+/).filter(Boolean)),
      });
    }
    // Tag name too — a bare type selector like `label{display:block}` matches only <label>, and a
    // matcher that ignores it reports every hidden <div> as overridden by it. Re-scan with the tag.
    {
      let i = 0;
      for (const [, tag] of markup.matchAll(/<([a-z][a-z0-9-]*)\b[^>]*\shidden(?=[\s/>=])[^>]*>/gi)) {
        if (hiddenEls[i]) hiddenEls[i].tag = tag.toLowerCase();
        i += 1;
      }
    }
    assert.ok(hiddenEls.length, 'no element ships hidden — the guard this test covers is gone');

    // The resolver models origin, specificity, source order and !important. It does NOT model
    // @layer, which reorders origins wholesale. ASSERT the limit rather than assume it, so this
    // fails loudly when it stops describing the stylesheet instead of quietly returning a winner
    // that is not the winner. (Another session's point, applied back here.)
    assert.equal(/@layer\b/.test(css), false,
      '@layer appeared in the login CSS — this resolver does not model cascade layers and its '
      + 'verdict is no longer trustworthy. Extend it before trusting a pass.');

    // @media openers cannot complete this pattern, so nested blocks are skipped rather than mangled.
    // Strip comments first — they sit between rules and otherwise arrive glued to the next selector.
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .map((m, i) => ({ sel: m[1].trim(), decl: m[2], order: i }));

    // "Does a [hidden] reset EXIST" is itself a presence check, and presence does not pin the
    // outcome when more than one rule can produce it: a later, equally-specific `.sso.wide{display:
    // grid}` beats `.sso[hidden]{display:none}` on source order and the element renders again, with
    // this test still green. So compute the WINNER — highest specificity, ties to source order —
    // and assert the winning declaration is the one that hides. (Raised by another session, which hit
    // the same shape: two renderers obeyed one flag, so deleting either alone still passed.)
    const displayWinner = (el) => {
      let best = null;
      for (const r of rules) {
        if (!/(^|;)\s*display\s*:/.test(r.decl)) continue;
        for (const sel of r.sel.split(',')) {
          let s = sel.trim();
          if (!s) continue;
          // A combinator moves the SUBJECT to the rightmost compound. Judge that compound: if it
          // cannot match this element the rule is irrelevant and skipping is correct; if it can, the
          // ancestor/sibling condition is undecidable here and refusing to guess beats guessing.
          const combinator = /[\s>+~]/.test(s.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ''));
          if (combinator) {
            const subject = s.split(/[\s>+~]+/).filter(Boolean).pop() || '';
            const subjClasses = (subject.match(/\.[\w-]+/g) || []).map((c) => c.slice(1));
            if (!subjClasses.length || !subjClasses.every((c) => el.classes.has(c))) continue;
            return { unanalysable: s };
          }
          const parts = s.match(/\.[\w-]+|\[[^\]]+\]|#[\w-]+|:not\([^)]*\)|::?[\w-]+/g) || [];
          // Whatever is left once the parts are removed is the TYPE selector.
          const type = s.replace(/(\.[\w-]+|\[[^\]]+\]|#[\w-]+|:not\([^)]*\)|::?[\w-]+)/g, '').trim();
          if (type && type !== '*' && type.toLowerCase() !== el.tag) continue;
          let ok = true, spec = type && type !== '*' ? 1 : 0;     // type = (0,0,1)
          for (const p of parts) {
            if (p.startsWith(':not(')) { if (/\[hidden\]/.test(p)) ok = false; spec += 10; continue; }
            if (p.startsWith('.')) { if (!el.classes.has(p.slice(1))) ok = false; spec += 10; continue; }
            if (p === '[hidden]') { spec += 10; continue; }       // true by construction here
            if (p.startsWith('#')) { if (p.slice(1) !== el.id) ok = false; spec += 100; continue; }
            if (/^::/.test(p)) { ok = false; continue; }          // a pseudo-ELEMENT is not this element
            ok = false;                                           // a state pseudo-class we cannot resolve
          }
          if (!ok) continue;
          // !important outranks specificity outright, so a LOWER-specificity `display:flex
          // !important` beats the reset in a browser while a specificity-only resolver reports the
          // reset winning — a false clean of exactly the kind this test exists to refuse.
          const d = /display\s*:\s*([\w-]+)\s*(!\s*important)?/.exec(r.decl);
          const cand = { spec, order: r.order, sel: s, value: d?.[1], important: !!d?.[2] };
          const beats = !best
            || (cand.important && !best.important)
            || (cand.important === best.important
                && (cand.spec > best.spec || (cand.spec === best.spec && cand.order > best.order)));
          if (beats) best = cand;
        }
      }
      return best;
    };

    for (const el of hiddenEls) {
      const win = displayWinner(el);
      assert.ok(!win?.unanalysable,
        `selector '${win?.unanalysable}' uses a combinator, so this test cannot decide the cascade `
        + 'for it. Do not read this as a pass — narrow the selector or extend the matcher.');
      if (!win) continue;                       // no author rule sets display; the UA [hidden] holds
      assert.equal(win.value, 'none',
        `#${el.id} carries the hidden attribute, but the winning display declaration is `
        + `'${win.sel}{display:${win.value}${win.important ? ' !important' : ''}}' — author rules beat `
        + 'the UA [hidden] rule on ORIGIN, not on specificity, so this element renders. The reset must '
        + `WIN, not merely exist.${win.important ? ' That rule is !important, so no amount of added '
          + 'specificity on the reset will beat it — remove it or make the reset !important too.' : ''}`);
    }
  });

  test('a dismissed prompt reads as cancelled, not as a rejected credential', async () => {
    const { body } = await hitOn(pubPort, '/', { headers: { accept: 'text/html' } });
    assert.match(body, /NotAllowedError/);
    assert.match(body, /cancelled/i, 'telling someone their passkey failed when they hit Cancel is a lie');
  });
});
