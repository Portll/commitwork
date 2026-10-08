// lib/secrets.mjs resolves CW_SECRETS_FILE when it is called, not when it is imported.
//
// The module is imported BEFORE the variable is set, which is the order that used to read the
// operator's real ref table: the path was fixed at import, so a later override did nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { loadTable, secretsFile } = await import('../secrets.mjs');

test('a CW_SECRETS_FILE set after import is the table every default reads', (t) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-secrets-calltime-'));
  const prev = process.env.CW_SECRETS_FILE;
  t.after(() => {
    if (prev === undefined) delete process.env.CW_SECRETS_FILE; else process.env.CW_SECRETS_FILE = prev;
    rmSync(d, { recursive: true, force: true });
  });
  const table = join(d, 'secrets.json');
  writeFileSync(table, JSON.stringify({ version: 1, secrets: { CWFX_CALLTIME: `file:${join(d, 'cred.toml')}#k` } }));
  process.env.CW_SECRETS_FILE = table;
  assert.equal(secretsFile(), table);
  assert.deepEqual(Object.keys(loadTable().secrets), ['CWFX_CALLTIME']);
});
