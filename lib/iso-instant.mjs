// lib/iso-instant.mjs — an ISO-8601 instant with an explicit zone on a real calendar day, as epoch ms.
// Date.parse alone reads 2023/01/01 as local time and rolls 2023-02-30 into March.

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function isoInstant(value, name = 'value') {
  const m = typeof value === 'string' ? ISO_INSTANT.exec(value) : null;
  const day = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const real = day && day.getUTCFullYear() === +m[1] && day.getUTCMonth() === +m[2] - 1 && day.getUTCDate() === +m[3];
  const ms = real ? Date.parse(value) : NaN;
  if (Number.isNaN(ms)) throw new TypeError(`${name} must be an ISO-8601 instant with a zone: ${JSON.stringify(value)}`);
  return ms;
}
