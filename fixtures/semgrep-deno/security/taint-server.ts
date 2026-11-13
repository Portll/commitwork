// Annotated fixture for manifests/semgrep-deno-security/taint.yaml — Deno.serve handlers.
// `ruleid:` means the next code line must match; `ok:` means it must not.
import { basename, join } from "jsr:@std/path@1";
import { escape } from "jsr:@std/html@1";
import { serveFile } from "jsr:@std/http@1/file-server";

const ROOT = "/srv/files";
const ALLOWED_HOSTS = ["api.example.com"];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const tool = url.searchParams.get("tool") ?? "true";
  // ruleid: cw-deno-command-injection
  await new Deno.Command(tool).output();

  // ok: cw-deno-command-injection
  await new Deno.Command("grep", { args: ["-c", "ERROR", "/var/log/app.log"] }).output();

  const expr = url.searchParams.get("q") ?? "";
  // ruleid: cw-deno-command-injection
  await new Deno.Command("sh", { args: ["-c", `grep ${expr} /var/log/app.log`] }).output();

  const branch = url.searchParams.get("branch") ?? "main";
  // ruleid: cw-deno-argument-injection
  await new Deno.Command("git", { args: ["checkout", branch] }).output();
  // ok: cw-deno-argument-injection
  await new Deno.Command("git", { args: ["checkout", "--", branch] }).output();

  const plugin = url.searchParams.get("plugin") ?? "";
  // ruleid: cw-deno-code-injection
  await import(plugin);
  // ok: cw-deno-code-injection
  await import("./plugins/known.ts");

  const name = url.searchParams.get("file") ?? "";
  // ruleid: cw-deno-path-traversal
  const body = await Deno.readTextFile(join(ROOT, name));
  // ok: cw-deno-path-traversal
  const safe = await Deno.readTextFile(join(ROOT, basename(name)));

  const target = url.searchParams.get("url") ?? "";
  // ruleid: cw-deno-ssrf
  const upstream = await fetch(target);
  await upstream.body?.cancel();
  // ok: cw-deno-ssrf
  await (await fetch("https://api.example.com/status")).body?.cancel();

  const who = url.searchParams.get("name") ?? "";
  if (url.pathname === "/hello") {
    // ruleid: cw-deno-reflected-html
    return new Response(`<h1>Hello ${who}</h1>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (url.pathname === "/hello-safe") {
    // ok: cw-deno-reflected-html
    return new Response(`<h1>Hello ${escape(who)}</h1>`, { headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (url.pathname === "/hello-text") {
    // ok: cw-deno-reflected-html
    return new Response(`Hello ${who}`, { headers: { "content-type": "text/plain" } });
  }

  const next = url.searchParams.get("next") ?? "/";
  if (url.pathname === "/login") {
    // ruleid: cw-deno-open-redirect
    return Response.redirect(next, 302);
  }
  if (url.pathname === "/home") {
    // NOT safe, and the rule is right to say so: url.origin comes from req.url, which Deno.serve
    // builds from the request's Host header — the sender chooses the host this redirects to.
    // ruleid: cw-deno-open-redirect
    return Response.redirect(new URL("/dashboard", url.origin), 302);
  }
  if (url.pathname === "/home2") {
    // ok: cw-deno-open-redirect
    return new Response(null, { status: 302, headers: { location: "/dashboard" } });
  }

  const lang = req.headers.get("x-lang") ?? "en";
  // ruleid: cw-deno-env-poisoning
  Deno.env.set("APP_LANG", lang);
  // ok: cw-deno-env-poisoning
  Deno.env.set("APP_MODE", "server");

  const pattern = url.searchParams.get("re") ?? "";
  // ruleid: cw-deno-regex-from-request
  const re = new RegExp(pattern);
  // ok: cw-deno-regex-from-request
  const fixedRe = new RegExp("^[a-z]+$");

  if (url.pathname === "/debug") {
    // ruleid: cw-deno-env-disclosure
    return Response.json(Deno.env.toObject());
  }
  if (url.pathname === "/version") {
    // ok: cw-deno-env-disclosure
    return Response.json({ version: Deno.env.get("APP_VERSION") ?? "dev" });
  }

  return new Response(body + safe + String(re) + String(fixedRe), { status: 200 });
});

// A helper typed with Request: the source does not depend on being inside Deno.serve.
export async function download(req: Request): Promise<Response> {
  const p = new URL(req.url).searchParams.get("p") ?? "";
  // ruleid: cw-deno-path-traversal
  return await serveFile(req, `${ROOT}/${p}`);
}

export async function proxy(req: Request): Promise<Response> {
  const host = new URL(req.url).searchParams.get("host") ?? "";
  if (!ALLOWED_HOSTS.includes(host)) return new Response("no", { status: 403 });
  // ok: cw-deno-ssrf
  return await fetch(`https://${host}/v1/data`);
}

export async function confined(req: Request): Promise<Response> {
  const p = join(ROOT, new URL(req.url).searchParams.get("p") ?? "");
  if (!p.startsWith(ROOT + "/")) return new Response("no", { status: 403 });
  // ok: cw-deno-path-traversal
  return new Response(await Deno.readFile(p));
}
