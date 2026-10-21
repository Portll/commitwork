// fact: one 0x00 / git grep says "Binary file … matches" exit 0, ugrep shim skips it exit 1 — neither gateable (expiry: never, prev: unknown)
// fact: `\0` compiles to the same byte / fix changed no runtime value (expiry: never, prev: wrong)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// fact: exception without a reason is an unexplained failure with a name (expiry: never, prev: unknown)
const ALLOWED = new Map();

const TEXT = /\.(mjs|js|cjs|json|md|css|html|sh|yml|yaml|txt)$/;

const tracked = () =>
  execFileSync('git', ['-C', REPO, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter(Boolean);

// HEAD, NOT THE WORKING TREE.
//
// Reading `readFileSync(resolve(REPO, f))` for each tracked path checks the bytes ON THIS DISK, so
// the claim "no TRACKED source carries a raw NUL" would become "no file at a tracked path in MY
// worktree carries one". Those differ whenever the worktree and HEAD differ, which on a tree with
// concurrent writers is always: the gate could report GREEN over a HEAD that carries the exact byte
// it exists to forbid, while a fresh clone fails it.
//
// The same rule as bin/test/tracked-imports.test.mjs and bin/test/parse-gate.test.mjs, for the same
// stated reason: the property is about what a CLONE gets.
const headBlobs = () => {
  const entries = execFileSync('git', ['-C', REPO, 'ls-tree', '-r', 'HEAD', '--format=%(objectname) %(path)'],
    { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean)
    .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: l.slice(i + 1) }; })
    .filter((e) => TEXT.test(e.path));
  if (!entries.length) return new Map();
  // No `encoding` — the batch stream is length-delimited in BYTES and this tree is multi-byte
  // dense, so decoding first would put character offsets against byte lengths.
  const out = execFileSync('git', ['-C', REPO, 'cat-file', '--batch'],
    { input: `${entries.map((e) => e.sha).join('\n')}\n`, maxBuffer: 1 << 29 });
  const map = new Map();
  let off = 0;
  for (const e of entries) {
    const nl = out.indexOf(0x0a, off);
    const size = Number(out.toString('utf8', off, nl).split(' ')[2]);
    map.set(e.path, out.subarray(nl + 1, nl + 1 + size));
    off = nl + 1 + size + 1;
  }
  return map;
};

const HEAD = headBlobs();

function offenders(blobs = HEAD) {
  const out = [];
  for (const [f, buf] of blobs) {
    const at = buf.indexOf(0);
    if (at >= 0) out.push({ file: f, at, size: buf.length });
  }
  return out;
}

/** The worktree, for the diagnostic half only — never for an assertion. */
function worktreeOffenders() {
  const out = [];
  for (const f of tracked()) {
    if (!TEXT.test(f)) continue;
    let buf;
    try { buf = readFileSync(resolve(REPO, f)); } catch { continue; }   // deleted between list and read
    const at = buf.indexOf(0);
    if (at >= 0) out.push({ file: f, at, size: buf.length });
  }
  return out;
}

test('no tracked text source carries a raw NUL byte', () => {
  const bad = offenders().filter((o) => !ALLOWED.has(o.file));
  const detail = bad.map((o) => `  ${o.file} — NUL at byte ${o.at} of ${o.size}`).join('\n');
  assert.equal(bad.length, 0,
    `${bad.length} tracked source(s) carry a raw NUL byte:\n${detail}\n`
    + 'Every search tool will treat these as binary — git grep answers "Binary file … matches" and '
    + 'exits 0. Replace the byte with the two-character escape \\0, which compiles to the same byte '
    + 'and leaves the runtime value identical. If the byte is genuinely required, add the path to '
    + 'ALLOWED with the reason.');
});

test('every allowed exception is real and carries a reason', () => {
  // fact: stale exception is standing permission for whatever reuses that path (expiry: never, prev: unknown)
  const offending = new Set(offenders().map((o) => o.file));
  for (const [file, reason] of ALLOWED) {
    assert.equal(typeof reason === 'string' && reason.trim().length > 20, true,
      `${file}: exception needs a real reason, not a placeholder`);
    assert.equal(offending.has(file), true,
      `${file} is listed as an allowed NUL-carrier and no longer carries one — drop the exception `
      + 'rather than leaving permission lying around for whatever takes that path next.');
  }
});

test('NON-VACUITY: the HEAD walk actually read a tree', () => {
  // fact: an empty blob map reports every check clean (expiry: never, prev: unknown)
  // A silent enumeration failure — a renamed --format flag, an empty ls-tree, a mis-split batch
  // stream — turns every assertion in this file into a pass over nothing. That is the same shape as
  // the defect this walk replaced, one level up.
  assert.ok(HEAD.size > 300, `HEAD walk produced ${HEAD.size} text blobs — the gate is blind`);
  const total = [...HEAD.values()].reduce((n, b) => n + b.length, 0);
  assert.ok(total > 1_000_000, `HEAD blobs total ${total} bytes — the batch split is wrong`);
});

test('CONTROL: the detector finds a planted NUL and a planted hazard', () => {
  // Each pole asserted separately: one proves it can fire, the other that it does not always fire.
  //
  // THE PATTERN BELOW IS \u-ESCAPED. The literal character lands in the file as U+2028 and produces
  // an unterminated regex literal (`SyntaxError: Invalid regular expression: missing /`), the
  // failure described further down. The rule is not advisory.
  const planted = new Map([['x/planted.mjs', Buffer.from('ok\0bad\n')], ['x/clean.mjs', Buffer.from('ok\n')]]);
  assert.deepEqual(offenders(planted).map((o) => o.file), ['x/planted.mjs']);
  assert.deepEqual(carriers(/\u2028/, new Map([['x/ls.mjs', Buffer.from('a\u2028b')], ['x/ok.mjs', Buffer.from('ab')]])), ['x/ls.mjs']);
});

test('the WORKING TREE is reported but never asserted — in-flight edits are not gate failures', () => {
  // Deliberately diagnostic. On a shared tree an assertion here would be red continuously from
  // other writers' uncommitted work, and a permanently red gate is one nobody reads. The HEAD
  // assertion above is the gate; this is early warning.
  const wt = worktreeOffenders().filter((o) => !ALLOWED.has(o.file));
  if (wt.length) {
    process.stderr.write(`\n[no-nul] ${wt.length} raw NUL(s) in the WORKING TREE — in-flight, not a `
      + `gate failure, and not necessarily yours:\n${wt.map((o) => `  ${o.file} @ ${o.at}`).join('\n')}\n`);
  }
  assert.ok(Array.isArray(wt), 'the worktree walk must produce an answer');
});

test('the escape and a raw NUL are the same byte, so the fix changed no value', () => {
  const escaped = `a\0b`;
  assert.equal(escaped.length, 3);
  assert.equal(escaped.charCodeAt(1), 0);
  assert.deepEqual([...Buffer.from(escaped)], [97, 0, 98]);
});

// ── THE REST OF THE CHARACTER CLASS ─────────────────────────────────────────────────────────────
// G25 (write actuator alters authored content) covers the other invisibles as well as NUL, and
// asserting one member alone would read as if it covered the class.
//
// U+2028 IS NOT A THEORETICAL HAZARD. `.` in a JavaScript regular expression does not match a line
// separator, so a `String.replace` over source holding literal U+2028 and U+2029 silently skips
// those lines and can leave an unterminated regex literal. Every pattern below is therefore written
// with \u escapes and never with the character itself — a rule this file has to obey to be able to
// state it.
//
// U+001B (ESC) IS DELIBERATELY NOT A HAZARD. Tracked sources carry it as ANSI colour sequences in
// CLIs, which is the character doing its job. Excluding it is a DECISION, and
// it is recorded here rather than left as a silent gap in a regex range.
const HAZARDS = [
  {
    name: 'LINE_SEPARATOR U+2028',
    re: /\u2028/,
    why: 'a JavaScript line terminator: it ends a statement mid-expression, and `.` does not match it, so regex-based tooling reads straight past it',
    allowed: new Map(),
  },
  {
    name: 'PARAGRAPH_SEPARATOR U+2029',
    re: /\u2029/,
    why: 'the same, and it survives a JSON round trip that a raw newline would not',
    allowed: new Map(),
  },
  {
    name: 'BOM mid-file U+FEFF',
    re: /[^]\uFEFF/,
    why: 'a byte-order mark anywhere but offset 0 is a zero-width no-break space that no reader strips, so a string comparison fails on characters nobody can see',
    allowed: new Map(),
  },
  {
    name: 'C0 controls other than tab, LF, CR and ESC',
    re: /[\u0001-\u0008\u000B\u000C\u000E-\u001A\u001C-\u001F]/,
    why: 'a control byte in authored text is either a paste accident or a terminal escape that lost its ESC; neither survives a copy through a document',
    allowed: new Map(),
  },
  {
    name: 'ZERO WIDTH SPACE U+200B',
    re: /\u200B/,
    why: 'invisible, and it defeats every string match over the identifier it sits in',
    allowed: new Map([[
      'fixtures/injection-corpus/hidden-unicode.txt',
      'The injection corpus exists to carry hidden characters: this file is replayed through the '
      + 'prompt envelope by bin/test/injection-corpus.test.mjs, which asserts none survive.',
    ]]),
  },
];

const carriers = (re, blobs = HEAD) => {
  const out = [];
  for (const [f, buf] of blobs) {
    if (re.test(buf.toString('utf8'))) out.push(f);
  }
  return out;
};

for (const h of HAZARDS) {
  test(`no tracked text source carries ${h.name}`, () => {
    const bad = carriers(h.re).filter((f) => !h.allowed.has(f));
    assert.deepEqual(bad, [], `${h.name} — ${h.why}\ncarriers: ${bad.join(', ')}`);
  });
}

test('every character-class exception is real, reasoned, and still needed', () => {
  // fact: an exception outliving its carrier is standing permission for the next file at that path (expiry: never, prev: unknown)
  let checked = 0;
  for (const h of HAZARDS) {
    const present = new Set(carriers(h.re));
    for (const [file, reason] of h.allowed) {
      checked++;
      assert.ok(reason.trim().length > 40, `${file}: ${h.name} exception needs a real reason`);
      assert.ok(present.has(file),
        `${file} is an allowed ${h.name} carrier and no longer carries one — drop the exception.`);
    }
  }
  assert.ok(checked > 0, 'no exceptions checked — this test would pass over an empty allowlist');
});

test('FLOOR: every hazard pattern still matches its own character', () => {
  // fact: a zero over a pattern that stopped matching is indistinguishable from a clean tree (expiry: never, prev: unknown)
  const planted = {
    'LINE_SEPARATOR U+2028': 'a\u2028b',
    'PARAGRAPH_SEPARATOR U+2029': 'a\u2029b',
    'BOM mid-file U+FEFF': 'a\uFEFFb',
    'C0 controls other than tab, LF, CR and ESC': 'a\u0001b',
    'ZERO WIDTH SPACE U+200B': 'a\u200Bb',
  };
  for (const h of HAZARDS) {
    assert.ok(h.re.test(planted[h.name]), `${h.name}: the pattern no longer matches a planted instance`);
  }
  // …and does NOT match the characters authored text is made of, ESC included.
  for (const h of HAZARDS) {
    assert.equal(h.re.test('plain ascii\twith\ttabs\nand newlines\r\n'), false, `${h.name} fires on ordinary text`);
    assert.equal(h.re.test('colour \u001B[31mred\u001B[0m'), false, `${h.name} fires on an ANSI colour sequence`);
  }
  assert.equal(HAZARDS.length, 5);
});

test('a BOM at offset 0 is not the defect — only a mid-file one is', () => {
  const bom = HAZARDS.find((h) => h.name.startsWith('BOM'));
  assert.equal(bom.re.test('\uFEFFleading bom is legal'), false);
  assert.equal(bom.re.test('text with \uFEFF inside'), true);
});
