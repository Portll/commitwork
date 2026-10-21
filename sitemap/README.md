<!-- verified-against: 2026-10-13 5e582892 -->
# sitemap/ — SiteMap tab (S0–S4 live)

**S4: Monolith mode** — the whole repo as ONE megalith in the Sprawl idiom: black-glass
slab, per-service facade panels, glowing apertures where the code opens to the world (HTTP
endpoints, sockets, brokers, datastores, IdP, outbound clients — the manifest's `io` facet,
ALL heuristic tier with cited sources), the file constellation dimly visible inside, neon grid
horizon, slow drift (held still under `prefers-reduced-motion`), scanline overlay. Aperture hover → kind/detail/source; click → the
service's full I/O surface panel. Overflow gets an explicit `+N more` slit — no silent caps.
NOTE: yaml `server:/port:` detection is a LINEAR line scan in harvest.mjs, because a multiline
regex backtracks catastrophically on large yaml. Never reintroduce one.

3D code-structure viewer for the :7878 admin panel: services/containers → file tree → symbols
(functions/classes/models/pages) + external links. Six themes ship (Megalith is `exterior:true`);
`demo.html`'s theme table is the enumeration, not this sentence.

- `demo.html` — the tab page (`/sitemap/demo.html?project=<slug>`, iframe view `#sitemap`,
  project-picker-following). Loads the LIVE per-project manifest `data/<slug>.sitemap.json`. It
  falls back to the fixture only when the fixture's own `project` is the one asked for, or when no
  `?project=` is given; any other project with no live manifest says so. With no `?project=`
  nothing live is requested, and without a fixture the badge reads `NO PROJECT`. The badge names
  which (`LIVE · <slug>`, `STATIC DEMO · fixture (<project>)`, `NO DATA · <slug>`); the tab title
  names the project the loaded manifest declares, never one written into the page. Keyboard: Tab
  reaches the canvas and every service label, Enter or Space opens a label's card, arrow keys pan,
  `+`/`-` zoom within the wheel's distance limits, Escape closes the card, and a service card lists
  its files and vulnerabilities as buttons, which are the keyboard route to the instanced meshes a
  pointer picks by ray. The find-a-service box frames the chosen service and opens its card.
  URL parameters, beside `?project=`: `?view=<theme>` opens one of the six themes (`city`,
  `organic`, `glass`, `monolith`, `noir`, `megalith`) for this visit without changing the stored
  choice, which is for links and screenshots, and an unknown value falls back to the stored theme;
  `?mode=light|dark` pins the light or dark mode over the stored and system preference, any other
  value is ignored; `?embed` (or being framed) hides the page's own title.
  themes as data presets over ONE scene graph, three layout engines (row-wrapped treemap /
  count-scaled radial / monolith), instanced files AND district bases (2 draw calls at 11k files),
  lifecycle-aware rendering (superseded/retired services dimmed + badged — never blank, never
  clean), hover tooltip, click → symbol panel, external-links panel (esc()'d, `https?://`-only
  hrefs, `noopener`), coverage/freshness footer.
- `harvest.mjs` — SHARED harvest engine (universal-ctags + container topology + link harvest +
  provenance `{ast|heuristic|inventory|void}` + visible truncation). One implementation feeds
  both generators so fixture and live data cannot drift.
- `../monitor/sitemap-data.mjs` — S2 full-fleet generator: every project in projects.json →
  `data/<slug>.sitemap.json` (a fleet repo's service dirs + its buildout as infra). The
  lifecycle mechanism — `exclude`/`lifecycle` with `effectiveFrom` gating, resolved by
  `lifecycleOf` in `../monitor/sitemap-data.mjs` — reads the private registry, which declares
  both; a service it marks superseded or retired is dimmed and badged.
  Regenerating updates the tab with NO server restart.
- `build-fixture.mjs` — S0 fixture wrapper over the same engine:
  `node sitemap/build-fixture.mjs <service-dir> …` harvests the named services of the registry
  project `CW_SITEMAP_FLEET` names, and exits 1 when that names no project path. Output:
  `data/fixture.sitemap.json` — GITIGNORED and never committed (`build-fixture.mjs:8` says so;
  `.gitignore` covers `/sitemap/data/*.sitemap.json`). Nothing under `data/` is tracked.
- `vendor/` — three.js r147 UMD + OrbitControls (MIT, vendored from unpkg; no CDN at runtime).

Schema: `../schema/sitemap.schema.json` **v2** (`schemaVersion` const 2; + lifecycle/supersededBy).
Two code comments still say v1 — `demo.html:39` and `../monitor/sitemap-data.mjs:7` — and the schema
is the authority. Panel wiring: `../admin/serve.mjs`
`/sitemap/` static route + 19th DIMENSIONS row (`Code structure / SiteMap`, universal-ctags,
`state:'live'`). Needs `brew install universal-ctags`; without it every file caps at `inventory`
tier — honest, never silently empty. Open ideas: cc.json exporter for CodeCharta as a second
viewer; per-node lazy symbol detail beyond the click panel.
