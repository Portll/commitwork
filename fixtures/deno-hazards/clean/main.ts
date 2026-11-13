#!/usr/bin/env -S deno run --allow-net=0.0.0.0:8000
import { join } from "jsr:@std/path@^1.0.8";
import { ok } from "https://deno.land/x/okay@v1.2.0/mod.ts";
Deno.serve(() => new Response(join("a", "b") + String(ok)));
