// contract: pinned env time or now, canonical ISO
export function nowISO(env = process.env, key = 'CW_NOW') {
  const pinned = env[key];
  if (!pinned) return new Date().toISOString();
  const t = new Date(pinned);
  if (Number.isNaN(t.getTime())) throw new RangeError(`${key} is not a parseable timestamp: ${JSON.stringify(pinned)}`);
  return t.toISOString();
}
