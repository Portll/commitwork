// node --test admin/test/ — the panel's WRITE path for operator judgements, and passkey enrolment.
//
// WHY THIS FILE EXISTS. The Mark FP button posted a body the store's validator refuses, so every
// judgement an operator recorded here returned HTTP 400 and the only trace was a dismissable
// alert(). The suite was green throughout: no test had ever asserted that what the panel SENDS is
// what the validator ACCEPTS. Each side was tested against its own idea of the contract.
//
// THE CENTRAL TEST DERIVES ITS EXPECTATION FROM THE VALIDATOR, NOT FROM THE DEFECT REPORT. It
// scrapes the field names out of the panel's real POST body, builds a record from them, and runs it
// through validateScannerAnnotation — the same function both writers call. A list of required
// fields hand-copied from the bug would certify exactly today's blind spot and pass forever after;
// this fails the moment the validator demands anything the panel cannot supply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateScannerAnnotation } from '../../monitor/annotate-lib.mjs';
import { identityFor } from '../../monitor/detail-schema.mjs';
import { panelSource } from './lib/panel-source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PANEL = panelSource('index.html');
const CSS = readFileSync(join(HERE, '..', 'static', 'panel.css'), 'utf8');

/** The object literal the panel POSTs to /api/annotations/scanner, as source text. */
function markFpBodySource() {
  const i = PANEL.indexOf("cwPost('/api/annotations/scanner'");
  assert.notEqual(i, -1, 'the panel no longer posts to /api/annotations/scanner — find the new call and repoint this test');
  const body = PANEL.slice(i, i + 900);
  const start = body.indexOf('JSON.stringify({');
  assert.notEqual(start, -1, 'could not find the JSON.stringify body of the Mark FP post');
  return body.slice(start);
}

/** Top-level `key:` names from that literal. */
function markFpFields() {
  const src = markFpBodySource();
  const seen = new Set();
  // top-level keys only: `word:` preceded by { or , at depth 1
  let depth = 0;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    else if (depth === 1) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(src.slice(i));
      if (m && /[{,]\s*$/.test(src.slice(Math.max(0, i - 40), i))) { seen.add(m[1]); i += m[0].length - 1; }
    }
  }
  return seen;
}

test('THE REGRESSION: what the panel sends satisfies the validator both writers share', () => {
  const fields = markFpFields();
  // `secrets` is the only category that renders the button today (extra:'ann'), so it is the one
  // the contract must hold for. identityFor() supplies its tuple rather than a hardcoded guess.
  const idf = identityFor('secrets');
  const record = { category: 'secrets' };
  const sample = {
    project: 'commitwork', category: 'secrets', repo: 'commitwork', rule: 'generic-api-key',
    file: 'bin/x.mjs', action: 'false-positive', reason: 'verified: a test fixture, not a credential',
    expires: '2026-12-31T00:00:00.000Z',
  };
  for (const f of fields) if (f !== 'project' && sample[f] !== undefined) record[f] = sample[f];
  // `who` and `at` are stamped by the SERVER from the session and the clock — the panel must never
  // send them, and the validator still requires them, so they are added here exactly as the route does.
  record.who = 'operator@example.test';
  record.at = new Date('2026-08-21T00:00:00Z').toISOString();

  const errs = validateScannerAnnotation(record, idf, { requireExpires: true });
  assert.deepEqual(errs, [], `the panel's POST body cannot satisfy the store's validator: ${errs.join('; ')}`);
});

test('the panel sends an expires — the field whose absence refused every judgement', () => {
  assert.ok(markFpFields().has('expires'),
    'no `expires` in the Mark FP body: an undated suppression is refused (requireExpires:true), so every judgement is lost');
});

test('the identity the panel sends is the full tuple for its category, and excludes line', () => {
  const fields = markFpFields();
  for (const f of identityFor('secrets')) {
    assert.ok(fields.has(f), `identity field '${f}' is missing from the POST body — the record would address nothing`);
  }
  assert.equal(fields.has('line'), false,
    'line must never be part of a finding identity: code moves for reasons unrelated to the finding, and a line-keyed suppression un-suppresses itself on the next edit above it');
});

test('the reason is collected INLINE, not through a modal that discards it on refusal', () => {
  const src = markFpBodySource();
  const handler = PANEL.slice(PANEL.indexOf('button.ann-fp'), PANEL.indexOf('button.ann-fp') + 4000);
  assert.equal(/prompt\(/.test(handler), false, 'the triage flow still uses prompt() — a refusal discards what was typed');
  assert.ok(/class="ann-reason"/.test(PANEL), 'no inline reason field');
  assert.ok(/class="ann-expires"/.test(PANEL), 'no inline expiry field');
  assert.ok(src.includes('reason'), 'the body no longer carries a reason');
});

// The save handler, bounded by its own closing `},false);` rather than by a character count. A
// fixed window silently stops covering the tail of the handler the moment anyone adds a branch —
// which is exactly what happened when the duplicate-suppression case was added and pushed the
// `unverified` rendering past 3000 chars. A guard that shrinks when the code grows is a guard that
// reports clean on the part nobody has looked at.
function saveHandler() {
  const i = PANEL.indexOf('button.ann-save');
  assert.notEqual(i, -1, 'the inline save handler is gone');
  const rest = PANEL.slice(i);
  const end = rest.indexOf('},false);');
  assert.notEqual(end, -1, 'could not find the end of the save handler — the bound below would be a guess');
  return rest.slice(0, end);
}

test('a refusal renders in the row as a state, never only as an alert()', () => {
  const save = saveHandler();
  assert.ok(/ann-msg/.test(save), 'refusals are not rendered into the row');
  assert.equal(/alert\(/.test(save), false, 'the save path still alerts — a dismissed dialog leaves no state behind');
});

test('matched===null renders as its own state, not as a plain success', () => {
  const save = saveHandler();
  assert.ok(/j\.matched\s*==\s*null/.test(save),
    'the null case is not distinguished: a record nothing could verify would render identically to a confirmed one');
  assert.ok(/unverified/.test(save), 'the unverified state is not named in the cell');
  assert.ok(/\.pill\.unk\{/.test(CSS), 'the unverified pill has no style, so it would render as an unstyled span');
});

// Same rule, third state: the server dedupes an already-suppressed identity and records the click
// as corroboration instead. The review date the operator just picked was NOT taken, so rendering
// this as "recorded ✓" would report a date they did not set.
test('a deduped duplicate renders as its own state, not as a plain success', () => {
  const save = saveHandler();
  assert.ok(/j\.duplicate/.test(save),
    'the duplicate case is not distinguished: a corroboration would render identically to a new suppression');
  assert.ok(/corroborated|already suppressed/i.test(save), 'the corroboration state is not named in the cell');
});

// The row the operator judged travels with the judgment. Identity still excludes it — this is the
// evidence half, and the store keeps it under a name the matcher cannot mistake for identity.
test('the POST carries the row line as evidence', () => {
  const i = PANEL.indexOf("cwPost('/api/annotations/scanner'");
  assert.notEqual(i, -1, 'the annotation POST is gone');
  const post = PANEL.slice(i, i + 900);
  assert.ok(/line\s*:/.test(post), 'the judged row is not sent, so no record can say which line was looked at');
});

// ── item 3: passkey enrolment ───────────────────────────────────────────────────────────────────

test('the enrolment ceremony reaches BOTH server stages', () => {
  assert.ok(PANEL.includes('/auth/passkey/register/begin'), 'register/begin is unreachable from the panel');
  assert.ok(PANEL.includes('/auth/passkey/register/finish'), 'register/finish is unreachable from the panel');
});

test('enrolment sends the password the server actually requires, not just a session', () => {
  const i = PANEL.indexOf('/auth/passkey/register/begin');
  const begin = PANEL.slice(i, i + 400);
  assert.ok(/password/.test(begin),
    'beginPasskeyRegistration({email, password}) re-authenticates — a session-only call returns "invalid credentials" every time');
  assert.ok(/email/.test(begin), 'no email sent to register/begin');
});

test('the enrolment control is hidden when it cannot succeed', () => {
  const i = PANEL.indexOf("pkWrap");
  assert.notEqual(i, -1, 'the enrolment wrapper is not wired');
  const wire = PANEL.slice(i, i + 600);
  assert.ok(/s\.authed/.test(wire), 'shown regardless of sign-in state — enrolment binds to an account');
  assert.ok(/PublicKeyCredential/.test(PANEL), 'shown without checking the browser can do WebAuthn');
});

test('the two base64 dialects are not mixed', () => {
  const i = PANEL.indexOf('pkB64uToBuf');
  assert.notEqual(i, -1, 'no base64url decoder for what the server sent');
  assert.ok(PANEL.includes('pkBufToB64'), 'no base64 encoder for what is sent back');
  const finish = PANEL.slice(PANEL.indexOf('/auth/passkey/register/finish'), PANEL.indexOf('/auth/passkey/register/finish') + 500);
  assert.ok(/pkBufToB64\(c\.response\.clientDataJSON\)/.test(finish),
    'clientDataJSON must go back as plain base64 — the server reads it with Buffer.from(x,"base64")');
  assert.ok(/pkBufToB64\(c\.response\.attestationObject\)/.test(finish), 'attestationObject must go back as plain base64');
});

test('a cancelled prompt is not reported as a rejected credential', () => {
  const i = PANEL.indexOf('NotAllowedError');
  assert.notEqual(i, -1, 'cancellation is not distinguished from failure — the operator would be told their authenticator is broken');
});

test('every CSS variable the new rules use is actually defined', () => {
  const rules = CSS.split('\n').filter((l) => /\.ann-|#pk-|#pkenroll|\.pk-fld|\.pill\.unk/.test(l)).join('\n');
  const used = [...rules.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0, 'the new rules reference no variables at all — did they land?');
  for (const v of new Set(used)) {
    assert.ok(new RegExp(`${v}\\s*:`).test(CSS), `${v} is used but never defined — the declaration silently does nothing`);
  }
});

// ── CANCEL RESTORES THE WHOLE CELL ──────────────────────────────────────────────────────────────
// Reported 2026-08-25: "clicking mark FP then clicking out loses the ability to check". The cancel
// handler rebuilt the FP button ALONE, so the check button and its verdict span were destroyed and
// never came back — the row could not be checked again until the entire table re-rendered.
//
// The comment above annButton already claimed the form "can restore it verbatim on cancel". The
// rule was written down and nothing enforced it, so when the check button was added beside the FP
// button the restore was never taught about it. This is that enforcer.
//
// Derived from the SOURCE, not from a copy of today's markup: both paths must call the same
// function, which is the property that makes drift impossible rather than merely unlikely.
const PANEL_SRC = panelSource('index.html');

test('the resting cell is built by ONE function, and cancel calls it', () => {
  assert.match(PANEL_SRC, /function annCellInner\(category,f\)\{/,
    'the resting state of the triage cell must live in one function');
  // annCell renders it...
  assert.match(PANEL_SRC, /return `<td>\$\{annCellInner\(category,f\)\}<\/td>`/,
    'annCell must render the shared resting state rather than spelling it out');
  // ...and so must the cancel handler.
  assert.match(PANEL_SRC, /td\.innerHTML=annCellInner\(d\.category,\{repo:d\.repo,rule:d\.rule,file:d\.file,line:d\.line\}\)/,
    'cancel must restore the SHARED cell, not a hand-written subset of it — rebuilding only the FP '
    + 'button is the defect this test exists for');
});

test('the resting cell carries all three parts, so a cancel cannot silently drop one', () => {
  const fn = PANEL_SRC.match(/function annCellInner\(category,f\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'annCellInner not found');
  for (const part of ['annButton(category,f)', 'checkButton(category,f)', 'llm-verdict']) {
    assert.ok(fn[0].includes(part), `the resting cell must include ${part}`);
  }
});

test('line is threaded to the form and back, or a restored check button asks about line 0', () => {
  // checkButton reads f.line; the form is the only carrier between render and restore.
  assert.match(PANEL_SRC, /class="ann-form"[^`]*data-line="\$\{esc\(d\.line\|\|0\)\}"/,
    'annForm must carry data-line, or cancel rebuilds the check button with line 0 and readContext '
    + 'clamps to line 1 — the model is then asked about the top of the file, which is a wrong '
    + 'answer rather than an error');
  assert.match(PANEL_SRC, /class="ann-fp"[^`]*data-line="\$\{esc\(f\.line\|\|0\)\}"/,
    'the FP button must carry data-line, since the form inherits its dataset from it');
});

// ── AN ANSWERED ROW KEEPS ITS CHECK ─────────────────────────────────────────────────────────────
// Reported 2026-08-25: "you can't machine-check what you've already answered". The annotation
// replaced the whole cell, so recording "false positive" removed the check button — and that is the
// row where a second opinion is worth most, because a suppression is the judgment that stops anyone
// else looking. The check writes nothing and cannot overturn the annotation; it can only disagree.
test('an annotated row still renders a check button beside its pill', () => {
  const fn = PANEL_SRC.match(/function annCell\(f,category\)\{[\s\S]*?\n\}/);
  assert.ok(fn, 'annCell not found');
  const annotatedBranch = fn[0].slice(fn[0].indexOf('if(f.annotation)'), fn[0].indexOf('return `<td>${annCellInner'));
  assert.ok(annotatedBranch.includes('checkButton(category,f)'),
    'the annotated branch must keep the check button — suppressing it means the machine can never '
    + 'audit a human suppression, which is the claim most worth auditing');
  assert.ok(annotatedBranch.includes('llm-verdict'),
    'and the verdict span, or the check has nowhere to render its answer');
});

test('the verdict renders its reasoning and source in the DOM, not only in a tooltip', () => {
  assert.match(PANEL_SRC, /class="llm-src"/,
    'the redacted source must be shown; a verdict whose evidence is out of reach is one the '
    + 'operator can only take on trust, and they are the adjudicator');
  assert.match(PANEL_SRC, /j\.excerpt\?/, 'the excerpt is rendered when the server sends one');
  assert.match(PANEL_SRC, /esc\(j\.excerpt\)/,
    'the excerpt is escaped — it is source text from a scanned repository and reaches innerHTML');
});
