// The stack API's envelope, field for field the one spine's server/api.mjs serves:
//   success  { ok: true, route, schemaVersion, stamp, sources, coverage, data }
//   failure  { ok: false, route, schemaVersion, stamp, error: { code, message, detail, remedy }, partial }
// sources lists every source on every success, the working ones too, as { id, status, reason }.
// stamp.verifiedAt is the age of the data, not of the response.

export const SCHEMA_VERSION = 1;
export const AGENT = 'commitwork-runner';

export class ApiError extends Error {
  constructor(status, code, message, detail = null, remedy = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.remedy = remedy;
  }
}

function stampOf(ms) {
  const sec = Math.floor(ms / 1000);
  return { verifiedAt: new Date(sec * 1000).toISOString(), verifiedAtUnix: sec };
}

const live = (sources) => sources.filter((s) => s.status === 'live').length;

export function envelope({ route, sources, coverage, data, generator, startedAt, verifiedAtMs, nowMs = Date.now() }) {
  return {
    ok: true,
    route,
    schemaVersion: SCHEMA_VERSION,
    stamp: {
      ...stampOf(verifiedAtMs ?? nowMs),
      generator: `${AGENT} · ${generator}`,
      durationMs: startedAt === undefined ? null : Math.round(nowMs - startedAt),
    },
    sources: sources.map(({ id, status, reason }) => ({ id, status, reason: reason ?? null })),
    coverage: coverage ?? { requested: sources.length, measured: live(sources), unknownFields: 0 },
    data,
  };
}

export function errorEnvelope(route, err, nowMs = Date.now()) {
  return {
    ok: false,
    route,
    schemaVersion: SCHEMA_VERSION,
    stamp: stampOf(nowMs),
    error: {
      code: err.code || 'SOURCE_UNREADABLE',
      message: err.message || 'unreadable',
      detail: err.detail ?? null,
      remedy: err.remedy ?? null,
    },
    partial: null,
  };
}
