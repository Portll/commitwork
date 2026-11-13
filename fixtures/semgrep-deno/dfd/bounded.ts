// Fixture for bin/deno-dfd.mjs's sink-to-source mutability evaluation.
//
// Every path below IS reported by the taint engine — none of these bounds is a sanitizer it
// knows — and the evaluator must still say how much of the value the sender controls at the sink.
// `// control: <class>` names the expected verdict for the finding on the next code line.
import { Client } from "jsr:@db/postgres@0.19";
const db = new Client(Deno.env.get("DATABASE_URL"));

Deno.serve(async (req) => {
  const url = new URL(req.url);

  const mode = url.searchParams.get("mode") ?? "fast";
  if (mode !== "fast" && mode !== "slow") return new Response("bad mode", { status: 400 });
  // control: allowlisted
  await new Deno.Command("tool", { args: ["--mode", mode] }).output();

  const raw = url.searchParams.get("n") ?? "0";
  const n = Math.floor(+raw);
  // control: numeric
  await db.queryObject(`SELECT * FROM t LIMIT ${n}`);

  const q = url.searchParams.get("q") ?? "";
  const enc = encodeURIComponent(q);
  // control: mismatched
  await new Deno.Command("sh", { args: ["-c", `curl https://x.test/?q=${enc}`] }).output();

  const p = (url.searchParams.get("p") ?? "").replaceAll("../", "");
  // control: filtered
  const page = await Deno.readTextFile(`/srv/pages/${p}`);

  const id = url.searchParams.get("id") ?? "";
  // control: host-pinned
  const user = await fetch(`https://api.example.com/users/${id}`);

  const body = await req.json();
  // control: structured
  Deno.env.set("FEATURE", body.flag);

  const name = url.searchParams.get("name") ?? "";
  // control: substring
  await db.queryObject(`SELECT * FROM t WHERE name = '${name}'`);

  return new Response(page + (await user.text()));
});
