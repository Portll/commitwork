// Annotated fixture for manifests/semgrep-deno-reliability/reliability.yaml.
const kv = await Deno.openKv();
let hits = 0;

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ruleid: cw-deno-sync-io-in-handler
  const tmpl = Deno.readTextFileSync("./page.html");
  // ok: cw-deno-sync-io-in-handler
  const tmpl2 = await Deno.readTextFile("./page.html");

  // ruleid: cw-deno-kv-unbounded-list
  const all = kv.list({ prefix: ["users"] });
  // ok: cw-deno-kv-unbounded-list
  const page = kv.list({ prefix: ["users"] }, { limit: 50 });

  // ruleid: cw-deno-fetch-without-timeout-in-handler
  const up = await fetch("https://api.example.com/v1");
  // ok: cw-deno-fetch-without-timeout-in-handler
  const up2 = await fetch("https://api.example.com/v1", { signal: AbortSignal.timeout(5000) });

  if (url.pathname === "/quit") {
    // ruleid: cw-deno-exit-in-handler
    Deno.exit(1);
  }

  return new Response(tmpl + tmpl2 + String(all) + String(page) + (await up.text()) + (await up2.text()));
});

export async function bump() {
  // The finding spans read → await → write and is reported where the span starts, at the read.
  // ruleid: cw-deno-shared-state-across-await
  const before = hits;
  await kv.get(["x"]);
  hits = before + 1;
}

export async function bumpSafe() {
  await kv.get(["x"]);
  // ok: cw-deno-shared-state-across-await
  const now = hits;
  hits = now + 1;
}

export async function loadAll(ids: string[]) {
  const out = [];
  for (const id of ids) {
    // ruleid: cw-deno-kv-get-in-loop
    out.push(await kv.get(["user", id]));
  }
  // ok: cw-deno-kv-get-in-loop
  out.push(...(await kv.getMany(ids.slice(0, 10).map((id) => ["user", id]))));
  return out;
}

export async function save(data: string) {
  // ruleid: cw-deno-unawaited-write
  Deno.writeTextFile("./state.json", data);
  // ok: cw-deno-unawaited-write
  await Deno.writeTextFile("./state.json", data);
  // ruleid: cw-deno-unawaited-write
  kv.set(["state"], data);
  // ok: cw-deno-unawaited-write
  await kv.set(["state"], data);
}

export async function build() {
  const child = new Deno.Command("make", { args: ["all"], stdout: "piped" }).spawn();
  // ruleid: cw-deno-piped-output-not-read
  const st = await child.status;
  const ok = new Deno.Command("make", { args: ["all"], stdout: "piped" }).spawn();
  const logs = ok.stdout.pipeTo(Deno.stdout.writable, { preventClose: true });
  // ok: cw-deno-piped-output-not-read
  const st2 = await ok.status;
  await logs;
  return st.success && st2.success;
}

export async function version() {
  // ruleid: cw-deno-command-status-unchecked
  const raw = new TextDecoder().decode((await new Deno.Command("git", { args: ["rev-parse", "HEAD"] }).output()).stdout);
  const out = await new Deno.Command("git", { args: ["rev-parse", "HEAD"] }).output();
  // ok: cw-deno-command-status-unchecked
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  return raw + new TextDecoder().decode(out.stdout);
}

export async function ping() {
  // ruleid: cw-deno-response-body-leaked
  await fetch("https://example.com/ping");
  const r = await fetch("https://example.com/ping");
  // ok: cw-deno-response-body-leaked
  await r.body?.cancel();
}

export async function readHead(path: string) {
  // ruleid: cw-deno-file-not-closed
  const f = await Deno.open(path);
  const buf = new Uint8Array(16);
  await f.read(buf);
  return buf;
}

export async function readHeadClosed(path: string) {
  // ok: cw-deno-file-not-closed
  const f = await Deno.open(path);
  const buf = new Uint8Array(16);
  await f.read(buf);
  f.close();
  return buf;
}

export async function stream(path: string) {
  // ok: cw-deno-file-not-closed
  const f = await Deno.open(path);
  return new Response(f.readable);
}

export function shutdown(code: number) {
  // A CLI's own exit, outside any request handler, is the program ending on purpose.
  // ok: cw-deno-exit-in-handler
  Deno.exit(code);
}

export class Writers {
  writers = new Map<string, Deno.FsFile>();
  async open(path: string) {
    // ok: cw-deno-file-not-closed
    const w = await Deno.open(path, { write: true, create: true });
    this.writers.set(path, w);
  }
}
