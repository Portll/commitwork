// Annotated fixture for manifests/semgrep-deno-security/races-and-constructs.yaml.
import { exists } from "jsr:@std/fs@1";
import { setCookie } from "jsr:@std/http@1/cookie";
import { timingSafeEqual } from "jsr:@std/crypto@1/timing-safe-equal";

const kv = await Deno.openKv();

export async function withdrawRacy(user: string, amount: number) {
  const entry = await kv.get<number>(["balance", user]);
  const balance = entry.value ?? 0;
  if (balance < amount) throw new Error("insufficient");
  // ruleid: cw-deno-kv-read-modify-write
  await kv.set(["balance", user], balance - amount);
}

export async function withdrawAtomic(user: string, amount: number) {
  while (true) {
    const entry = await kv.get<number>(["balance", user]);
    const balance = entry.value ?? 0;
    if (balance < amount) throw new Error("insufficient");
    // ok: cw-deno-kv-read-modify-write
    const res = await kv.atomic().check(entry).set(["balance", user], balance - amount).commit();
    if (res.ok) return;
  }
}

export async function redeemTokenRacy(token: string) {
  const t = await kv.get(["token", token]);
  if (!t.value) return false;
  // ruleid: cw-deno-kv-read-modify-write
  await kv.atomic().delete(["token", token]).commit();
  return true;
}

export async function redeemTokenUnchecked(token: string) {
  const t = await kv.get(["token", token]);
  if (!t.value) return false;
  // ruleid: cw-deno-kv-commit-result-ignored
  await kv.atomic().check(t).delete(["token", token]).commit();
  return true;
}

export async function redeemTokenChecked(token: string) {
  const t = await kv.get(["token", token]);
  if (!t.value) return false;
  // ok: cw-deno-kv-commit-result-ignored
  const res = await kv.atomic().check(t).delete(["token", token]).commit();
  return res.ok;
}

export async function writeIfAbsentRacy(path: string, data: string) {
  if (!(await exists(path))) {
    // ruleid: cw-deno-fs-toctou
    await Deno.writeTextFile(path, data);
  }
}

export async function chmodAfterStat(path: string) {
  const info = await Deno.lstat(path);
  if (info.isSymlink) throw new Error("symlink");
  // ruleid: cw-deno-fs-toctou
  await Deno.chmod(path, 0o600);
}

export async function writeIfAbsentAtomic(path: string, data: string) {
  try {
    // ok: cw-deno-fs-toctou
    const f = await Deno.open(path, { createNew: true, write: true });
    await f.write(new TextEncoder().encode(data));
    f.close();
  } catch (e) {
    if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
  }
}

Deno.serve({ port: 8002 }, (req) => {
  if (new URL(req.url).pathname === "/ws") {
    // ruleid: cw-deno-websocket-no-origin-check
    const { response } = Deno.upgradeWebSocket(req);
    return response;
  }
  return new Response("ok");
});

export function upgradeChecked(req: Request) {
  if (req.headers.get("origin") !== "https://app.example.com") return new Response("no", { status: 403 });
  // ok: cw-deno-websocket-no-origin-check
  const { response } = Deno.upgradeWebSocket(req);
  return response;
}

export function authRacy(req: Request) {
  const token = req.headers.get("x-token");
  // ruleid: cw-deno-timing-unsafe-secret-compare
  return token === Deno.env.get("API_TOKEN");
}

export function authConstantTime(req: Request) {
  const enc = new TextEncoder();
  const a = enc.encode(req.headers.get("x-token") ?? "");
  const b = enc.encode(Deno.env.get("API_TOKEN") ?? "");
  // ok: cw-deno-timing-unsafe-secret-compare
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}

export function sandbox(code: string) {
  // ruleid: cw-deno-worker-inherits-permissions
  const w = new Worker(new URL("./plugin-worker.ts", import.meta.url).href, { type: "module", deno: { permissions: "inherit" } });
  // ok: cw-deno-worker-inherits-permissions
  const v = new Worker(new URL("./plugin-worker.ts", import.meta.url).href, { type: "module", deno: { permissions: "none" } });
  w.postMessage(code);
  v.postMessage(code);
}

export function session(headers: Headers, id: string) {
  // ruleid: cw-deno-cookie-missing-flags
  setCookie(headers, { name: "sid", value: id, httpOnly: true });
  // ok: cw-deno-cookie-missing-flags
  setCookie(headers, { name: "sid", value: id, httpOnly: true, secure: true, sameSite: "Lax" });
}

export async function loadRemote() {
  // ruleid: cw-deno-cleartext-remote-import
  await import("http://cdn.example.com/lib.ts");
  // ok: cw-deno-cleartext-remote-import
  await import("https://cdn.example.com/lib@1.2.3/mod.ts");
}
