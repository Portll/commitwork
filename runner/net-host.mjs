// The stack API's bind address: this container's one interface address on the control subnet, so
// the API never listens on a job network. IPv4 only; the stack's networks are IPv4.
import { networkInterfaces } from 'node:os';

function ipv4ToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4 || !parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** { start, size } for an IPv4 CIDR. Throws on anything else. */
export function parseCidr(cidr) {
  const m = /^([\d.]+)\/(\d{1,2})$/.exec(String(cidr).trim());
  const base = m ? ipv4ToInt(m[1]) : null;
  if (base === null || Number(m[2]) > 32) throw new RangeError(`not an IPv4 CIDR: ${String(cidr).slice(0, 60)}`);
  const size = 2 ** (32 - Number(m[2]));
  return { start: Math.floor(base / size) * size, size };
}

/**
 * The address to bind on `cidr`, from `interfaces` shaped like os.networkInterfaces(). None, or more
 * than one, throws: falling back to another address could put the API on a job network.
 */
export function hostOnSubnet(cidr, interfaces = networkInterfaces()) {
  const { start, size } = parseCidr(cidr);
  const hits = [];
  for (const [name, addrs] of Object.entries(interfaces || {})) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      const n = ipv4ToInt(a.address);
      if (n !== null && n >= start && n < start + size) hits.push(`${name} ${a.address}`);
    }
  }
  if (hits.length === 1) return hits[0].split(' ')[1];
  throw new Error(hits.length ? `${hits.length} addresses on ${cidr}: ${hits.join(', ')}` : `no interface address on ${cidr}`);
}
