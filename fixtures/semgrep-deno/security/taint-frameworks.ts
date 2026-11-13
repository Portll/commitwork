// Annotated fixture: Hono and Oak contexts, WebSocket and KV-queue sources, SQL, FFI, local inputs.
import { Hono } from "jsr:@hono/hono@4";
import { Client } from "jsr:@db/postgres@0.19";

const app = new Hono();
const db = new Client(Deno.env.get("DATABASE_URL"));

app.get("/user", async (c) => {
  const id = c.req.query("id");
  // ruleid: cw-deno-sql-injection
  const bad = await db.queryObject(`SELECT * FROM users WHERE id = '${id}'`);
  // ok: cw-deno-sql-injection
  const good = await db.queryObject("SELECT * FROM users WHERE id = $1", [id]);
  // ok: cw-deno-sql-injection
  const num = await db.queryObject(`SELECT * FROM users WHERE id = ${Number(id)}`);
  return c.json({ bad: bad.rows, good: good.rows, num: num.rows });
});

app.get("/greet/:name", (c) => {
  const name = c.req.param("name");
  // ruleid: cw-deno-reflected-html
  return c.html(`<p>${name}</p>`);
});

app.get("/go", (c) => {
  // ruleid: cw-deno-open-redirect
  return c.redirect(c.req.query("to") ?? "/");
});

// Oak-style context.
export async function oakHandler(ctx: { request: { url: URL }; params: Record<string, string>; response: { body: unknown } }) {
  const dir = ctx.params.dir;
  // ruleid: cw-deno-path-traversal
  ctx.response.body = await Deno.readDir(`/srv/${dir}`);
}

Deno.serve((req) => {
  const { socket, response } = Deno.upgradeWebSocket(req);
  const origin = req.headers.get("origin");
  if (origin !== "https://app.example.com") return new Response("forbidden", { status: 403 });
  socket.onmessage = async (e) => {
    // ruleid: cw-deno-command-injection
    const out = await new Deno.Command("bash", { args: ["-c", e.data] }).output();
    socket.send(new TextDecoder().decode(out.stdout));
  };
  return response;
});

const kv = await Deno.openKv();
kv.listenQueue(async (msg) => {
  // ruleid: cw-deno-ssrf
  await (await fetch(msg)).body?.cancel();
});

// Local inputs: only the shell, the program name and native libraries.
const script = Deno.args[0];
// ruleid: cw-deno-local-command-injection
await new Deno.Command("sh", { args: ["-c", script] }).output();
// ok: cw-deno-local-command-injection
await new Deno.Command("ls", { args: [script] }).output();

const libPath = Deno.env.get("PLUGIN_LIB") ?? "./libplugin.so";
// ruleid: cw-deno-native-library-load
const lib = Deno.dlopen(libPath, { add: { parameters: ["i32", "i32"], result: "i32" } });
// ok: cw-deno-native-library-load
const fixed = Deno.dlopen("./vendor/libfixed.so", { add: { parameters: ["i32", "i32"], result: "i32" } });
lib.close();
fixed.close();

Deno.serve({ port: 8001 }, app.fetch);
