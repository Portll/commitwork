#!/usr/bin/env -S deno run -A
import { serve } from "http://deno.land/std@0.140.0/http/server.ts";
import { z } from "https://raw.githubusercontent.com/colinhacks/zod/main/deno/lib/mod.ts";
import { ok } from "https://deno.land/x/okay@v1.2.0/mod.ts";
serve(() => new Response(String(z) + String(ok)));
