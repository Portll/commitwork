// Annotated fixture: the shapes that produced false positives on a real Deno codebase
// (audience-direct d448414, 2026-11-14), each kept as an `ok:` case beside the variant that IS a
// finding. A rule regressing to the earlier form fails here before it fails on a real repository.
import { setCookie } from "jsr:@std/http@1/cookie";
import { postAuthRedirectFor } from "./safeRedirect.ts";

declare const sb: { from(t: string): any; rpc(f: string, a: unknown): Promise<any>; auth: any };
declare const db: { query(sql: string, ...a: unknown[]): Promise<unknown> };

// ── SQL: RegExp.exec is not a database call ──────────────────────────────────────────────────────
export function bearer(req: Request) {
  // ok: cw-deno-sql-injection
  return /^Bearer\s+(\S+)$/i.exec((req.headers.get("authorization") ?? "").trim())?.[1] ?? "";
}
export async function byName(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  // ruleid: cw-deno-sql-injection
  return await db.query(`SELECT * FROM t WHERE name = '${name}'`);
}

// ── SSRF: a value read back from the database is the database's ──────────────────────────────────
export async function checkout(req: Request) {
  const body = await req.json();
  const { data: invoice } = await sb.from("invoices").select("stripe_session_id").eq("invoice_id", body.invoice_id).single();
  // ok: cw-deno-ssrf
  const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${invoice.stripe_session_id}`);
  await res.body?.cancel();
  // ruleid: cw-deno-ssrf
  await (await fetch(body.callback_url)).body?.cancel();
}

// ── Timing: a config flag compared with a literal leaks nothing ──────────────────────────────────
export function flags(req: Request) {
  // ok: cw-deno-timing-unsafe-secret-compare
  const s3 = Deno.env.get("SUPABASE_USE_S3") === "true";
  // ok: cw-deno-timing-unsafe-secret-compare
  const gate = Deno.env.get("AUDIENCE_PAYMENT_GATE") !== "off";
  const sent = req.headers.get("x-webhook-secret");
  // ruleid: cw-deno-timing-unsafe-secret-compare
  return s3 && gate && sent === Deno.env.get("WEBHOOK_SECRET");
}

// ── TOCTOU: reads and temp-file removal after a stat are not escalations ─────────────────────────
export async function compress(path: string) {
  const st = await Deno.stat(path);
  // ok: cw-deno-fs-toctou
  const input = await Deno.open(path, { read: true });
  input.close();
  // ok: cw-deno-fs-toctou
  await Deno.remove(path);
  return st.size;
}
export async function overwrite(path: string, data: string) {
  const st = await Deno.lstat(path);
  if (st.isSymlink) throw new Error("symlink");
  // ruleid: cw-deno-fs-toctou
  const out = await Deno.open(path, { write: true, truncate: true });
  out.close();
  return data;
}

// ── Cookies: flags passed through are the caller's decision ──────────────────────────────────────
export function adapter(headers: Headers, name: string, value: string, options?: { httpOnly?: boolean; secure?: boolean }) {
  // ok: cw-deno-cookie-missing-flags
  setCookie(headers, { name, value, httpOnly: options?.httpOnly, secure: options?.secure });
  // ruleid: cw-deno-cookie-missing-flags
  setCookie(headers, { name, value, httpOnly: true, secure: false });
}

// ── Redirects ────────────────────────────────────────────────────────────────────────────────────
export function legacyPage(req: Request) {
  const url = new URL(req.url);
  url.pathname = "/docs/privacy";
  // ok: cw-deno-open-redirect, cw-deno-protocol-relative-redirect
  return new Response(null, { status: 302, headers: { Location: url.pathname + url.search } });
}
export function echoPath(req: Request) {
  const url = new URL(req.url);
  // ruleid: cw-deno-protocol-relative-redirect
  return new Response(null, { status: 302, headers: { Location: url.pathname + url.search } });
}
export function upgrade(req: Request) {
  const url = new URL(req.url);
  url.protocol = "https:";
  // ok: cw-deno-open-redirect
  return new Response(null, { status: 301, headers: { Location: url.toString() } });
}
export function toLogin(req: Request) {
  const back = new URL(req.url).searchParams.get("redirectTo") ?? "/";
  // ok: cw-deno-open-redirect
  return new Response(null, { status: 302, headers: { Location: `/login?redirectTo=${encodeURIComponent(back)}` } });
}
export function afterAuth(req: Request) {
  const next = postAuthRedirectFor(req, new URL(req.url).searchParams.get("next"));
  // ok: cw-deno-open-redirect
  return new Response(null, { status: 302, headers: { Location: next } });
}
export function unchecked(req: Request) {
  const next = new URL(req.url).searchParams.get("next") ?? "/";
  // ruleid: cw-deno-open-redirect
  return new Response(null, { status: 302, headers: { Location: next } });
}
export function protocolRelative(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  // ruleid: cw-deno-open-redirect
  return new Response(null, { status: 302, headers: { Location: `//${id}` } });
}
export function refuseTo(req: Request, message: string) {
  const url = new URL(req.url);
  // ok: cw-deno-protocol-relative-redirect, cw-deno-open-redirect
  return new Response(null, { status: 302, headers: { Location: `/admin/error?message=${encodeURIComponent(message)}&redirectTo=${encodeURIComponent(url.pathname)}` } });
}
export function echoTemplate(req: Request) {
  const url = new URL(req.url);
  // ruleid: cw-deno-protocol-relative-redirect
  return new Response(null, { status: 302, headers: { Location: `${url.pathname}?moved=1` } });
}
export function forwardJoin(req: Request) {
  const url = new URL(req.url);
  const forwarded = new URL("/join", url.origin);
  // ok: cw-deno-protocol-relative-redirect
  return new Response(null, { status: 302, headers: { Location: `${forwarded.pathname}${forwarded.search}` } });
}
