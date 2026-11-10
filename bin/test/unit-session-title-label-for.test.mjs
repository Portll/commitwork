// Labels a session id as its 8-char short id plus quoted title when one exists (bin/session-title.mjs labelFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { labelFor } from '../session-title.mjs';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function withSessions(files, fn) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'labelFor-')));
  const savedHome = process.env.HOME;
  const savedCfg = process.env.CLAUDE_CONFIG_DIR;
  try {
    const cwd = join(dir, 'repo');
    mkdirSync(cwd, { recursive: true });
    process.env.HOME = dir;
    process.env.CLAUDE_CONFIG_DIR = join(dir, '.claude');
    const slugs = new Set([
      cwd.replace(/[^a-zA-Z0-9]/g, '-'),
      cwd.split('/').join('-'),
      cwd.replace(/[/.]/g, '-'),
    ]);
    const targets = [cwd, join(cwd, 'transcripts'), ...[...slugs].map((s) => join(dir, '.claude', 'projects', s))];
    for (const t of targets) {
      mkdirSync(t, { recursive: true });
      for (const [name, body] of Object.entries(files)) writeFileSync(join(t, name), body);
    }
    return fn(cwd);
  } finally {
    restoreEnv('HOME', savedHome);
    restoreEnv('CLAUDE_CONFIG_DIR', savedCfg);
    rmSync(dir, { recursive: true, force: true });
  }
}

const line = (o) => JSON.stringify(o) + '\n';

test('a session with a custom title is labelled with its first eight characters and the quoted title', () => {
  const id = 'abcdef12-3456-7890-abcd-ef1234567890';
  const r = withSessions({ [`${id}.jsonl`]: line({ type: 'custom-title', customTitle: 'My Title' }) },
    (cwd) => labelFor(id, cwd));
  assert.equal(r, 'abcdef12 ("My Title")');
});

test('a session with only an ai title is labelled with the ai title', () => {
  const id = '12345678-90ab-cdef-1234-567890abcdef';
  const r = withSessions({ [`${id}.jsonl`]: line({ type: 'ai-title', aiTitle: 'AI Generated' }) },
    (cwd) => labelFor(id, cwd));
  assert.equal(r, '12345678 ("AI Generated")');
});

test('a custom title takes precedence over an ai title in the label', () => {
  const id = 'aabbccdd-eeff-0011-2233-445566778899';
  const body = line({ type: 'ai-title', aiTitle: 'AI Title' }) + line({ type: 'custom-title', customTitle: 'Custom Title' });
  const r = withSessions({ [`${id}.jsonl`]: body }, (cwd) => labelFor(id, cwd));
  assert.equal(r, 'aabbccdd ("Custom Title")');
});

test('the last custom title in the transcript is the one shown', () => {
  const id = '11112222-3333-4444-5555-666677778888';
  const body = line({ type: 'custom-title', customTitle: 'First' }) + line({ type: 'custom-title', customTitle: 'Second' });
  const r = withSessions({ [`${id}.jsonl`]: body }, (cwd) => labelFor(id, cwd));
  assert.equal(r, '11112222 ("Second")');
});

test('a longer id sharing the first eight characters finds the titled session and labels it', () => {
  const id = '9a8b7c6d-0000-1111-2222-333344445555';
  const r = withSessions({ [`${id}.jsonl`]: line({ type: 'custom-title', customTitle: 'Short Hit' }) },
    (cwd) => labelFor('9a8b7c6d-ffff', cwd));
  assert.equal(r, '9a8b7c6d ("Short Hit")');
});

test('a session with no title lines is labelled with only its first eight characters', () => {
  const id = 'fedcba98-7654-3210-fedc-ba9876543210';
  const r = withSessions({ [`${id}.jsonl`]: line({ type: 'message', content: 'hello' }) },
    (cwd) => labelFor(id, cwd));
  assert.equal(r, 'fedcba98');
});

test('an id with no transcript is labelled with only its first eight characters', () => {
  const r = withSessions({}, (cwd) => labelFor('0badc0de-0000-0000-0000-000000000000', cwd));
  assert.equal(r, '0badc0de');
});

test('a nine character id with no transcript is cut to eight characters', () => {
  const r = withSessions({}, (cwd) => labelFor('abcdefghi', cwd));
  assert.equal(r, 'abcdefgh');
});

test('a null id is labelled with the string null', () => {
  const r = withSessions({}, (cwd) => labelFor(null, cwd));
  assert.equal(r, 'null');
});

test('an empty id is labelled with the empty string', () => {
  const r = withSessions({}, (cwd) => labelFor('', cwd));
  assert.equal(r, '');
});
