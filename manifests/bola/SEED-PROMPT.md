<!-- verified-against: 2026-09-30 -->
# BOLA manifest seed prompt

A ready-to-paste prompt that hands an agent (Claude Code, or any coding agent) a repository and asks
it to **write a `bola.json` manifest** for `bin/bola-run.mjs` — a config-generation task. The agent reads the app's own route/auth code and emits JSON describing which accounts and
object endpoints to test; the actual probing is a separate, human-gated step run against a local
testbed.

## Why it's scoped the way it is

This is authorized defensive testing of your own application. The prompt states that context plainly
because it is true — it is the accurate frame for the work, and an accurately-scoped defensive task is
one a capable model handles directly without escalation or hand-off. Keep it that way: it stays inside
scope precisely because it *is* the legitimate thing it says it is. 

---

## The prompt

> **Task: generate an authorization test manifest for this repository.**
>
> This is authorized security testing of an application I own and operate. I run
> `commitwork`'s object-level-authorization checker (`bin/bola-run.mjs`) against a **local testbed**
> of this app as part of my own CI. Your job is only to **write the `bola.json` config file** that
> tells the checker which test accounts and object endpoints to exercise — you are not making any
> requests or attacking anything. Follow the schema at `schema/bola-manifest.schema.json`.
>
> Read this repo's API layer and produce `bola.json`. `manifests/bola/example.json` is a worked
> example of the finished shape — read it alongside the schema.
>
> 1. **Actors.** Define the test-account matrix. Aim for: one `anon` (no credential), two `user`
>    accounts in two different tenants/orgs, and two `admin` accounts in those two tenants. Use
>    placeholder logins that clearly belong to test fixtures (e.g. `user-a@example.test`). For each,
>    pick the `credential.type` that matches how this app authenticates — inspect the login/session
>    code to decide, and set that type's fields (**bold = required**):
>
>    | detected auth | `credential.type` | fields |
>    |---|---|---|
>    | Keycloak / OIDC password grant | `keycloak` | **`passwordEnv`**, plus `realm`, `client`, `username` (or `usernameEnv`), `url` |
>    | Supabase / GoTrue | `supabase` | **`url`**, **`passwordEnv`**, plus `apikeyEnv`, `email` (or `emailEnv`) |
>    | a login endpoint returning a cookie or a JSON token | `login-post` | **`url`**, plus `method`, `contentType`, `fields`, `capture` (`{mode:"cookie"}` or `{mode:"token",tokenPath}`) |
>    | a bearer already in the environment | `static-bearer` | `tokenEnv` |
>    | an API-key header | `api-key` | `header`, `valueEnv` |
>
>    Reference **only environment-variable names** for every secret — that is what the fields ending
>    in `Env` are for, and inside `login-post.fields` the `${ENV:NAME}` placeholder does the same job
>    (`{"password": "${ENV:APP_PASS_A}"}`). There is deliberately no literal `password` field.
>    **Never put a real password, token, or key in the file.** Only the *names* go in the manifest;
>    the values are read at run time from the operator's keychain or environment.
>
>    If the app needs a custom header on every request — tenancy or routing that rides in a header
>    rather than in the token, an account-specific key, an API version — declare it per actor as
>    name:value pairs. These merge over whatever the credential recipe produced:
>
>    ```json
>    { "name": "userA", "role": "user", "tenant": "tenantA",
>      "headers": { "X-Tenant-Id": "tenantA", "X-Api-Version": "2024-01" } }
>    ```
>
>    Header values may embed `${ENV:NAME}` too, so a header carrying a secret still names it rather
>    than holding it.
>
> 2. **Objects (ownership ground truth).** Find the object-level endpoints — routes that read a single
>    tenant- or user-owned record by id (`GET /orders/{id}`, `GET /rest/v1/notes?id=eq.{id}`, …).
>    Prefer `model: "seed"`: for each object type, give the `POST` route that creates one, the
>    response path to read its new id (`idPath`), and the `getPath` template with `{id}`. The checker
>    will have each account create its own object and then have the others try to read it. If the app
>    can't safely be written to, use `model: "declared"` with explicit `{ path, owner }` pairs instead.
>
> 3. **Discovery.** If the app serves an OpenAPI/Swagger spec, list its path(s) as an **array** under
>    `discovery.openapi` — the schema takes an array of strings (or `false`), and the runner silently
>    discards a bare string and falls back to its built-in spec paths, so a string here means your
>    spec is never read and nothing tells you.
>    Otherwise list a few known object paths under `discovery.paths` for the unauthenticated-exposure
>    sweep. Do not invent endpoint names — only use paths you found in the code.
>
> Output the finished `bola.json`, then briefly explain: which auth mechanism you detected, which
> object endpoints you found, and the list of secret **names** the manifest references, so I can make
> each one available before running
> `node bin/bola-run.mjs --manifest ./bola.json --base <my-local-testbed-url> --trust-repo-manifest`.
> Do not run the checker yourself.

---

## After the agent produces `bola.json`

1. Review it — it's a repo-local manifest, so the runner **refuses to execute it** until you pass
   `--trust-repo-manifest` (or `COMMITWORK_TRUST_REPO_MANIFEST=1`). That gate exists so running the
   checker inside an unfamiliar checkout can't fire credentialed requests you didn't sanction.
2. Make the secrets it named available. Prefer the **local secrets store** over a plaintext export —
   the runner resolves every name the manifest references through `lib/secrets.mjs`, so a test-account
   password lives in the login keychain rather than in your shell history, a `.env`, or a plist:

   ```sh
   node bin/secrets.mjs set BOLA_PASS_A     # prompts; the value is typed into `security`, never
                                            # passed as an argument, so it cannot appear in `ps`
   node bin/secrets.mjs check BOLA_PASS_A   # exit 1 if it is unresolvable — this gates
   ```

   The keychain backend is **macOS-only** — `bin/secrets.mjs set` exits 2 on any other platform. Elsewhere
   the environment variable below is the only route.

   An environment variable that is already set still wins, so `BOLA_PASS_A=… node bin/bola-run.mjs …`
   keeps working for a one-off. A name that is in neither place is reported as an unmintable actor
   with the variable named — never as a quietly smaller actor matrix.
3. Point it at a **local testbed**, never production: `--base http://127.0.0.1:<port>`.
4. Run it. Findings come out in the same `authz-bola.json` **shape** the sweep rollup already
   ingests — but to disk only with `--out`; without it the runner writes to stdout, so add
   `--out authz-bola.json` if you want the file the lane itself produces.
5. To run it from the panel on a schedule, keep it as a private record,
   `monitor/private/bola/<name>.json` (or the directory `CW_BOLA_MANIFEST_DIR` names), and name it in
   the area's `bola.manifest`. A manifest names its target's realm, accounts and endpoints, so it
   does not belong in `manifests/bola/`, which ships only the synthetic example. `--manifest <name>`
   finds it there too, as a bundled manifest.
