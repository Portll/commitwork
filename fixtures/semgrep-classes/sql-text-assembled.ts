// Annotated fixture for manifests/semgrep-classes/sql-text-assembled.yaml.
export async function examples(db: any, name: string, table: string, ids: string[], i: number) {
  // ruleid: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  await db.query(`SELECT * FROM users WHERE name = '${name}'`);

  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const sql = "DELETE FROM " + table + " WHERE id = 1";
  await db.run(sql);

  // ruleid: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  const byId = "SELECT * FROM users WHERE id = " + name;
  await db.run(byId);

  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  await db.prepare(`SELECT id FROM tasks WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);

  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const numbered = `INSERT INTO t (a) VALUES ($${i + 1})`;

  // ruleid: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  const listed = `insert into stage (batch, records) values (${i}, ${name})`;

  // ok: cw-sql-text-assembled-js
  const prose = `Select a file from ${table}`;

  // ok: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  throw new Error(`SELECT failed for ${name}`);
}

export async function safe(db: any, name: string) {
  // ok: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  await db.query("SELECT * FROM users WHERE id = $1", [name]);
  // ok: cw-sql-text-assembled-js
  const label = `Update ${name} settings`;
  // ok: cw-sql-text-assembled-js
  const msg = `ROLLBACK refused: ${name}`;
  // ok: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  const constant = "SELECT 1 FROM " + "dual";
  // ok: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  const twoLiterals = "INSERT INTO visits (day) VALUES (?1) " + "ON CONFLICT(day) DO UPDATE SET n = n + 1";
}

export function quoteParity(db: any, where: string[], cols: string[], personPlaceholders: string, lookupField: string, escapedValue: string, n: number, m: number) {
  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const a = `SELECT key FROM mirror WHERE state='failed' ORDER BY updated_at LIMIT ${RETRY_LIMIT}`;
  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const b = `SELECT * FROM journal WHERE ${where.join(' AND ')} ORDER BY seq`;
  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const c = `INSERT INTO session_tokens (transcript, path, ${cols.join(', ')}, counted_at) VALUES (?, ?, ?, ?)`;
  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const d = `INSERT INTO persons (${cols.join(', ')}) VALUES (${personPlaceholders})`;
  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const e = `INSERT INTO t (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`;
  // ruleid: cw-sql-text-assembled-js
  // ok: cw-sql-value-interpolated-js
  const f = `SELECT * FROM rules ORDER BY (scope='${GLOBAL}') ASC`;
  // ruleid: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  const g = `select id from users where ${lookupField} = '${escapedValue}'`;
  // ruleid: cw-sql-text-assembled-js, cw-sql-value-interpolated-js
  const h = `insert into stage_batches (batch_number, source_records) values (${n}, ${m});`;
  return [a, b, c, d, e, f, g, h];
}
