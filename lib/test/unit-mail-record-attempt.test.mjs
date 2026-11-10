// Appends a record as one JSON line to the mail outbox file (lib/mail.mjs recordAttempt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAttempt } from '../mail.mjs';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('an empty outbox setting disables recording', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  try {
    const r = recordAttempt({ id: 1 }, { env: { CW_MAIL_OUTBOX: '' } });
    assert.deepEqual(r, { recorded: false, reason: 'disabled', outbox: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a null outbox setting disables recording', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  try {
    const r = recordAttempt({ id: 2 }, { env: { CW_MAIL_OUTBOX: null } });
    assert.deepEqual(r, { recorded: false, reason: 'disabled', outbox: null });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a record is written as one JSON line with owner-only permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  const outbox = join(dir, 'outbox.jsonl');
  try {
    const r = recordAttempt({ id: 3, subject: 'test' }, { env: { CW_MAIL_OUTBOX: outbox } });
    assert.deepEqual(r, { recorded: true, outbox });
    assert.equal(readFileSync(outbox, 'utf8'), '{"id":3,"subject":"test"}\n');
    assert.equal(statSync(outbox).mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing nested parent directories are created before writing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  const outbox = join(dir, 'a', 'b', 'outbox.jsonl');
  try {
    const r = recordAttempt({ id: 4 }, { env: { CW_MAIL_OUTBOX: outbox } });
    assert.deepEqual(r, { recorded: true, outbox });
    assert.equal(readFileSync(outbox, 'utf8'), '{"id":4}\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a second record is appended after the first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  const outbox = join(dir, 'outbox.jsonl');
  try {
    const r1 = recordAttempt({ id: 7 }, { env: { CW_MAIL_OUTBOX: outbox } });
    const r2 = recordAttempt('x'.repeat(3), { env: { CW_MAIL_OUTBOX: outbox } });
    assert.deepEqual(r1, { recorded: true, outbox });
    assert.deepEqual(r2, { recorded: true, outbox });
    assert.equal(readFileSync(outbox, 'utf8'), '{"id":7}\n"xxx"\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an outbox path that is a directory reports the EISDIR code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  const outbox = join(dir, 'adir');
  try {
    mkdirSync(outbox);
    let msg;
    try {
      appendFileSync(outbox, '');
    } catch (e) {
      msg = e.message;
    }
    const r = recordAttempt({ id: 6 }, { env: { CW_MAIL_OUTBOX: outbox } });
    assert.deepEqual(r, { recorded: false, reason: 'EISDIR', detail: `${outbox}: ${msg}`, outbox });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an error without a code is reported with the generic error reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recordAttempt-'));
  const outbox = join(dir, 'm', 'outbox.jsonl');
  try {
    const r = recordAttempt({ n: 1n }, { env: { CW_MAIL_OUTBOX: outbox } });
    assert.deepEqual(r, {
      recorded: false,
      reason: 'error',
      detail: `${outbox}: Do not know how to serialize a BigInt`,
      outbox,
    });
    assert.equal(existsSync(join(dir, 'm')), true);
    assert.equal(existsSync(outbox), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
