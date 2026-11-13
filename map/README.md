<!-- verified-against: 2026-10-07 -->
# commitwork · modernization map engine

A **generic, project-agnostic** renderer for the "trainline" modernization map, hosted inside
commitwork so the map is a *generated artifact* — not a separate docs repo. Apply it to any
repository; projects without data get a stub placeholder instead of a broken run.

## Run
```sh
node map/render.mjs [project]      # default: the registry's primary area slug
```
`project` is an area slug. Writes `map/data/<project>/index.html`, which the admin server serves live
at `/map/<project>` (the `#modmap` tab embeds it). The live CVE, security and program layers read
that area's rollup from its report directory, resolved by `outDirFor`.
The scheduled sweep regenerates it with `--map` (or `MAP_REFRESH=1`, `MAP_PROJECT=<project>`).

## Layout
```
map/
  render.mjs            runner: resolves per-project data, runs the pipeline, or stubs
  generate.mjs          data.json -> index.html (the SVG trainline)
  build-data.mjs        migration-state.json (+ subsystems) -> data.json
  build-tracks.mjs      roster/infra/appsSiding -> data.tracks / infraSiding / appsSiding
  attach-cve|security|program.mjs   join live CVE / security / program layers (need cve-history + rollup)
  test/                 engine tests (project-agnosticism + honest empty states)
  data/
    <project>/          per-project INPUTS: migration-state.json, subsystems.raw.json, cve-history/,
                        and the project's own masthead logo if it declares one. NOT TRACKED: a
                        project's inputs are its private record, kept in the sidecar's
                        map-data/<project>/ ($CW_SIDECAR, default `commitwork-sidecar`
                        beside the checkout) and symlinked here.
```

The engine ships **no brand assets**. A project's masthead logo lives in its own data dir, and
`meta.logo` is resolved against that dir *only*; a project that declares none gets no mark rather
than someone else's. A public clone has no per-project inputs, so every map renders as the stub.

## How it generalises
The engine reads its per-project data from `MAP_ROOT` (set by `render.mjs` to `map/data/<project>`).
Nothing is engine-relative: every name, count, label, logo and claim on a map comes from that
project's data. So the same scripts render any project's map — you just add a `map/data/<project>/`
with that project's `migration-state.json` (+ `subsystems.raw.json`, optional `cve-history/`).
Missing that, `render.mjs` emits a themed **stub** ("no modernization map for `<project>` yet") so
the `#modmap` tab still resolves.

Two rules hold the generalisation in place, and `map/test/map-engine.test.mjs` pins both:

- **No client's name, number or narrative may reach another project's artifact** — including in a
  source comment, because the CSS and client JS are inlined verbatim into the self-contained HTML.
- **Absence renders as absence.** A missing `securityProgram` sub-block is an explicit "not
  measured" / "not declared", never a crash, never a literal `undefined`, never a zero, and never
  another project's value used as a default. A control with nothing behind it (the CVE-baseline
  toggle on a project with no `cveOriginal`) is not rendered at all rather than rendered inert.

## Adding a project
1. Create `map/data/<project>` (in the sidecar for a real project) and drop in `migration-state.json` (versionAxis / waves / roster /
   infra / appsSiding) and `subsystems.raw.json`. Optional `cve-history/` enables the CVE overlays.
2. `node map/render.mjs <project>` → `map/data/<project>/index.html`, served at `/map/<project>`.

A project's source of truth is its `migration-state.json` in the sidecar. Never hand-edit the
generated `data.json` / `index.html` — edit the source and re-render.
