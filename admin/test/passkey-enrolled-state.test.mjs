// The enrolled state, and the two things whose ABSENCE made the enrol control look broken.
//
// admin/test/passkey.test.mjs already proves the ceremony: challenges bind, an assertion signed for
// another relying party is refused, a clone trips the counter, re-enrolling updates rather than
// appends. All of it passed while an operator could not enrol a fingerprint, because none of it
// touches the two questions the PANEL has to answer:
//
//   1. What is already enrolled? /auth/session reported nothing, so "you have a passkey" and "you
//      have never had one" were the same panel, and the only sentence the menu could form was an
//      offer to add one — which is what "it loops through the same behaviour even when enrolled"
//      describes. A ceremony that works and a UI that cannot report its result are, from the
//      operator's chair, indistinguishable from a ceremony that does nothing.
//
//   2. Can the ceremony succeed from THIS origin? A WebAuthn RP ID is a domain. Opened at
//      http://127.0.0.1:7878 the server derives the RP ID '127.0.0.1' — an IP literal — and the
//      failure arrived as a bare DOMException after the operator had typed their password and
//      dismissed a system prompt. Nothing named the origin, and nothing named the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync, chmodSync } from 'node:fs';
import { denyRead, ignoresPermissions, REFUSED_ERRNO } from '../../lib/fs-unreadable.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { panelSource } from './lib/panel-source.mjs';
import { serverSource } from './lib/server-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ADMIN = join(HERE, '..');
const SRC = panelSource('index.html');
const SERVE = serverSource();

const STORE = join('/tmp', `cw-pk-state-${process.pid}.json`);
process.env.CW_AUTH_STORE = STORE;
const auth = await import('../auth.mjs');

test.after(() => { try { _deny.restore(); rmSync(STORE, { force: true }); } catch { /* gone */ } });

// ── 1. the three-valued inventory ─────────────────────────────────────────────────────────────
test('listPasskeys tells "none enrolled" apart from "not established"', () => {
  auth.bootstrapRoot({ email: 'a@example.com', password: 'correct horse battery staple' });

  // The account exists and has no passkeys. This is a MEASUREMENT and renders as one.
  assert.deepEqual(auth.listPasskeys('a@example.com'), [],
    'a known account with no passkeys must report an empty list, not null');

  // These are NOT measurements, and the old `u?.passkeys || []` returned [] for both — so an
  // account that does not exist reported, confidently, that it had nothing enrolled.
  assert.equal(auth.listPasskeys('nobody@example.com'), null, 'an unknown account is not an account with zero passkeys');
  assert.equal(auth.listPasskeys(undefined), null, 'no email is not an account with zero passkeys');
  assert.equal(auth.listPasskeys(''), null);
});

test('an unreadable store is unknown, never zero', () => {
  // Fail closed, the house rule. loadStore() throws on anything but ENOENT; if that throw escaped
  // or were swallowed to [], a panel whose store had gone unreadable would report a clean
  // "no passkeys enrolled" about an account it could not see.
  const _deny = denyRead(STORE);

  assert.ok(_deny.ok, `could not make the fixture unreadable: ${_deny.why} — the precondition failed, so this test proves nothing`);
  let out, threw = null;
  try { out = auth.listPasskeys('a@example.com'); } catch (e) { threw = e; }
  _deny.restore();
  assert.equal(threw, null, 'listPasskeys threw instead of reporting unknown — the caller renders nothing at all');
  assert.equal(out, null, 'an unreadable store reported a list; absence of evidence became evidence of absence');
});

test('the inventory never carries key material', () => {
  // credentialId IS carried — revoking names one and there is nothing else to name it by. The
  // secret-shaped fields are not.
  const rows = auth.listPasskeys('a@example.com');
  assert.ok(Array.isArray(rows));
  for (const r of rows) {
    assert.equal(r.publicKeyJwk, undefined);
    assert.equal(r.publicKey, undefined);
    assert.equal(r.signCount, undefined);
  }
});

// ── 2. the panel is actually told ─────────────────────────────────────────────────────────────
test('/auth/session reports the inventory and the relying party', () => {
  const at = SERVE.indexOf("pathname === '/auth/session'");
  assert.ok(at > -1, 'the session route moved — this test no longer knows what it is reading');
  const block = SERVE.slice(at, SERVE.indexOf('\n  }', at));
  assert.match(block, /passkeys: s \? listPasskeys\(s\.user\) : null/,
    'the session payload does not carry the passkey inventory, so the panel cannot tell enrolled from never-enrolled');
  assert.match(block, /rpId: rpFor\(/,
    'the session payload does not carry the relying-party id, so the panel cannot check the origin before prompting');
  assert.match(block, /declaredHosts/,
    'without the declared hostnames a refusal cannot name the origin that would work');
});

test('the panel distinguishes all three inventory states rather than two', () => {
  // Array.isArray, not a truthiness test: `[]` is truthy in JS and `null` is falsy, so `s.passkeys
  // ? ... : ...` would have collapsed "measured zero" onto the unknown branch — the same merge in a
  // new place. The renderer must branch on null FIRST and on length SECOND.
  assert.match(SRC, /Array\.isArray\(s\.passkeys\)\s*\?\s*s\.passkeys\s*:\s*null/,
    'the panel does not narrow the inventory with Array.isArray — a truthiness check merges [] with null');
  assert.match(SRC, /passkey state unknown/, 'no unknown state is rendered');
  assert.match(SRC, /no passkeys enrolled/, 'no measured-zero state is rendered');
  assert.match(SRC, /Add another passkey/, 'the offer does not change once something is enrolled — the loop is intact');
  for (const cls of ['pk-dot unk', 'pk-dot none', 'pk-dot on']) {
    assert.ok(SRC.includes(cls), `the ${cls} state has no marker in the markup or the renderer`);
  }
  const CSS = readFileSync(join(ADMIN, 'static', 'panel.css'), 'utf8');
  for (const rule of [/\.pk-dot\.unk\{/, /\.pk-dot\.none\{/, /\.pk-dot\.on\{/]) {
    assert.match(CSS, rule, 'a passkey state class has no rule — it would paint identically to its neighbour');
  }
});

// ── 3. the origin is checked BEFORE the operator is asked for anything ────────────────────────
test('the pre-flight WARNS and never vetoes — the browser decides', () => {
  // THIS ASSERTION USED TO SAY THE OPPOSITE, and the reversal is the finding.
  //
  // It required pkBlocker() to "gate both opening the form and submitting it". That gate meant
  // pressing enrol at an IP-literal origin failed with NO fingerprint prompt ever shown — the
  // operator's report was "the enrol action doesn't prompt before failing", and they were right.
  //
  // The gate encoded an INFERENCE about browser behaviour, not a measurement: nobody here ever
  // observed a browser reject an IP-literal RP ID, it was reasoned that one would. Worse, the veto
  // prevented the only experiment that could settle it, so a guess about the platform became an
  // unfalsifiable rule inside our own code — and a test asserting the veto made restoring it the
  // obvious "fix" for whoever hit this next.
  //
  // The pre-flight still runs and still says what it thinks. It just no longer stands between the
  // operator and their authenticator.
  const bodyOf = (needle) => { const a = SRC.indexOf(needle); return SRC.slice(a, a + 1400); };
  for (const [where, needle] of [['opening the form', 'if(pkAdd) pkAdd.onclick='],
                                 ['submitting', 'const warn2=pkBlocker()']]) {
    const body = bodyOf(needle);
    assert.match(body, /pkBlocker\(\)/, `the pre-flight no longer runs when ${where}`);
    assert.ok(!/if\s*\(\s*(blocked|warn|warn2)\s*\)\s*\{[^}]*return\s*;?\s*\}/.test(body),
      `the pre-flight VETOES when ${where} — it must warn and let credentials.create() answer`);
  }
  assert.match(SRC, /Trying anyway; the browser decides|Asking your authenticator anyway/,
    'the warning does not tell the operator the ceremony is still being attempted');
});

test('the pre-flight still names the IP-origin condition and its fix', () => {
  assert.match(SRC, /function pkBlocker\(\)/, 'there is no pre-flight check at all');
  assert.match(SRC, /isSecureContext/, 'a non-secure context is not detected before prompting');
  assert.match(SRC, /isIpHost\(location\.hostname\)/, 'an IP-address origin is not detected — the case that actually bites on 127.0.0.1');
  // The refusal has to name the fix. "Enrolment failed" for a wrong URL is the failure being
  // reported, not the reason.
  const at = SRC.indexOf('function pkBlocker()');
  const body = SRC.slice(at, SRC.indexOf('\n  }', at));
  assert.match(body, /localhost/, 'the IP-origin refusal does not name localhost, which is the one-line fix');
  // And it must run before the ceremony, not only when the form opens.
  assert.ok(SRC.split('pkBlocker()').length - 1 >= 3,
    'pkBlocker is called fewer than twice — it must still RUN at both points, to warn');
});

test('every credentials.create() failure is named, not collapsed into "enrolment failed"', () => {
  // Six conditions with six different fixes shared one sentence. InvalidStateError in particular
  // means "you already did this", which read as a broken authenticator.
  for (const name of ['NotAllowedError', 'InvalidStateError', 'SecurityError', 'NotSupportedError', 'ConstraintError']) {
    assert.ok(SRC.includes(name), `${name} is not distinguished — it would surface as a generic failure`);
  }
  // The unknown case must still carry the exception name, or a novel failure is unreportable.
  assert.match(SRC, /msg=\(n\?n\+': ':''\)/, 'an unrecognised DOMException does not carry its name into the message');
});

test('the authenticator kind is stated, so the platform one is actually offered', () => {
  // With no authenticatorAttachment the browser opens its generic chooser, which on macOS Chrome
  // leads with a phone and a QR code. "I cannot enrol my fingerprint" is the expected result of
  // leaving this unspecified.
  assert.match(SRC, /authenticatorAttachment:'platform'/, 'platform attachment is never requested, so Touch ID may never be offered');
  assert.match(SRC, /authenticatorAttachment:'cross-platform'/, 'there is no way to ask for a security key or phone');
  assert.match(SRC, /id="pk-roaming"/, 'the choice exists in code but the operator cannot make it');
});

// ── 4. the other half of the loop: a passkey could be added and never removed ─────────────────
test('removePasskey is reachable over HTTP and from the panel', () => {
  // It has been implemented, tested and password-gated since passkeys landed, with no route and no
  // control — so from the panel a passkey could be added and never replaced. A capability nothing
  // can reach is the same as one that was never built, and costs more because it reads as done.
  assert.equal(typeof auth.removePasskey, 'function');
  assert.match(SERVE, /stage === 'revoke'/, 'no route reaches removePasskey');
  assert.match(SERVE, /removePasskeyAsync\(\{ email: b\.email, credentialId: b\.credentialId, password: b\.password, reauthenticated: freshR \},/,
    'the revoke route does not pass BOTH proofs through — removal must re-authenticate, and an SSO '
    + 'account has no password to offer, so the fresh-reauth marker is the only proof it can give');
  assert.match(SRC, /'\/auth\/passkey\/revoke'/, 'the panel never calls the revoke route');
  assert.match(SRC, /class="pk-rm"/, 'there is no per-passkey remove control');
});

test('a revocation names one credential and holds it across a re-render', () => {
  // The id is captured when the row is clicked, not read back at confirm time: initOauth() re-renders
  // this list, and a second read could name whichever passkey had moved into that position.
  assert.match(SRC, /let pkPending=null;/, 'the pending revocation is not held outside initOauth, so a refresh clears it mid-flow');
  assert.match(SRC, /pkPending=\{cid:b\.dataset\.cid/, 'the credential id is not captured at selection time');
});

test('the confirmation outlives the refresh that proves it', () => {
  // Both flows re-read /auth/session so the list updates. initOauth() clears #pk-msg on its way
  // through, so a success line said BEFORE the refresh is erased by it — and the operator sees the
  // same screen as before, which is the exact silence being fixed.
  // Asserted as an ORDERING inside each handler, not as adjacent text: a comment between the two
  // lines is normal here and a text-adjacency pattern fails on it while the code is correct — which
  // is a guard that reports on its own formatting rather than on the behaviour.
  const orderedIn = (from, to, say) => {
    const start = SRC.indexOf(from);
    assert.ok(start > -1, `${from} not found — the handler was renamed and this test is measuring nothing`);
    // Search for the closing anchor FROM the handler's start: `}catch(...){` occurs many times
    // earlier in this file, and a bare indexOf returns the first one, slicing backwards to nothing.
    const block = SRC.slice(start, SRC.indexOf(to, start));
    assert.ok(block.length > 200 && block.length < 12000, `the ${from} handler did not slice sensibly (${block.length} chars)`);
    const refresh = block.indexOf('await initOauth()');
    const speak = block.indexOf(say);
    assert.ok(refresh > -1, `${from} never re-reads the session, so the list it just changed is stale`);
    assert.ok(speak > -1, `${from} never confirms success`);
    assert.ok(refresh < speak,
      `${from} confirms success BEFORE re-reading the session — initOauth() clears #pk-msg, so the refresh erases the confirmation and the operator sees the same screen as before`);
  };
  orderedIn('if(pkGo) pkGo.onclick=', '}catch(err){', "pkSay('ok','passkey enrolled");
  orderedIn('if(pkRevGo) pkRevGo.onclick=', '}catch(e){', "pkSay('ok','removed");
});

test('the enrolment control is a fingerprint, and it is reachable', () => {
  // The operator met this as a menu row reading "Add a passkey" — a word for a thing they have only
  // ever encountered as a touch sensor. The mark is the affordance.
  assert.match(SRC, /id="pk-add" class="pk-fp"/, 'the enrol control is not the fingerprint button');
  assert.match(SRC, /<svg viewBox="0 0 24 24"/, 'the fingerprint mark is not inline SVG');
  assert.ok(!/pk-fp[^>]*src=|<img[^>]*fingerprint/i.test(SRC), 'the mark is loaded rather than inline — no CDN, no icon font');
  const CSS = readFileSync(join(ADMIN, 'static', 'panel.css'), 'utf8');
  assert.match(CSS, /\.pk-fp\{[^}]*border-radius/, 'the button has no rounded corner rule');
  assert.match(CSS, /\.pk-fp\{[^}]*min-height:2\.75rem/, 'the button is under the 24px target floor (WCAG 2.5.8)');
});

test('an element hidden by class is not outranked by an ID rule that sets display', () => {
  // THE BUG THAT MADE THE MENU UNUSABLE. #pk-revoke shipped with class="jshide" and had an ID rule
  // setting display:flex. An ID selector is (1,0,0) and .jshide is (0,1,0), so the layout won and
  // the REMOVE form sat permanently open above the enrol control — the operator typed a password
  // into it with nothing selected and got "nothing selected to remove".
  //
  // #pk-form has the identical shape and escaped only because its JS writes an inline
  // style.display. That is luck, not design, so the whole class is checked rather than the instance.
  const CSS = readFileSync(join(ADMIN, 'static', 'panel.css'), 'utf8');
  const ids = new Set();
  for (const m of SRC.matchAll(/<[^>]*\bid="([\w-]+)"[^>]*\bclass="([^"]*)"/g)) {
    if (/\b(jshide|vhide)\b/.test(m[2])) ids.add(m[1]);
  }
  for (const m of SRC.matchAll(/<[^>]*\bclass="([^"]*)"[^>]*\bid="([\w-]+)"/g)) {
    if (/\b(jshide|vhide)\b/.test(m[1])) ids.add(m[2]);
  }
  assert.ok(ids.size >= 10, `only ${ids.size} class-hidden ids parsed — the extractor is broken and this would pass vacuously`);
  const unbeatable = [];
  for (const id of ids) {
    const rule = new RegExp(`#${id}\\{([^}]*)\\}`).exec(CSS);
    if (!rule || !/display\s*:/.test(rule[1])) continue;
    if (new RegExp(`#${id}(\\.jshide|\\.vhide|\\[hidden\\])`).test(CSS)) continue;
    unbeatable.push(id);
  }
  assert.deepEqual(unbeatable, [],
    `these ship hidden by class but an ID rule sets display and outranks it, so they render anyway: ${unbeatable.join(', ')}. `
    + 'Add #<id>.jshide{display:none}, or drive the element with an inline style.display.');
});
