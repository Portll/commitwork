// The ledger's schema, one migration per user_version. Append a migration; never edit a shipped one.
// Times are epoch milliseconds. A null figure is unknown, never zero.

export class LedgerError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'LedgerError';
    this.code = code;
  }
}

const V1 = `
CREATE TABLE decisions (
  id INTEGER PRIMARY KEY,
  first_ms INTEGER NOT NULL,
  last_ms INTEGER NOT NULL,
  seen INTEGER NOT NULL DEFAULT 1,
  repo TEXT,
  run_id INTEGER,
  job_id INTEGER,
  admit INTEGER NOT NULL,
  code TEXT NOT NULL,
  outcome TEXT NOT NULL,
  reason TEXT
);
CREATE INDEX decisions_last ON decisions(last_ms);
CREATE INDEX decisions_subject ON decisions(repo, run_id, job_id);

CREATE TABLE runners (
  name TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  run_id INTEGER,
  job_id INTEGER,
  slot_id TEXT NOT NULL,
  runner_id INTEGER,
  minted_ms INTEGER NOT NULL,
  claimed_ms INTEGER,
  finished_ms INTEGER
);
CREATE INDEX runners_minted ON runners(minted_ms);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY,
  at_ms INTEGER NOT NULL,
  runner_name TEXT UNIQUE,
  repo TEXT,
  job_id INTEGER,
  slot_id TEXT,
  exit_code INTEGER,
  signal TEXT,
  wall_sec REAL,
  cpu_sec REAL,
  mem_peak_bytes INTEGER,
  io_rbytes INTEGER,
  io_wbytes INTEGER,
  killed INTEGER,
  left_running INTEGER
);
CREATE INDEX jobs_at ON jobs(at_ms);
`;

export const MIGRATIONS = Object.freeze([V1]);

/** Bring `db` to the newest schema. A store newer than this code is refused, not read. */
export function migrate(db) {
  const have = db.prepare('PRAGMA user_version').get().user_version;
  if (have > MIGRATIONS.length) {
    throw new LedgerError('ledger-newer', `schema version ${have} is newer than this code's ${MIGRATIONS.length}`);
  }
  for (let v = have; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return MIGRATIONS.length;
}
