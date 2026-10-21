// bin/stub-detect.mjs + the stub allowlist — whose findings a suppression may silence, and how much
// at once. The allowlist is ALWAYS read from commitwork's own private dir (never the scanned tree)
// while pathGlob matches the SCANNED repo's path, so scope, marker and repo must all be named.
// The operator's allowlist is a private record; these scans run on the shipped example, and the
// entry checks run on the example and on the private record when it is present.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubAllowlistPathFor } from '../../monitor/store-paths.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SCANNER = path.join(ROOT, 'bin', 'stub-detect.mjs');
const EXAMPLE = path.join(ROOT, 'monitor', 'stub-allowlist.example.json');
function privateAllowlist() {
  try { return JSON.parse(fs.readFileSync(stubAllowlistPathFor(ROOT), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && !process.env.CW_STUB_ALLOWLIST) return null; throw e; }
}
const docs = [['example', JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'))], ['private', privateAllowlist()]].filter(([, d]) => d);

let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-stub-')); });
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
function project(name, files) {
  const dir = path.join(tmp, `case${n++}`, name);
  for (const [rel, body] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return dir;
}

const scan = async (dir, allowlist = EXAMPLE) => {
  const r = await run('node', [SCANNER, dir], { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, CW_STUB_ALLOWLIST: allowlist } });
  return { json: JSON.parse(r.stdout), stderr: r.stderr || '' };
};

describe("one project's suppression cannot silence another's findings", () => {
  test('a foreign project with a cra/ directory keeps its markers', async () => {
    const dir = project('other-project', {
      'cra/thing.mjs': '// TODO: genuinely unfinished work in someone else\'s repo\nconst x = 1;\n',
    });
    const { json } = await scan(dir);
    assert.equal(json.summary.findings, 1,
      "commitwork's cra/*.mjs entry used to match this file and delete the finding");
    assert.equal(json.findings[0].marker, 'TODO');
  });

  test('the entries it skipped are named — out of scope is not the same as absent', async () => {
    const dir = project('other-project', { 'cra/thing.mjs': '// TODO: x\n' });
    const { stderr } = await scan(dir);
    assert.match(stderr, /scoped to commitwork — not applied to other-project/,
      'otherwise a count that differs between two projects looks like a difference in the code');
  });

  test('a repo-local allowlist is deliberately NOT merged from the scanned tree', async () => {
    // A scanned repo that can ship its own suppressions can silence its own findings. Same reason
    // repo-local manifests need --trust-repo-manifest.
    const dir = project('sneaky', {
      'cra/thing.mjs': '// TODO: hide me\n',
      'monitor/stub-allowlist.json': JSON.stringify({ allow: [{ pathGlob: '**', reason: 'all clear!' }] }),
      '.stub-allowlist.json': JSON.stringify({ allow: [{ pathGlob: '**', reason: 'all clear!' }] }),
    });
    const { json } = await scan(dir);
    assert.ok(json.summary.findings >= 1, 'a scanned tree must not be able to allowlist itself');
  });

  test("commitwork's own scan still applies its own entries", async () => {
    const { json } = await scan(ROOT);
    const craSrc = json.findings.filter((f) => /^cra\/[^/]+\.mjs$/.test(f.path));
    assert.deepEqual(craSrc, [], 'the CRA template scaffolding stays suppressed for commitwork itself');
  });
});

describe('a suppression is no broader than its stated reason', () => {
  test('every entry names the marker it suppresses', () => {
    for (const [label, doc] of docs) for (const [i, a] of (doc.allow || []).entries()) {
      assert.ok(a.marker,
        `${label} allow[${i}] (${a.pathGlob}) omits marker, so by the scanner's contract it suppresses EVERY `
        + 'marker on that path — FIXME, HACK, not-implemented and the rest');
    }
  });

  test('every entry names the repo it applies to', () => {
    for (const [label, doc] of docs) for (const [i, a] of (doc.allow || []).entries()) {
      assert.ok(a.repo, `${label} allow[${i}] (${a.pathGlob}) declares no repo`);
    }
  });

  test('every entry carries a reason — a suppression without one is indistinguishable from a bug', () => {
    for (const [label, doc] of docs) for (const [i, a] of (doc.allow || []).entries()) {
      assert.ok(a.reason && a.reason.trim().length > 20, `${label} allow[${i}] has no substantive reason`);
    }
  });

  test('a marker outside the stated rationale surfaces in cra/', async () => {
    // proven against a fixture so the pin does not depend on the live tree containing a FIXME
    const dir = project('commitwork-like', {
      'cra/gen.mjs': '// FIXME: this is real unfinished code\n// TODO: [HUMAN] fill this in\n',
    });
    const { json } = await scan(dir);
    const markers = json.findings.map((f) => f.marker).sort();
    assert.ok(markers.includes('FIXME'), 'a genuine FIXME must not be absorbed by a template allowlist');
  });
});

describe('the rationale reaches the operator', () => {
  test('the comment key is the one the panel reads', () => {
    // admin/serve.mjs surfaces `_comment || note` — `$comment` never reached the panel
    for (const [label, doc] of docs) {
      assert.ok(doc._comment, `${label}: panel reads _comment (or note); $comment never reached it`);
      assert.equal(doc.$comment, undefined, `${label}: and the old key is gone, not duplicated`);
    }
  });

  test('it is keyed the same way as the sibling judgment ledgers', () => {
    // The live ledgers are private records; their shipped examples carry the same keying.
    for (const f of ['annotations.example.json', 'gate-exemptions.example.json']) {
      const sib = JSON.parse(fs.readFileSync(path.join(ROOT, 'monitor', f), 'utf8'));
      assert.ok(sib._comment, `${f} uses _comment — the three ledgers must agree`);
    }
  });
});

describe('corrupt allowlist is attributed, not silent', () => {
  test('with corrupt allowlist, markers still fire and allowlistUnreadable is present', async () => {
    const corruptAllowlist = path.join(tmp, 'corrupt-allowlist.json');
    fs.writeFileSync(corruptAllowlist, 'not valid json at all');

    const dir = project('corrupt-test', {
      'src/main.mjs': '// TODO: fix this\nconst x = 1;\n',
    });

    const r = spawnSync('node', [SCANNER, dir], {
      maxBuffer: 32 * 1024 * 1024,
      encoding: 'utf8',
      env: { ...process.env, CW_STUB_ALLOWLIST: corruptAllowlist },
    });
    const json = JSON.parse(r.stdout);
    const stderr = r.stderr || '';

    assert.ok(json.summary.findings >= 1, 'markers fire even with corrupt allowlist');
    assert.equal(json.allowlistUnreadable, true, 'allowlistUnreadable flag present');
    assert.match(stderr, /failed to read allowlist/, 'stderr names the error');
    assert.match(stderr, /corrupt-allowlist.json/, 'stderr names the file');
  });
});
