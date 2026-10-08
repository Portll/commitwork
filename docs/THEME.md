# The commitwork theme

<!-- verified-against: 2026-10-07 -->

The house style for every commitwork surface: the admin panel and its `/config` page, the docsite,
generated HTML reports and the terminal. It covers the dark and light colour tokens, type, spacing,
shape, depth, motion, the component vocabulary and the marks. It also lists where current surfaces
depart from the style.

Every contrast figure was measured on 2026-09-27 from the token values in the stylesheets, using
WCAG 2.x relative luminance, with alpha colours composited over the ground they paint on. Unless a
row says otherwise, a figure is text on `--bg`.

## At a glance: type and marks

Open this file with `node bin/md-view.mjs docs/THEME.md` and every Specimen cell below is set in the
values beside it, in the page's current theme. Read as plain Markdown, the tables still carry the
values. Sizes are shown at the 16px base; the panel and the docsite scale them (§4.2).

### Faces

| Face | Weight | Style | Size | Specimen |
|---|---|---|---|---|
| IBM Plex Sans | 400 | normal | 1.1rem | The quick brown fox jumps over the lazy dog · 0123456789 |
| IBM Plex Sans | 400 | italic | 1.1rem | The quick brown fox jumps over the lazy dog · 0123456789 |
| IBM Plex Sans | 500 | normal | 1.1rem | The quick brown fox jumps over the lazy dog · 0123456789 |
| IBM Plex Sans | 600 | normal | 1.1rem | The quick brown fox jumps over the lazy dog · 0123456789 |
| IBM Plex Sans | 700 | normal | 1.1rem | The quick brown fox jumps over the lazy dog · 0123456789 |
| IBM Plex Mono | 400 | normal | 1rem | rollup.json · 4,852 findings · 0123456789 {}[] |
| IBM Plex Mono | 600 | normal | 1rem | rollup.json · 4,852 findings · 0123456789 {}[] |
| IBM Plex Mono | 700 | normal | 1rem | rollup.json · 4,852 findings · 0123456789 {}[] |

### Logo: the seal

The logo is the seal, a glyph rather than type. The default mark is drawn for light grounds: a
white disc, a black ring and a gold key. On a dark ground the seal takes a near-black disc and a
gold ring. Both are one geometry, recoloured (§9).

| Part | Default mark | Dark-ground seal |
|---|---|---|
| Disc | `#FFFFFF` | `#14161A` |
| Ring | `#101011` | `#C9A227` |
| Key: two nodes and a connector | `#C9A227` | `#C9A227` |

| Mark | Ground | Size | Specimen |
|---|---|---|---|
| Default mark, on white | `#ffffff` | 4rem | ![default mark](cw:mark) |
| Default mark, on paper | light | 4rem | ![default mark](cw:mark) |
| Dark-ground seal | dark | 4rem | ![dark-ground seal](cw:seal) |

| Placement | Mark | Ground | Size | Specimen |
|---|---|---|---|---|
| Panel bar, light theme | default mark | light | 1.5rem | ![default mark](cw:mark) |
| Panel bar, dark theme | dark-ground seal | dark | 1.5rem | ![dark-ground seal](cw:seal) |
| Panel bar on phones, light theme | default mark | light | 1.25rem | ![default mark](cw:mark) |
| `/config` bar, dark only | dark-ground seal | dark | 1.375rem | ![dark-ground seal](cw:seal) |
| Docsite header (doubled by `--doc-scale`) | default mark | light | 1.35rem | ![default mark](cw:mark) |
| Every tab icon | default mark | light | 16px | ![default mark](cw:mark) |

### Logotype: the wordmark

The wordmark is live text, never an image, so it takes the theme's ink.

| Placement | Specimen | Face | Size | Weight | Tracking | Case | Colour | Opacity |
|---|---|---|---|---|---|---|---|---|
| Panel bar | commitwork | IBM Plex Sans | .78rem | 700 | .16em | uppercase | `--ink` | 1 |
| `/config` bar | commitwork | IBM Plex Sans | .78rem | 700 | .16em | uppercase | `--ink` | 1 |
| Panel bar on phones | commitwork | IBM Plex Sans | .7rem | 700 | .13em | uppercase | `--ink` | 1 |
| Empty-lane panel | commitwork | IBM Plex Sans | .78rem | 700 | .16em | lowercase | `--ink` | .55 |
| Docsite header | commitwork docs | IBM Plex Sans | .9375rem | 600 | normal | none | `--head` | 1 |

The lockup sets the seal and the wordmark on one line, with the wordmark .31rem (5px at the base)
from the seal. Below, at the panel's size and at twice that, drawn with the panel's own stylesheets:

```lockup
<header class="bar"><div class="row"><div class="mark"><span class="seal"><cw-seal></cw-seal></span><span class="wordmark">commitwork</span></div></div></header>
<div class="lk-zoom"><div class="bar"><div class="row"><div class="mark"><span class="seal"><cw-seal></cw-seal></span><span class="wordmark">commitwork</span></div></div></div></div>
```

### Elements in situ: documents

The docsite shell (`lib/docsite-page.mjs`) is the house document type. Where it sets no rule, the
row says so and shows the browser default inside the house face.

| Element | Specimen | Face | Size | Weight | Line height | Tracking | Colour | Marker | Indent | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| `h1` | Heading one | `--sans` | 1.9rem | 700 | 1.2 | −.015em | `--head` | | | Docsite rule; weight is the browser's bold |
| `h2` | Heading two | `--sans` | 1.28rem | 700 | 1.62 | −.01em | `--head` | | | Docsite rule |
| `h3` | Heading three | `--sans` | 1.02rem | 700 | 1.62 | normal | `--head` | | | Docsite rule |
| `h4` | Heading four | `--sans` | .9375rem | 700 | 1.62 | normal | `--head` | | | Colour only; size is the browser's 1em |
| `h5` | Heading five | `--sans` | .78rem | 700 | 1.62 | normal | `--head` | | | Colour only; size is the browser's .83em |
| `h6` | Heading six | `--sans` | .63rem | 700 | 1.62 | normal | `--head` | | | Colour only; size is the browser's .67em |
| `p` | A paragraph sets the measure and the rhythm of the page. This one runs long enough to wrap, so its line height shows. | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | | | Body rule; measure capped at 84ch |
| `div` | Text in a plain division inherits the body face and size. | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | | | No rule; inherits the body |
| `div p` | A paragraph inside a division is set exactly as one outside it. | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | | | Same as `p` |
| `ul li` | A list item | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | disc | 1.4rem | `ul,ol{padding-left:1.4rem}` |
| `ul li li` | A nested item | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | circle | 1.4rem | Browser marker for a nested list |
| `ol li` | A numbered item | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | decimal | 1.4rem | `ul,ol{padding-left:1.4rem}` |
| `ol li li` | A nested numbered item | `--sans` | .9375rem | 400 | 1.62 | normal | `--ink` | decimal | 1.4rem | Browser marker for a nested list |

### Elements in situ: the panel

The panel is a Mono surface (§4.1). It styles headings only where a component uses one; the rest is
the browser default inside the body face.

| Element | Specimen | Face | Size | Weight | Line height | Tracking | Colour | Marker | Indent | Source |
|---|---|---|---|---|---|---|---|---|---|---|
| `h1` | commitwork admin | `--sans` | .8125rem | 600 | 1.5 | −.01em | `--ink` | | | Screen-reader only (`.sr-only`); never painted |
| `h2` | Security coverage | `--sans` | .9375rem | 600 | 1.5 | −.01em | `--ink` | | | `.hd h2`, the section heading |
| `h3` | Scanner coverage | `--sans` | .8125rem | 600 | 1.5 | normal | `--ink` | | | `.card h3`, a card's title |
| `h4` | Disposition history | `--sans` | .719rem | 600 | 1.5 | normal | `--mut` | | | `.iss-sec>h4`, a sub-heading in an issue panel |
| `h5` | Heading five | `--mono` | .675rem | 700 | 1.5 | normal | `--ink` | | | No rule; browser .83em bold |
| `h6` | Heading six | `--mono` | .545rem | 700 | 1.5 | normal | `--ink` | | | No rule; browser .67em bold |
| `p` | 4,852 critical findings across 61 repositories; 12 are actively exploited. | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | | | Body rule |
| `div` | rollup 4d ago · 76 checks · 46 tools | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | | | Body rule |
| `div p` | A paragraph inside a card body. | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | | | Body rule |
| `ul li` | A list item | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | disc | 2.5rem | No general rule; browser 40px indent |
| `ul li li` | A nested item | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | circle | 2.5rem | No rule; browser marker and indent |
| `ol li` | A numbered item | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | decimal | 2.5rem | No general rule; browser 40px indent |
| `ol li li` | A nested numbered item | `--mono` | .8125rem | 400 | 1.5 | normal | `--ink` | decimal | 2.5rem | No rule; browser marker and indent |

## Components in lockup

Each lockup is the panel's own markup, drawn by `node bin/md-view.mjs` with the panel's stylesheets
(`panel.css`, `theme.css`, the workspace shell and `panel-light.css`), once on the dark ground and
once on the light. Read as plain Markdown, the markup shows instead. Tables are drawn narrower than
the panel's 40rem minimum so they fit a half-width column.

### Header bar and rail

```lockup
<header class="bar"><div class="row">
<div class="mark"><span class="seal"><cw-seal></cw-seal></span><span class="wordmark">commitwork</span></div>
<span class="scope-chip" data-scope="project">example-app</span>
<span class="gen" data-state="fresh">rollup 12m ago</span>
<div class="ctl-wrap"><div class="ctl"><button type="button" class="pri">▶ Run checks</button><button type="button">↻ Refresh</button></div></div>
</div></header>
<aside id="workspace-rail"><div class="rail-label">All projects</div>
<nav><button type="button" class="rail-link active">Overview</button><button type="button" class="rail-link">Rollups</button><button type="button" class="rail-link">Decisions &amp; reviews</button></nav></aside>
```

### Buttons

```lockup
<div class="actrow">
<button type="button">↻ Refresh</button>
<button type="button" class="pri">Run checks</button>
<button type="button" class="ph-update">Update</button>
<button type="button" disabled>Disabled</button>
</div>
<div class="actrow">
<button type="button" class="rec">⏺</button>
<button type="button" class="rec on">⏺</button>
<button type="button" class="lnk" data-dir="asc">Severity</button>
<button type="button" class="closed-toggle">Closed findings <span class="caret">▸</span></button>
<button type="button" class="cq-play">Run remediation</button>
</div>
```

### Tabs and count badges

```lockup
<nav id="groups">
<button type="button" class="gtab pri">Findings <span class="vn crit">12</span></button>
<button type="button" class="gtab">Work <span class="vn warn">3</span></button>
<button type="button" class="gtab">History <span class="vn"></span></button>
</nav>
<nav id="views">
<button type="button" class="vtab pri">Code security <span class="vn crit">4</span></button>
<button type="button" class="vtab">Dependencies <span class="vn warn">7</span></button>
<button type="button" class="vtab">Malicious packages <span class="vn triaged">0</span></button>
<button type="button" class="vtab lane-running">Secrets</button>
</nav>
<div class="actrow"><span class="lane-box on">✓</span><span class="lane-box off">·</span><span class="lane-box inherit">↳</span><span class="lane-box dash">?</span></div>
```

### Pills

```lockup
<div class="chiprow"><span class="pill live">live</span><span class="pill part">partial</span><span class="pill plan">planned</span><span class="pill unk">unknown</span><span class="pill na">n/a</span></div>
<div class="chiprow"><span class="pill crit">critical</span><span class="pill high">high</span><span class="pill med">medium</span><span class="pill low">low</span><span class="pill exploited">exploited</span></div>
<div class="chiprow"><span class="pill unrf">uncorroborated</span><span class="pill done">done</span><span class="pill attest">attested</span><span class="pill green-human">human-verified</span></div>
```

### Dots and freshness

```lockup
<div class="actrow"><span class="dot"></span><span class="gen" data-state="fresh">rollup 4m ago</span><span class="gen" data-state="stale">rollup 3h ago</span><span class="gen" data-state="old">rollup 4d ago</span><span class="gen" data-state="none">never scanned</span></div>
<div class="posture">
<span class="p-row"><span class="p-dot" data-s="ok"></span><span class="p-k">Sweep</span><span class="p-v">fresh · 12m</span></span>
<span class="p-row"><span class="p-dot" data-s="stale"></span><span class="p-k">Rollup</span><span class="p-v">stale · 2d</span></span>
<span class="p-row"><span class="p-dot" data-s="unknown"></span><span class="p-k">Runtime</span><span class="p-v" data-s="unknown">never scanned</span></span>
</div>
<div class="stack">
<div class="pk-state"><span class="pk-dot on"></span><span>passkey enrolled</span></div>
<div class="pk-state"><span class="pk-dot part"></span><span>enrolled, not yet confirmed</span></div>
<div class="pk-state"><span class="pk-dot none"></span><span>no passkey</span></div>
<div class="pk-state"><span class="pk-dot unk"></span><span>passkey state unknown</span></div>
</div>
```

### KPI tiles and section heading

```lockup
<div class="hd"><h2>Security coverage</h2><span class="n">76 checks</span></div>
<div class="kpis">
<div class="kpi"><div class="k">Findings</div><div class="v">4,852</div><div class="s">across 61 repositories</div></div>
<div class="kpi good"><div class="k">Passing</div><div class="v">68</div><div class="s">checks this sweep</div></div>
<div class="kpi warn"><div class="k">Stale</div><div class="v">5</div><div class="s">older than a day</div></div>
<div class="kpi bad"><div class="k">Exploited</div><div class="v">12</div><div class="s">on CISA KEV</div></div>
</div>
```

### Tables

```lockup
<div class="tw"><table><thead><tr><th>Check</th><th>State</th><th>Severity</th><th>Where</th></tr></thead><tbody>
<tr data-s="live"><td class="d"><b>Semgrep</b><span class="c">sast</span></td><td><span class="pill live">live</span></td><td><span class="pill crit">critical</span></td><td class="mono t-loc">src/server.mjs:523</td></tr>
<tr data-s="part"><td class="d"><b>Trivy</b><span class="c">iac</span></td><td><span class="pill part">partial</span></td><td><span class="pill med">medium</span></td><td class="mono t-loc">Dockerfile:4</td></tr>
<tr data-s="plan"><td class="d"><b>nuclei</b><span class="c">dast</span></td><td><span class="pill plan">planned</span></td><td><span class="pill na">n/a</span></td><td class="mono t-loc">—</td></tr>
<tr class="ann-row"><td class="d"><b>gitleaks</b><span class="c">secrets</span></td><td><span class="pill live">live</span></td><td><span class="pill low">low</span></td><td class="mono t-loc">test/fixture.env:2</td></tr>
</tbody></table></div>
```

### Cards

```lockup
<div class="card"><h3>Scanner coverage</h3>
<div class="kv"><span class="mut">Last sweep</span><span>12m ago</span></div>
<div class="kv"><span class="mut">Checks</span><span>68 of 76</span></div>
<div class="find"><code>js/request-forgery</code><span class="at">src/server.mjs:523</span></div>
<div class="find"><code>js/path-injection</code><span class="at">src/files.mjs:88</span></div>
</div>
```

### Forms and controls

```lockup
<div class="pf-form">
<div class="pf-field"><label>Display name</label><input class="pf-input" value="operator"></div>
<div class="pf-field"><label>Project</label><select id="proj"><option>example-app</option></select></div>
</div>
<div class="set-val"><input class="set-input" value="30"><span class="dur-units"><button type="button" class="dur-u on">min</button><button type="button" class="dur-u">h</button><button type="button" class="dur-u">d</button></span></div>
<label class="att-row"><input type="checkbox" class="att-box" checked><span class="att-lbl">Checked by hand</span></label>
```

### Menus

```lockup
<div class="pop">
<div class="pop-acct"><span class="avatar">OP</span><span class="acct-lines"><b>operator@example.com</b><span class="mut">signed in with a passkey</span></span></div>
<div class="pop-h">Preferences</div>
<div class="pop-fld"><span class="pop-lbl">Appearance</span><div class="theme-row"><button type="button" class="theme-opt" aria-checked="true">AUTO</button><button type="button" class="theme-opt" aria-checked="false">LIGHT</button><button type="button" class="theme-opt" aria-checked="false">DARK</button></div></div>
<button type="button" class="menu-view">Account &amp; security</button>
</div>
```

### Consoles and toasts

```lockup
<div class="card"><div class="con-head"><span class="con-title">Sweep</span><span class="pill part">running</span></div>
<div class="prog"><div id="sw-prog"></div></div>
<pre class="con-log">[semgrep] 214 files scanned in 12s
[trivy] 3 misconfigurations
[nuclei] no target configured</pre></div>
<div class="lane-toasts">
<div class="lane-toast ok">Semgrep finished · 3 new findings</div>
<div class="lane-toast bad">Trivy failed · exit 2</div>
<div class="lane-toast grey">nuclei ended with no result</div>
</div>
```

### Notices

```lockup
<div class="learn-box"><b>Learning mode</b>A lane is one kind of check, such as secrets or dependency vulnerabilities.</div>
<div class="banner-box">68 of 76 checks ran in the last sweep; 8 have no result yet.</div>
<div class="pf-once"><b>Write these down now.</b> Recovery codes are shown once.</div>
<div class="cq-remed"><span>3 findings can be remediated by the dual-agent prompt.</span><span class="cq-remed-act"><button type="button" class="cq-play">Run remediation</button></span></div>
<div class="pop"><div class="pk-err">NotAllowedError: the passkey prompt was dismissed.</div></div>
```

### Decision controls

```lockup
<div class="cw-surface">
<div class="actrow">
<button type="button" class="cw-btn">No thanks <span class="cw-keys"><span class="cw-kbd">esc</span></span></button>
<button type="button" class="cw-btn cw-btn--fill cw-btn--ok">Run 2 selected <span class="cw-keys"><span class="cw-kbd">⏎</span></span></button>
<button type="button" class="cw-btn cw-btn--fill cw-btn--neutral">Approve one <span class="cw-keys"><span class="cw-kbd">⌥</span><span class="cw-kbd">⏎</span></span></button>
<button type="button" class="cw-btn cw-btn--fill cw-btn--caution">Reach live <span class="cw-keys"><span class="cw-kbd">⌘</span><span class="cw-kbd">⏎</span></span></button>
<button type="button" class="cw-btn cw-btn--fill cw-btn--stop">Grant all <span class="cw-keys"><span class="cw-kbd">⌘</span><span class="cw-kbd">⇧</span><span class="cw-kbd">⏎</span></span></button>
<button type="button" class="cw-btn cw-btn--obsidian">Obsidian</button>
</div>
<div class="actrow"><button type="button" class="cw-pick">Select this</button><button type="button" class="cw-pick" aria-pressed="true">Selected</button></div>
<div class="cw-dialog">
<h3 class="cw-dialog__title">Approve semgrep?</h3>
<p class="cw-dialog__body">The scan runs <code>semgrep</code> from this machine against every repository in scope.</p>
<div class="cw-facts"><span>/opt/homebrew/bin/semgrep</span><span>61 repositories</span><span>network: none</span></div>
<p class="cw-note">It reads every file in scope.</p>
<div class="cw-actions"><button type="button" class="cw-btn">Decline</button><button type="button" class="cw-btn cw-btn--fill cw-btn--neutral">Approve</button></div>
</div>
<div class="cw-grid">
<div class="cw-row cw-row--group"><input type="checkbox" class="cw-tick" checked><span class="cw-row__name">sast</span><span class="cw-row__needs">semgrep, codeql</span></div>
<div class="cw-row cw-row--lane"><input type="checkbox" class="cw-tick" checked><span class="cw-row__name">semgrep</span><span class="cw-row__needs">local binary<span class="cw-badge cw-badge--binary">binary</span></span></div>
<div class="cw-row cw-row--lane"><input type="checkbox" class="cw-tick"><span class="cw-row__name">codeql</span><span class="cw-row__needs">GitHub token<span class="cw-badge cw-badge--perm">permission</span></span></div>
</div>
</div>
```

### The Linear livery

```lockup
<div class="cw-linear"><div class="cw-stage"><div class="cw-dlg">
<div class="cw-dlg__t">Scanning</div>
<div class="cw-dlg__b">Approve the tools this machine runs for a sweep. Approval is kept per binary.</div>
<div class="cw-meta"><span>46 tools</span><span>76 checks</span><span>local only</span></div>
<div class="cw-act"><button type="button" class="cw-ghost">Cancel</button><button type="button" class="cw-sev cw-sev--one">Approve one</button><button type="button" class="cw-sev cw-sev--go">Run</button><button type="button" class="cw-sev cw-sev--hold">Hold</button><button type="button" class="cw-sev cw-sev--all">Approve all</button></div>
</div></div></div>
```

## Rules for new work

1. **Take colour from tokens, never from literals.** A page the panel serves links
   `/static/panel.css`, plus `panel-light.css` behind the media switch in §2.1. A generated page
   inlines `ROOT_CSS` or `PAPER_CSS` from `lib/brand-tokens.mjs`. A new block of hex values is a
   second palette, and it will drift away from the first.
2. **Derive fills from their token.** Write `color-mix(in srgb, var(--crit) 12%, transparent)`, not
   an `rgba()` copied from today's value. A frozen literal keeps the old hue after the token moves.
3. **Give every themed token a light value.** A token that `panel-light.css` does not override keeps
   its bright dark-theme value on the light ground, where it fails.
4. **Size in `rem`.** Use px only for hairlines, accent rules, focus outlines and shadow offsets.
   Size dots, markers and the rings around them in `em`, so they grow with the label they sit
   beside. The root font scales with the window (§4.2).
5. **Never use colour as the only channel** (WCAG 1.4.1). A state also carries a word, a glyph, a dot
   shape or a position.
6. **Give the accent one meaning per treatment.** A solid accent fill means "this control acts". An
   accent rule under a tab means "you are here".
7. **Draw an unknown value as an absence:** a hollow dot, a dashed border, italic dim text, or no
   count badge at all. Never draw it as a zero or with a state colour.
8. **Honour `prefers-reduced-motion`.** Stop the animation and keep the marker it animates.
9. **Keep pages self-contained.** Fonts come from `/static/fonts/`, marks are inline SVG or data
   URIs, and nothing loads from a CDN.

## 1. Where the style lives

| File | Holds |
|---|---|
| `admin/static/panel.css` | `@font-face` rules, the dark tokens on `:root`, and every panel component |
| `admin/static/panel-light.css` | Light overrides of those tokens, plus three light-only rules |
| `admin/static/panel-cvd.css`, `panel-cvd-light.css` | Colour-vision palettes keyed on `:root[data-cvd]`. **Generated** by `bin/cvd-palette.mjs` |
| `admin/static/theme.css` | The `--cw-*` component vocabulary: decision buttons, keyboard hints, the approval dialog, the selection grid and the Linear livery (§8). `theme-demo.html` renders all of it |
| `admin/static/config.css` | Rules used only by `/config`. That page takes its tokens from `panel.css` |
| `admin/static/theme-switch.js`, `admin/lib/theme-head.mjs` | The Appearance choice on admin pages outside the panel shell, and the links those pages carry (§2.1) |
| `lib/house-css.mjs`, `bin/house-css.mjs`, `admin/static/house.css` | The house sheet for every other page, the tool that writes and checks its copies, and the copy the panel serves (§11) |
| `admin/menus/styles.html` | The workspace shell (top bar, side rail, larger controls). `bin/build-admin-panel.mjs` inlines it into `admin/index.html` |
| `lib/brand-tokens.mjs` | The palette transcribed for generators (`LIGHT`, `DARK`, `ROOT_CSS`, `PAPER_CSS`, `MONO`, `SANS`) and the marks: the default mark, the dark-ground seal and the tab-icon key. `bin/test/brand-tokens-parity.test.mjs` holds it equal to the two panel stylesheets |
| `lib/theme-follower.mjs` | `html[data-mode]` for pages the panel embeds or generates |
| `bin/lib/theme.mjs` | The terminal palette |

## 2. Light and dark

### 2.1 The panel

- **Dark is the default.** `panel.css` defines the dark tokens on an unguarded `:root`.
- **Light is an overlay.** `<link id="theme-light" href="/static/panel-light.css">` carries a
  `media` attribute, and that attribute is the switch. `CW_THEME_MEDIA` maps the three choices:

  | Choice | `media` value | Result |
  |---|---|---|
  | `auto` | `(prefers-color-scheme: light)` | Follows the OS |
  | `light` | `all` | Always light |
  | `dark` | `not all` | Always dark |

  The panel has no `data-theme` attribute. A rule keyed on one never matches.
- **Stored choice.** `localStorage['cw-theme']` holds `light` or `dark`; an absent key means auto. A
  head script applies it before first paint, so the page never flashes the other theme.
- **Colour-vision link.** `<link id="cvd-light">` is switched in lockstep with `theme-light`.
  Otherwise a manual light choice would keep the dark colour-vision palette.
- **Appearance control.** The account menu offers AUTO, LIGHT and DARK as a segmented radio group.
- **Other admin pages.** `/config`, the sign-in page and the placeholder pages `serve.mjs` answers
  with carry the same sheets, from `admin/lib/theme-head.mjs`, and load `/static/theme-switch.js`.
  - The script applies the stored theme and vision choices before first paint. It switches
    `theme-light`, `cvd-light` and any element marked `data-light`, and sets `html[data-mode]`.
  - It turns a `[data-theme-switch]` element into the same AUTO / LIGHT / DARK control: a tint with
    an accent rule under the selected segment.
  - An embedded page hides the control, because there the panel's menu owns the choice.
  - The sign-in page loads it before a session exists, so it is a public asset with its own route.
- **`/config` in both themes.** Its own rules take every colour from the tokens, so §3 holds for it.
  The pieces that are its own measure:

  | Element | Dark | Light |
  |---|---|---|
  | Filter chip, `--mut` on `--panel2` | 5.00 | 5.37 |
  | Selected chip and theme segment, `--ink` on `--wash` over `--bg` | 11.71 | 13.34 |
  | Tab, `--ink` on `--panel2` | 11.53 | 13.77 |
  | `editable` tag, `--dim` on `--bg` | 4.95 | 5.10 |
  | Path, `--acc` on `--panel` | 6.81 | 5.66 |
  | Action button, `--on-acc` on `--acc` | 7.64 | 5.66 |

### 2.2 Embedded and generated pages

- **`FOLLOWER_JS`** (`lib/theme-follower.mjs`) sets `<html data-mode="light|dark">` and
  `color-scheme` before first paint.
  - It reads `localStorage['cw-theme']` first and falls back to `(prefers-color-scheme: light)`.
  - It re-applies on the `storage` event, so an embedded page follows the panel's menu without a
    reload.
  - `?mode=light|dark` pins a page, for a screenshot or a link. Loading a page never writes the key.
  - Pages key their palettes on `html[data-mode]`.
- **The `#theme` toggle** (`TOGGLE_JS`) appears only on standalone pages. When a page is embedded,
  the panel's menu owns the choice.
- **`ROOT_CSS`** is light-first with a `prefers-color-scheme: dark` override. A page that inlines it
  follows the OS and has no manual choice.

### 2.3 Docsite

The docsite is a documents site laid out as bond paper. `PAPER_CSS` paints the light palette only,
with no dark override. A reader in dark mode still gets paper, because a paper livery that turned
black would stop being paper. Print swaps in `#fff` grounds and darker rules (`lib/docsite-page.mjs`).

The editor (`docsite/editor/editor.css`) is an operator tool, not a document. It has a dark theme,
driven by its own `data-theme` toggle.

### 2.4 Colour-vision palettes

Two stylesheets hold these palettes:

- `admin/static/panel-cvd.css` for the dark theme;
- `admin/static/panel-cvd-light.css` for the light theme.

`bin/cvd-palette.mjs` generates both files. **Do not edit them by hand.**

**How a palette is chosen.** The Vision menu stores its choice in `localStorage['cw-cvd']` and
applies it as `:root[data-cvd]` before first paint. When no palette is selected the attribute is
absent, and the default palette applies. A palette re-grades only the semantic tokens: `--sev`,
`--crit`, `--high`, `--med`, `--low`, `--live`, `--part`, `--plan`, `--machine` and `--attest`.

**How the colours were found.** Candidates are searched, not picked by eye.

1. Keep only candidates that reach 4.5:1 or more on that theme's ground.
2. From those, choose the set that maximises the minimum pairwise CIELAB ΔE76 under that condition's
   simulation. The simulation is Machado, Oliveira and Fernandes (2009) at severity 1.0.

**Which colour axis each palette uses.**

| Palette | Axis used |
|---|---|
| Protanopia and deuteranopia | Move onto the blue–yellow axis, which these readers keep |
| Tritanopia | Keeps the reds. Only the exploited band moves |
| Achromatopsia | Separates colours within a group, but not across groups. Position and labels carry the rest |

**Limits.** Colour carries identity, and the order of rows carries rank. The generator grades
against the panel's own grounds (`DARK.bg` and `LIGHT.bg` from `lib/brand-tokens.mjs`), and every
palette clears 4.5:1 on `--bg`, `--panel` and `--panel2` and as a pill; the worst pair measures
5.08:1.

**The default palette is not safe by default.** The dark severity ramp (red, red-orange, orange,
amber) cannot be ordered by a reader with protanopia or deuteranopia, and the selector does not fix
that for readers who never open it.

## 3. Colour

### 3.1 Ground and ink

Each contrast cell reads ground by ground: `--bg` · `--panel` · `--panel2`.

| Token | Dark | Light | Role | Contrast, dark | Contrast, light |
|---|---|---|---|---|---|
| `--bg` | `#17181a` | `#f4f3ef` | Page ground: warm dark grey, or bond paper | — | — |
| `--panel` | `#1e1f22` | `#ffffff` | Cards, tables, popouts, the side rail | — | — |
| `--panel2` | `#26272a` | `#eae8e2` | Raised surfaces: table headers, row hover, the active tab, inputs | — | — |
| `--line` | `#333438` | `#d8d5cc` | Structural hairline | — | — |
| `--line2` | `#44454a` | `#b9b6aa` | Control borders; the hairline under table headers | — | — |
| `--head` | `#f4f3ef` | `#101011` | Headings, table headers, dialog titles | 16.00 · 14.84 · 13.45 | 17.13 · 19.02 · 15.52 |
| `--ink` | `#e4e2dc` | `#1c1d1f` | Body text | 13.71 · 12.72 · 11.53 | 15.19 · 16.87 · 13.77 |
| `--mut` | `#98958e` | `#5f5d57` | Secondary text and labels | 5.94 · 5.51 · 5.00 | 5.93 · 6.58 · 5.37 |
| `--dim` | `#8a877e` | `#69675f` | Tertiary text: stamps, captions, placeholders | 4.95 · 4.59 · 4.16 | 5.10 · 5.67 · 4.62 |

`--dim` is set on `--bg` and `--panel` only. In light it passes on every ground, but dark `--dim`
measures 4.16:1 on `--panel2`, so tertiary text on a raised surface uses `--mut`. A dark `--dim`
that passed there would be `#908d84`, only ΔE 3 from `--mut`, which would erase the tertiary level.

The dark ramp holds its hue near neutral, so the gold accent is the only chromatic thing on the
surface.

### 3.2 Accent

| Token | Dark | Light | Role | Contrast, dark | Contrast, light |
|---|---|---|---|---|---|
| `--acc` | `#c9a227` | `#885f25` | Gold, and paper gold. Primary fill, selection rule, focus ring, links, progress fill | 7.34 · 6.81 · 6.17 | 5.10 · 5.66 · 4.62 |
| `--acc2` | `#9a7b1d` | `#6e5220` | Borders on hover and selection; the left rule on notes | 4.42 · 4.10 · 3.72 | 6.54 · 7.26 · 5.93 |
| `--wash` | `rgba(201,162,39,.10)` | `rgba(136,95,37,.10)` | Tinted selected state: segmented control, learning box, rail item | — | — |
| `--on-acc` | `#1a120e` | `#ffffff` | Ink on a solid `--acc` fill: the skip link, `/config`'s action buttons and the docsite editor's buttons | 7.64 on `--acc` | 5.66 on `--acc` |

Dark `--acc2` is under 4.5:1 on every dark ground (4.42 · 4.10 · 3.72), so it is a border colour,
never text; as a border it clears the 3:1 that WCAG 1.4.11 asks of a control's edge.

- **Hover moves the edge, not the text.** A hover changes a control's border to `--acc` or `--acc2`.
- **Filled gold takes dark ink in dark.** `#1a120e` measures 7.64:1 on `#c9a227`.
- **Filled paper gold takes light ink in light.** White measures 5.66:1 and `--bg` 5.10:1 on
  `#885f25`; `#1a120e` would measure 3.26:1, so `--on-acc` is white in light.

### 3.3 Status

Pill contrast is the token on its own pill fill over `--panel`, dark · light.

| Token | Dark | Light | Meaning | Contrast, dark | Contrast, light | Pill contrast |
|---|---|---|---|---|---|---|
| `--live` | `#5fd08a` | `#047734` | Running or passing now: a measured pass, a live lane, an enrolled passkey | 9.20 · 8.53 · 7.74 | 5.12 · 5.69 · 4.64 | 6.72 · 5.26 |
| `--part` | `#d69a52` | `#955906` | Partial, stale or pending; a warning that does not block | 7.28 · 6.75 · 6.12 | 5.10 · 5.66 · 4.62 | 5.50 · 5.14 |
| `--plan` | `#8a92a5` | `#5b6675` | Not evaluated, planned, or produced no result (`noscan`) | 5.70 · 5.29 · 4.79 | 5.25 · 5.83 · 4.76 | 4.60 · 4.97 |

### 3.4 Severity and exploitation

| Token | Dark | Light | Meaning | Contrast, dark | Contrast, light | Pill contrast |
|---|---|---|---|---|---|---|
| `--crit` | `#fe5b66` | `#c32b25` | Critical | 5.84 · 5.42 · 4.91 | 5.12 · 5.69 · 4.64 | 4.64 · 4.71 |
| `--high` | `#fe5d30` | `#9c4221` | High | 5.77 · 5.35 · 4.85 | 5.88 · 6.53 · 5.33 | 4.61 · 5.45 |
| `--med` | `#f18b2e` | `#a14a02` | Medium | 7.17 · 6.65 · 6.03 | 5.41 · 6.01 · 4.90 | 5.47 · 5.04 |
| `--low` | `#f9bd30` | `#765e02` | Low | 10.45 · 9.69 · 8.78 | 5.61 · 6.23 · 5.08 | 7.48 · 5.25 |
| `--sev` | `#b47cff` | `#7b2ff7` | Actively exploited (on CISA KEV). Reserved for this one signal | 6.15 · 5.70 · 5.17 | 5.27 · 5.85 · 4.77 | 4.80 · 4.85 |
| `--sev-fill` | `rgba(74,35,130,.55)` | `rgba(123,47,247,.12)` | Fill for the exploited pill | — | — | — |

**Hue carries the severity ramp.** It runs red, red-orange, orange, amber, and its lightness is not
monotonic: forcing it to be would suppress the hue separation the ramp depends on. Adjacent dark
steps are ΔE 28, 28 and 28. Dark critical is a light rose-red: a pure red cannot clear AA on
`--panel2` or as a pill on the dark ground, and lightening red along its own hue lands on high.

In light every severity colour has to be dark to pass, so the steps sit closer: ΔE 24, 14 and 31
from critical to low, and medium and low sit ΔE 14 and 18 from `--part`. Every pill also carries its
word, so no state rests on hue alone.

**Exploitation is a kind of fact, not a higher severity.** It therefore leaves the red ramp entirely
and takes violet. Violet sits on the blue–yellow axis, which survives protanopia and deuteranopia.

**Rank comes from `rankOf`.** Table order carries rank, not colour. To change where exploited
findings rank, change `rankOf`; never repaint the palette.

**The exploited fill is inverted between themes.**

| Theme | Fill | Ink | Why |
|---|---|---|---|
| Dark | Heavy (.55) | Light | The row must survive a glance down a long table. Over `--panel` the fill composites to `#362157`, the ink on it measures 4.80:1, and it stays above 4.5:1 up to a fill of .70 |
| Light | .12 tint | Dark | Over `--panel` the ink measures 4.85:1 at .12 and 4.40:1 at .18. At .55 the tint composites to `#b68dfb` and the ink falls to 2.28:1 |

**CRA reporting clocks** escalate through `--cra-50`, `--cra-75`, `--cra-90` and `--cra-over`, at 50,
75 and 90% of a deadline and past it. They are aliases of `--low`, `--med`, `--high` and `--crit`
(`panel.css` `:root`). An escalation ramp is a heat scale, so it takes the severity hues, and the
light theme and every colour-vision palette re-grade the clocks with the ramp. On the case box's
`--panel2` ground they measure 8.78 · 6.03 · 4.85 · 4.91 in dark and 5.08 · 4.90 · 5.33 · 4.64 in
light. The lowest under a colour-vision palette is 4.60 (light, protanopia). The later bands also
step up in weight, 600 then 700, so the escalation does not rest on hue.

**Dials take the same ramp.** The scanner taxonomy (`bin/scanner-taxonomy-render.mjs`) draws its gain
dial up the escalation steps, `--low`, `--med`, `--high`, `--crit`, and its closure dial down them,
ending on `--live` for a class solved and pinned. Both take the values of the theme rendered. The
arc's length and the dial's label also carry the level, so hue is never the only channel.

### 3.5 Lifecycle, attribution and evidence

These are separate axes from severity, and they never borrow its tokens.

| Token | Dark | Light | Meaning | Contrast, dark | Contrast, light | Pill contrast |
|---|---|---|---|---|---|---|
| `--done`, `--done-fill` | the `--sev` values | the `--sev` values | A completed plan or task. It has its own name so a finished plan never renders through the severity vocabulary | 6.15 · 5.70 · 5.17 | 5.27 · 5.85 · 4.77 | 4.61 · 4.70 |
| `--machine` | `#8a9a5b` | `#5c6b33` | Olive. Written by an agent, or supplied by an environment override. Reads as "handled" without claiming a human decision | 5.80 · 5.38 · 4.87 | 5.25 · 5.82 · 4.75 | — |
| `--attest` | `#6fb3d2` | `#1b6a8c` | Blue. Verified and signed for by a person. It is never `--live`: a measurement and a signature are different evidence | 7.66 · 7.11 · 6.44 | 5.42 · 6.02 · 4.92 | 5.73 · 5.50 |

The lifecycle triple is done (violet), active (`.pill.live`) and pending (`.pill.part`). The three
hues sit on two colour-vision axes, so no pair of states is separated by weight alone.

### 3.6 Fills and alpha conventions

| Use | Recipe |
|---|---|
| Pill fill / border | token at 12% / 28% |
| Count badge | Default: `--mut` on a `--panel2` fill inside a 1px `--line2` ring. Graded: no fill, a 1px ring of the token at 45%, and the token as ink |
| Glow ring around a status dot | `0 0 0 .23em`–`.29em` (3px at the base, in `em` so it grows with the dot), token at 14–16% |
| Wash (selected tint) | accent at 10% |
| Error box (`.pk-err`) | `--crit` at 8% fill, 35% border |
| Page glow | `radial-gradient(120% 55% at 50% -8%, <accent> 6%, transparent 60%)` |
| Sticky bar | `color-mix(in srgb, var(--bg) 90%, transparent)` with `backdrop-filter: blur(8px)`. An opaque `var(--bg)` is declared first as the fallback |

### 3.7 Colours that are deliberately literal

| Literal | Where | Why it is not a token |
|---|---|---|
| `#1a120e` | Ink on every gold or semantic fill | Dark ink passes AA on every fill in the palette; white fails on all of them |
| `#FFFFFF`, `#101011`, `#14161A`, `#C9A227` | The marks | The logo's own colours: the default mark and the dark-ground seal (§9) |
| `#fff` ground, `#16171a` ink, `#e3e1db` rules | `/perf` JSON editor modal (`.pc-modal`) | White in both themes, at the operator's request |
| `#fff` | `.cw-pick`, the `#svcframe` ground | "Select this" sits outside the semantic family; the frame hosts foreign pages |
| `#000` | Sign-in field ink, light theme only (`admin/lib/login-page.mjs`) | The operator's rule of 2026-09-02: pure black field text. On the dark ground it would vanish, so dark keeps `--ink` |
| `#fff` | The sign-in QR frame (`.qr`) | A scanner reads dark modules on a light quiet zone, in either theme |
| `#4285F4`, `#34A853`, `#FBBC05`, `#EA4335` | The Google mark on the sign-in SSO button | Google's own logo colours, which are not recoloured |
| `#cfccc4`, `#fff` | The checkerboard under `lib/md-view.mjs` swatches (`--checker`) | It shows a colour's alpha, so it stays the same in both themes |
| `38;2;R;G;B` inline spans | `ansiHtml()` in the sweep console | The colour is data, read from a running scanner's output |

## 4. Typography

### 4.1 Faces

| Face | Weights shipped | Stack |
|---|---|---|
| IBM Plex Sans | 400, 400 italic, 500, 600, 700 | `"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif` |
| IBM Plex Mono | 400, 600, 700 | `"IBM Plex Mono",ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace` |

**How the faces are loaded.** Both are self-hosted Latin-1 subsets in `admin/static/fonts/`, as
`woff2` files with `font-display:swap` and a `unicode-range`. Their licence is `LICENSE-IBM-Plex.txt`.
Generators outside the panel use `MONO` and `SANS` from `lib/brand-tokens.mjs`; these are the same
stacks without the Plex names.

**Mono is the panel's body face.** It suits a surface made mostly of figures, identifiers, paths and
hashes. Use Sans for:

- headings;
- tabs, buttons and menu labels;
- names inside tables (`.name`, which sets Sans at 600);
- the wordmark.

Keep Mono wherever text is columnar. `/config` and the docsite are prose, so their body text is Sans.

**Only static weights ship.** `theme.css` asks for 510, 520, 560, 590 and 650, and CSS font matching
resolves each one upward: 510, 520, 560 and 590 render as 600, and 650 renders as 700. The Linear
livery names `"Inter"`, which is not shipped, so it falls back to the system face.

### 4.2 Root size

Every size is in `rem`, and the root scales with the window:

```css
html{font-size:clamp(16px, min(calc(16px * 100vh / 1080), calc(16px * 100vw / 1600)), 24px)}
```

A head script uses the same rule with screen height × DPR. It holds 16px below 900px of width and
re-runs on resize.

- **The rule takes the smaller ratio.** A narrow window on a 4K display gets small text, because a
  big monitor is not the same as a big window.
- **The ceiling is 24px (150%).** A 32px root would push the 40rem tables and the tab strip past
  the window.
- **The docsite doubles its base** with `--doc-scale:2`.

### 4.3 Scale

Pixel values are at the 16px base.

| Step | rem | px | Use |
|---|---|---|---|
| `.t-micro` | .625 | 10 | WCAG 2.2 marker inside a level cell, set as a pill at .04em tracking |
| `.t-tag` | .625 | 10 | Table headers; a pill worn as a tag |
| `.t-meta` | .656 | 10.5 | Annotations, KPI keys, pills, count badges, freshness stamps |
| `.t-loc` | .6875 | 11 | Located things: `file:line`, a commit, a batch id, an age |
| `.t-note` | .719 | 11.5 | Explanatory prose, the page foot, section counts |
| `.t-body` | .75 | 12 | Table body, card rows |
| body | .8125 | 13 | Page body (Mono) |
| `.t-title` | .8125 | 13 | Card titles, section tabs, row names |
| `.t-lead` | .875 | 14 | Lead line of a fleet card; controls in the workspace shell |
| `.hd h2` | .9375 | 15 | Section heading |
| `.t-mark` | 1 | 16 | An emoji standing in for a vendor mark; the empty-lane heading |
| `.kpi .v` | 1.25 | 20 | KPI figure |

`/config` sets its prose at .71875rem with 1.55 line height and −.006em tracking. It uses a
1.1875rem `h1` and a 1.4375rem KPI figure. The docsite body is .9375rem at 1.62 line height, with a
1.9rem `h1`.

**Small text.** The floor is .625rem, 10px at the base.

- **Nothing smaller.** No text is set below .625rem.
- **.625rem is for tags.** It is used only for short uppercase labels, badges and tags, at weight
  600 or more and .04em tracking or more.
- **The meta step, .656rem,** holds a short annotation, key, pill, badge or stamp of one line.
- **Sentences and values** start at .6875rem, and so does any note that wraps.
- **The exception is a glyph.** A marker that is only a glyph and is hidden from assistive technology
  (`aria-hidden`, or CSS `content` with empty alternative text) may go smaller. Two do: the `▸`
  disclosure marker on `/config`'s repository rows, and the `.mark-lm` vendor badge.

### 4.4 Weight, tracking and case

| Treatment | Value |
|---|---|
| Body | 400 |
| Tabs, account name | 500 |
| Headings, card titles, pills, active tab, names | 600 |
| Wordmark, sub-section headers in the scanner table | 700 |
| `h1`, `h2` tracking | −.01em |
| KPI figure tracking | −.02em |
| Button tracking | .02em |
| Uppercase labels | `th` .08em · KPI key .1em · field label .1em · scope and menu headings .11em · primary button .12em · rail label .14em · wordmark .16em |

**Uppercase is for short labels only:** table headers, KPI keys, field labels, section labels, the
primary button and the wordmark. Never set sentences in uppercase.

### 4.5 Numerals, line height and measure

- **Figures that line up take tabular numerals.** Use `.tnum`, which sets
  `font-variant-numeric:tabular-nums`. Counts and timers also use it.
- **Line height depends on the text:**

  | Text | Line height |
  |---|---|
  | Body | 1.5 |
  | Prose blocks | 1.55–1.65 (the remediation plan is 1.65) |
  | Menus and badges | 1.3–1.45 |
  | Tabs | 1.3 |

- **Cap the line length (measure) at the job the text does:**

  | Text | Measure |
  |---|---|
  | Empty-lane text | 52ch |
  | Setting notes | 62ch |
  | Model reasoning | 70ch |
  | Learning notes | 78ch |
  | Docsite paragraphs | 84ch |
  | Verdict reasoning | 90ch |
  | Comment-review columns | 80ch |

## 5. Spacing and layout

### 5.1 Units and steps

Spacing uses sixteenths of a rem (1px at the base). These are the working steps:

`.125 · .1875 · .25 · .3125 · .375 · .4375 · .5 · .5625 · .625 · .6875 · .75 · .8125 · .875 · 1 · 1.25 · 1.625 · 2 · 3 · 5` rem

Gaps inside a control are .25–.5rem. Gaps between controls are .5–.75rem. Page-level gaps are
1.25rem and up.

The named rhythm classes are:

| Class | Value |
|---|---|
| `.gap-t` | .5rem top |
| `.gap-banner` | .75rem below a coverage banner |
| `.gap-strip`, `.gap-top` | .875rem |
| `.hd-sub` | 1rem, for a second section within one tab |

### 5.2 Page frame

| Element | Value |
|---|---|
| Content column | `--colw: 75rem` (1200px). `.wrap`, the bar row and the three consoles all read it |
| `.wrap` | `max-width:var(--colw); padding:0 1.25rem 5rem` |
| Section | `margin:1.625rem 0` |
| Section heading `.hd` | baseline flex, gap .6875rem; `padding-bottom:.5rem`, `margin-bottom:.8125rem`, 1px `--line` rule below |
| Bar (base panel) | sticky; row padding .8125rem 1.25rem; `margin-bottom:1.375rem` |
| Workspace shell bar | `min-height:4.75rem`; padding .85rem 1.5rem; gap 1rem |
| Side rail | `--rail-width:13rem`; padding 1.5rem .875rem; `--panel` ground with a `--line` rule on the right; fixed below the bar |
| Content context | padding 1.35rem 1.5rem .25rem |
| Page foot | `margin-top:2rem`; `padding-top:.875rem`; `--line` rule above; `--dim` text at .719rem |
| `/config` column | 96rem |
| Docsite column | 55rem, with 1.5rem side padding |

### 5.3 Component padding

| Component | Padding | Other |
|---|---|---|
| Button (panel) | .375rem .75rem | Workspace shell: .5rem .85rem, `min-height:2.5rem`; phones: `min-height:2.25rem` |
| Section tab `.gtab` | .375rem .875rem | Gap .4375rem |
| View tab `#views .vtab` | .25rem .5625rem | `max-width:11rem`; strip gap .25rem |
| Rail link | .7rem .75rem | `min-height:2.75rem` |
| Card | .9375rem 1rem | `.card-tight` is .75rem .875rem |
| KPI tile | .8125rem .875rem | Grid `minmax(9.875rem,1fr)`, gap .6875rem |
| Table `th` / `td` | .625rem .8125rem / .5625rem .8125rem | Phones: .5rem .625rem |
| Pill | .125rem .5rem | Dot .57em (6px at the base); gap .3125rem |
| Count badge | .0625rem .3125rem | — |
| Input | .1875rem .375rem | `.pf-input`: .375rem .5625rem |
| Console log, pre block | .5625rem .6875rem | — |
| Popout menu | .3125rem | Workspace shell: .75rem |
| Dialog (`theme.css`) | 1.1rem 1.2rem 1.2rem | Width `min(34rem, 100vw − 2rem)` |

### 5.4 Breakpoints

| Width | Change |
|---|---|
| ≤ 1400px | The last table column (the one the operator acts in) becomes sticky on the right |
| ≤ 1100px | The workspace bar hides the freshness stamp and tightens |
| ≤ 800px | The rail becomes a drawer behind **☰ Navigate** over a .45 scrim; the bar wraps |
| ≤ 720px | Two-column grids stack |
| ≤ 640px | Phone layout: the tab strip becomes one scrolling row; tables drop to `min-width:34rem` and keep scrolling, with no hidden columns; padding tightens |
| ≤ 45em | `/config` definition lists and grids stack |

## 6. Shape, depth, motion and focus

### 6.1 Radii

| Radius | Use |
|---|---|
| 0 | Segments inside a segmented control; workspace-shell inputs and the check picker |
| 2px | Small selects in menus, legend keys |
| 3px (`--cw-r-sm`) | Buttons: panel, workspace shell and decision buttons |
| .25rem | Lane boxes, the segmented-control group |
| .3125rem | Count badges, chips |
| .375rem | Inputs, notes, credential figures |
| .5rem | Section tabs, popouts, banners, consoles, pre blocks |
| .625rem / 10px (`--cw-r-lg`) | Cards, table wrappers, KPI tiles, posture strip, dialog, workspace sections |
| 999px | Pills and pill-shaped badges |
| 50% | Dots, avatars, the seal |

**A radius belongs to the group, never to a segment inside it.**

### 6.2 Borders and rules

| Border | Meaning |
|---|---|
| 1px `--line` | Structure |
| 1px `--line2` | Controls |
| 3px left rule | State: KPI tiles, the descriptor cell in scanner tables, toasts, remediation bars, CRA cases, notes, the learning box |
| `inset 0 -2px 0 0 var(--acc)` | Selected: section tab, view tab, workspace segment |
| `inset 2px 0 0 var(--acc2)` on the first cell | A hovered table row. It is never a fill: a fill darkens the ground under every pill in the row |
| 2px `--acc` bottom border | The primary button |
| 2px `--acc` left rule over `--wash` | The active rail item |
| Dashed | Unknown or provisional: `.pill.unk`, the unknown passkey dot, the one-shot enrolment block, model reasoning, a partially configured lane |
| Dotted | In progress: the running-lane ring |
| Hairline dashed `--line` | Separates rows inside a card (`.kv`, `.find`) |

### 6.3 Elevation and scrims

| Layer | Shadow or scrim |
|---|---|
| Popout menu | `0 8px 24px rgba(0,0,0,.35)` |
| Toast | `0 2px 10px rgba(0,0,0,.35)` |
| Dialog | `0 14px 36px rgba(0,0,0,.55)`; scrim `rgba(10,10,12,.72)` |
| `/perf` editor modal | `0 1rem 3rem rgba(0,0,0,.45)`; scrim `rgba(0,0,0,.55)` |
| Rail drawer | `12px 0 35px rgba(0,0,0,.25)`; scrim `rgba(0,0,0,.45)` |
| Sticky last column | `-0.5rem 0 .5rem -0.5rem rgba(0,0,0,.45)` marks the seam |

**Stacking order (`z-index`):**

| Layer | z-index |
|---|---|
| Sticky table cell | 1 |
| Bar | 5 |
| Popout menu | 10 |
| Rail drawer scrim | 14 |
| Rail | 15 |
| Workspace bar | 20 |
| Skip link | 20 |
| Dialog scrim / dialog | 40 / 41 |
| Toasts, `/perf` modal | 60 |

### 6.4 Motion

| Motion | Timing |
|---|---|
| Control transitions | .14s |
| Glow transitions | .16s |
| Progress fill width | .3s |
| Spinner | .7s linear |
| Running-lane ring | 1.6s linear, dotted, with the right edge open |
| First-run pulse | 1.6s ease-in-out, opacity 1 → .35 |
| Record pulse | 1.1s |

Under `prefers-reduced-motion:reduce`, every animation stops and every marker stays visible.

### 6.5 Focus

- **Focus ring.** Every interactive element shows `outline: 2px solid var(--acc)` with a 2px offset.
  Lane boxes and notes use a 1px offset; the workspace shell uses 3px.
- **Skip link.** It is the first focusable element. It stays off-screen until focused, then pins at
  .75rem, set in Sans 600 over the accent.
- **The page title is screen-reader only.** It sits in `.sr-only`, because the wordmark already
  states the name visually.
- **Touch targets.** The attestation checkbox is 1.5rem, which meets the WCAG 2.2 24×24 minimum
  (2.5.8). Workspace-shell controls are 2.5–2.75rem tall.

## 7. Panel components

**Buttons**

- **Base.** Sans .78125rem with .02em tracking, `--ink` on `--panel`, a 1px `--line2` border and a
  3px radius. On hover the border becomes `--acc`. A disabled button is at .55 opacity.
- **`.pri`.** A gradient from `--panel2` to `--panel`, `--head` ink, a 2px `--acc` bottom rule, 600
  weight, and uppercase at .12em tracking.
- **`.ph-update`.** Swaps the bottom rule to `--part`.
- **The run control.** While a sweep runs, its bottom rule turns `--crit`.
- **`.rec`.** Stays quiet until hovered.

**Tabs**

- **Two levels.** Sections (`.gtab`) sit above views (`.vtab`).
- **Resting.** `--mut` on the bar's `--bg`.
- **Hover.** `--ink` on `--panel2`.
- **Active section.** `--panel2` surface, `--acc2` border and the inset accent rule.
- **Active view.** A transparent ground with the inset rule only, so the two levels never both look
  current.
- **Solid accent fill never marks a tab.**
- **Workspace shell.** Sections (`#groups .gtab`) lose their box: `--mut` at rest, `--ink` with the
  inset accent rule when current. Rail links are `--mut` on `--panel`, `--ink` on `--panel2` on
  hover, and `--ink` on `--wash` over `--panel` with a 2px `--acc` left rule when current.

| State | Dark | Light |
|---|---|---|
| Resting tab, `--mut` on `--bg` | 5.94 | 5.93 |
| Hovered tab, `--ink` on `--panel2` | 11.53 | 13.77 |
| Current shell section, `--ink` on `--bg` | 13.71 | 15.19 |
| Rail link at rest · hovered · current | 5.51 · 11.53 · 10.76 | 6.58 · 13.77 · 14.73 |

**Count badges (`.vn`)**

- **Default.** Mono .656rem, `--mut` on a `--panel2` fill inside a 1px `--line2` ring. The ring
  keeps the badge's edge on a hovered or current tab, whose ground is also `--panel2`.
- **Graded states.** `.warn` is `--part`; `.crit` is `--crit` at 600; `.triaged` is `--machine`.
  A graded badge has no fill: a 1px ring of its token at 45% and the token as ink.
- **Unknown count.** Render no badge at all (`:empty` hides it). Never render a 0 for a lane that
  was not read.
- **Zero.** A measured zero keeps the quiet default.
- **Workspace shell.** Badges become outlined 999px pills: `--mut` ink with a `--line2` border;
  `.warn` in `--ink` with an `--acc` border; `.crit` as a solid `--acc` fill with `--bg` ink.

Each badge is measured on its tab's ground: the bar's `--bg` at rest, `--panel2` when the tab is
hovered or current. The shell's rail puts its badges on `--panel`.

| Badge | Dark | Light |
|---|---|---|
| Default, `--mut` on `--panel2` | 5.00 | 5.37 |
| `.warn`, `--part` · `--bg` · `--panel2` | 7.28 · 6.12 | 5.10 · 4.62 |
| `.crit`, `--crit` · `--bg` · `--panel2` | 5.84 · 4.91 | 5.12 · 4.64 |
| `.triaged`, `--machine` · `--bg` · `--panel2` | 5.80 · 4.87 | 5.25 · 4.75 |
| Shell, outlined `--mut` · `--bg` · `--panel` · `--panel2` | 5.94 · 5.51 · 5.00 | 5.93 · 6.58 · 5.37 |
| Shell `.warn`, `--ink` · `--bg` · `--panel` · `--panel2` | 13.71 · 12.72 · 11.53 | 15.19 · 16.87 · 13.77 |
| Shell `.crit`, `--bg` on `--acc` | 7.34 | 5.10 |

The tinted badges these replaced failed: the default was 3.20 dark and 3.24 light on its `--line2`
fill, and the 16–18% tints fell as low as 3.55 (light `.crit` on `--panel2`). Every colour-vision
palette clears 4.5 on the badges as they are now.

**Pills**

- **Status.** `live`, `part`, `plan`.
- **Severity.** `crit`, `high`, `med`, `low`, each filled from its token at 12%.
- **Exploited.** `--sev` ink on `--sev-fill`, at 600.
- **`unrf`.** An uncorroborated zero: `--sev` ink at a 12% fill and 40% border.
- **`done`.** The lifecycle state: 14% fill, 38% border.
- **Human verification.** `attest` and `green-human`, both in `--attest` blue.
- **`unk`.** `--mut` ink, transparent, with a dashed border.
- **`na`.** `--plan` ink with a hollow dot, at .72 opacity. It is quieter than `unk` because it is a
  settled answer.

**Dots**

Every dot and its halo is sized in `em` against the label it marks, so it grows with that label.
The px figure in brackets is each size at the 16px base. Hollow outlines stay 1–1.5px, as hairlines.

| Dot | Size and meaning |
|---|---|
| `.dot` | .69em (9px), with a .23em halo |
| `.gen::before` | .57em (6px) freshness dot, .29em halo: fresh (`--live`), stale (`--part`), old (`--crit`), none (hollow `--plan` ring) |
| `.p-dot` | .7em (8px) posture dot, .26em halo: ok, stale, unknown (hollow) |
| `.pk-dot` | 1.23em (8px beside its .40625rem label): unknown (dashed hollow), none (solid `--dim`), on (`--live`), unconfirmed (`--part`) |
| `.pill::before` | .57em (6px), in the pill's own colour |
| `.vtab.lane-running::after` | .73em (8px) dotted ring after a tab label while its lane runs |

**Other panel components**

- **KPI tile.** `--panel` ground and a 3px left bar in `--acc`; `good`, `warn` and `bad` turn the bar
  `--live`, `--part` and `--crit`. The key is an uppercase .656rem label; the figure is Sans 600 at
  1.25rem.
- **Posture strip.** A Mono row of state dots. An unknown value renders as italic `--dim`, never as
  a number.
- **Tables.** Wrapped in `.tw`, which scrolls horizontally. Tables have `min-width:40rem`. Headers
  are Mono uppercase `--head` on `--panel2`; a hovered row takes a 2px `--acc2` rule on its first cell, never a fill. The first cell carries a 3px
  state rule. A sortable header is a real `<button class="lnk">` with ▲/▼ in `--acc`.
- **Forms.**
  - Inputs are Mono, `--ink` on `--panel2` (or on `--bg` for profile fields), with a 1px `--line2`
    border.
  - On hover the border becomes `--acc2`; focus shows the accent ring.
  - Checkboxes and range inputs use `accent-color:var(--acc)`.
  - Labels are uppercase .656rem `--mut`.
  - A result line under a control group is `--live` or `--crit`, and its sentence also says the
    outcome.
- **Menus.** A `.pop` popout. Its segmented control is tinted (`--wash`), not filled. Field rows put
  the label on the left and the control on the right.
- **Consoles.** A 6px progress track on `--panel2` with an `--acc` fill; a log in Mono .719rem
  `--mut` on `--bg`, capped at 13.75rem tall.
- **Toasts.** Fixed at the bottom right. `--panel2` ground with a 3px left rule: `ok` is `--live`,
  `bad` is `--crit`, and `grey` is `--plan` for a lane that finished without a verdict.

**Row states.** Each state has its own opacity, and every row also names its state in words.

| Row state | Opacity |
|---|---|
| Carried forward | .72 |
| Superseded | .65 |
| Standby | .6 |
| Absent, accepted | .55 |
| Retired | .5 |
| Annotated | .55, struck through in `--part` at 60%. The row stays; suppression never deletes it |

## 8. Decision controls (`theme.css`)

`theme.css` holds the approval and selection vocabulary that came out of the 2026-09-03 design
review. Its tokens use a `--cw-` prefix. Their ground and ink alias the panel's tokens, with dark
fallbacks, and they add semantic fills:

| Fill | Value | Contrast with `#1a120e` ink | Hover (`-lift`) | Hover contrast |
|---|---|---|---|---|
| `--cw-acc` | `#c9a227` | 7.64 | `#dcb43a` | 9.35 |
| `--cw-ok` | `#9bb069` | 7.75 | `#aec27d` | 9.51 |
| `--cw-caution` | `#d69a52` | 7.57 | `#e4ac68` | 9.15 |
| `--cw-stop` | `#e5484d` | 4.72 | `#ef5f64` | 5.71 |
| `--cw-obsidian` | `#0b0b0c` | Takes white ink at 19.67:1 | — | — |

`/config` links this file. The panel serves it at `/static/theme.css`.

### Rules that came out of measurement

**Every filled button takes dark ink.** Against `#ffffff` and `#1a120e`:

| Fill | White | Dark ink |
|---|---|---|
| Gold, `--cw-acc` | 2.42 | 7.64 |
| Amber, `--cw-caution` | 2.44 | 7.57 |
| Olive, `--cw-ok` | 2.38 | 7.75 |
| Red, `--cw-stop` | 3.91 | 4.72 |

White fails AA on every fill, so there is no light-on-colour variant to reach for. The only
exception is white on `--cw-obsidian`, at 19.67:1.

**Hover lifts the fill and adds a glow.** A lighter fill raises the dark ink's contrast, so each
`-lift` hover stays above its resting ratio; the glow says how much the action grants. A white-text
fill cannot do the same, because lightening it lowers the text's contrast (the Linear livery, below).

**Gold has a dead zone.** On a light surface, `#96770f` fails both ways: 4.25 against white text and
4.35 against dark ink. So on `.cw-light`, gold alone keeps its bright fill and dark ink (7.64:1)
while every other fill inverts to a dark fill with white text: `--cw-ok` `#1f7a4d` at 5.32:1,
`--cw-caution` `#8a6d14` at 4.91:1 and `--cw-stop` `#c0343a` at 5.54:1. On a light ground the glow
becomes a 3px focus-style ring, because a bloom on light reads as a smudge.

### Severity is carried by the glow radius

Hue alone would rank the buttons by pigment brightness rather than consequence: gold is the
brightest fill, and would read loudest while it means "caution". So the halo radius is the
variable, and hue comes second.

| Class | What it grants | Halo |
|---|---|---|
| `--ok` | Nothing new; already-approved work | Rim only |
| `--neutral` | One binary, reversible | 10px |
| `--caution` | Reaches a live service | 18px + 34px |
| `--stop` | Everything; irreversible | 26px + 58px |

**The keyboard shortcut escalates with the halo.** The action that grants nothing takes a bare `⏎`.
Each step up adds a modifier, ending at `⌘⇧⏎` for grant-all. Severity is encoded twice, visually and
in the chord, so a reader who does not notice the glow still gets it.

### Keyboard hints are rendered, never written

- **Markup.** `.cw-keys` carries `data-mac` and `data-win`.
- **Platform.** It is resolved at runtime from `navigator.userAgentData.platform`, falling back to
  `navigator.platform`, and never from a UA string. A `⌘` hard-coded in markup is wrong for every
  Windows and Linux reader.
- **Size.** Hints are Mono .82rem on a filled chip with real padding, so they can be read rather than
  merely noticed.

### The approval dialog

- **Why it exists.** Every check in `manifests/security-baseline.json` declares a required binary, so
  the dialog is on the critical path for every lane.
- **Approval is keyed on the binary, not the lane.** Keying on the lane would ask about `semgrep`
  once per lane that uses it. Bulk approval uses the inline selection grid (`.cw-grid`, `.cw-row`),
  not a queue of dialogs.
- **Button layout.** The decision pair is centred, with decline on the left and the affirmative on
  the right, 24px apart.
- **Button radius.** The dialog's buttons use a 3px radius.
- **Facts chips.** The facts the operator consents to (what runs, from where, over how much) are
  Mono chips in `.cw-facts`, never prose.

### The Linear livery

Variant E of the same review uses the `.cw-linear` class. It left-aligns the dialog, puts the
actions at the bottom right, and sets them on a near-black ground (`#08090a`) with an indigo accent
(`#5e6ad2`, which carries white at 4.70:1).

Nothing uses it: the Scanning section on `/config` uses the standard decision controls above. The
livery keeps the rules above:

- **Hover heat lives in the glow.** The indigo fill holds still on hover: its hover edge `#7b86e4`
  would carry white at only 3.30:1.
- **Severity rides the glow radius.** `.cw-sev--all` blooms at 22px, and `.cw-sev--one` at 9px.
  The severity fills carry dark ink at 5.73:1 (`--one`, `#7c87ea`), 6.94:1 (`--go`, `#3fb27f`),
  6.29:1 (`--all`, `#ff6166`) and 9.49:1 (`--hold`, `#e3b341`).

### Not settled

- **Which button carries the default.** An inverted variant, where decline is the filled button and
  `⏎` refuses, was reviewed and not chosen. It remains the safer default for a dialog that grants
  execution.
- **`.cw-light`'s ground.** Its fills also apply under `html[data-mode=light]`, which is how `/config`
  takes them in the light theme. Its ground is `#fbfbfa`, not the panel's `#f4f3ef`.
- **Two tokens have no fill.** `--sev` and `--attest` have no settled meaning as a fill, so
  `theme.css` does not define one.

## 9. Marks

### The seal

The logo is the seal. `lib/brand-tokens.mjs` holds its geometry once, as `SEAL_SVG`:

- a 32×32 viewBox;
- a disc, r16;
- a ring, r14.5, stroke 1;
- a filled node, r2.4, at (12,20);
- a hollow node, r2.4, at (21,11), stroke 1.3;
- a connector from 13.7,18.3 to 19.3,12.7, stroke 1.3.

**The default mark is for light grounds.** `MARK_SVG` recolours that geometry: a `#FFFFFF` disc, a
`#101011` ring and a `#C9A227` key. On white the disc meets the page and the black ring is its edge.
`MARK_IMG` and `MARK_URI` carry it as an image.

**The dark-ground seal is `SEAL_SVG` itself:** a `#14161A` disc, with the ring and key in `#C9A227`.

**Inline copies match `SEAL_SVG` byte for byte.** Four files carry one:

- `admin/panel.html`, and from it `admin/index.html`;
- `admin/config.html`;
- `admin/serve.mjs`;
- `docsite/editor/edit.html`.

`bin/test/brand-tokens-parity.test.mjs` enforces the match. On a light ground the stylesheet
recolours the copy to the default mark: the disc is its first circle and the ring its second.
`panel-light.css` does this for the panel, `/config` and the sign-in page, and the editor's light
chrome does it for the editor.

**Use it as an image on user-editable pages.** Where the mark reaches a page rendered from
user-editable source, use `MARK_IMG` (or `SEAL_IMG` on a dark ground), a data-URI `<img>`, and never
a live `<svg>`. A standalone SVG without `xmlns` does not render, so the wrappers add it.

### Lock-up with the wordmark

- **Size.** The seal is a 1.5rem square, with a .31rem gap (5px at the base) before the wordmark.
- **Wordmark.** Live text, "commitwork", in Sans .78rem 700, uppercase at .16em tracking, in `--ink`.
- **Phones.** 1.25rem and .7rem, with .13em tracking.
- **`/config`.** The seal is 1.375rem.
- **Empty-lane panel.** The lock-up appears at .55 opacity, with the wordmark in lowercase.

### Other marks

- **Tab icons are the default mark.** The panel and the sitemap pages each serve `cw-favicon.svg`,
  `cw-favicon-32.png` and a `favicon.ico` holding 16, 32 and 48px PNGs. The docsite shell, the
  public origin's pages (`we/public/` in the commitwork-web repository) and the build-box landing page
  (`admin/public/index.html`) carry `MARK_ICON`, the mark as a data URI.
- **The key.** `KEY_SVG` is the seal with a `#101011` disc and `#c9a227` gold. No surface wears it;
  it remains only as the `cw:key` specimen.

## 10. Terminal

`bin/lib/theme.mjs` uses truecolor SGR.

**When colour is used.** In order of precedence:

1. `NO_COLOR` or `CW_NO_COLOR` turns colour off.
2. `FORCE_COLOR`, when set to anything but `0`, forces colour on, even when piped.
3. Otherwise colour is used only on a TTY.

`stripAnsi` removes the codes wherever printed width is measured.

Every token except `blocked` is the dark panel token of the same name. `blocked` has no panel
token; it is 5.06:1 on the dark `--bg` and ΔE 30 from `crit`.

| Token | Hex | Use | Glyph |
|---|---|---|---|
| `acc` | `#c9a227` | Headings, the `[tag]` phase banner | — |
| `acc2` | `#9a7b1d` | Rules, underlines | — |
| `ink` / `mut` / `dim` | `#e4e2dc` / `#98958e` / `#8a877e` | Body / labels / echoed commands and paths | — |
| `live` | `#5fd08a` | Pass | `✓ pass` |
| `crit` | `#fe5b66` | Fail | `✗ fail` |
| `high` | `#fe5d30` | `noscan`: ran, produced nothing trustworthy | `▚ noscan` |
| `blocked` | `#f2448c` | A void a person can clear (a missing credential or tool) | `■ BLOCKED` |
| `part` | `#d69a52` | Skipped on purpose | `⊘ skipped` |
| `plan` | `#8a92a5` | Not applicable | `· n/a` |

Keep the `[tag]` phase banner verbatim; operators grep logs for it.

## 11. How other surfaces take the house style

Pages the panel serves take `panel.css` and `panel-light.css` (§2.1). Every other page takes the same
palette from `lib/house-css.mjs`, so no surface carries a palette of its own.

### The house sheet

`houseCss({ fonts, weights })` returns the IBM Plex faces, the tokens and the base elements. Its parts
are also exported: `houseFonts()`, `houseTokens()`, `houseBase()` and `houseSwitchCss()`, plus
`houseTokenValues()` for tests that measure contrast.

- **Tokens.** Light values on `:root`, dark ones on `html[data-mode=dark]`, and a
  `prefers-color-scheme` fallback for a page without scripts. They are the panel's names and values,
  read from `lib/brand-tokens.mjs`, including `--on-acc` and the `--cra-*` clock aliases.
- **Fonts.** `served` points at `/static/fonts/`; `inline` embeds a chosen subset as data URIs, for a
  page opened from disk; `none` leaves the system stacks.
- **Base elements.** Headings, prose, lists, links, code, tables, blockquotes, pills and the theme
  switch control, all written against the tokens. The pills include `.pill.unk` and `.pill.na`, drawn
  as the panel draws them (§7): an unknown or not-applicable value takes these, never a style of its
  own (Rule 7).

A page takes the sheet in one of four ways:

1. **A generated page inlines it**, with `followerScript()` from `lib/theme-follower.mjs` so it follows
   the panel's Appearance choice. A page that must stay script-free follows the OS instead.
2. **The panel serves it at `/static/house.css`**, the copy `bin/house-css.mjs` writes to
   `admin/static/house.css`.
3. **A static page carries a `<style id="house-css">` block** when it must stay one file or its CSP
   admits inline style only. `bin/house-css.mjs` registers each such page as a copy and fills the
   block; `--check` fails when a block is stale.
4. **A page the panel serves outside its shell links the panel's own sheets** through
   `admin/lib/theme-head.mjs` (§2.1).

A page keeps only its own layout rules, and any name of its own is an alias onto a token. Charts keep
their categorical series colours, which are data; their ground, ink, lines and severity come from the
tokens.

`bin/test/house-palette-guard.test.mjs` fails any tracked producer that declares its own `--bg`,
`--ink` or `--acc`. It names the tests that must declare one to test anything, the producers that
interpolate `lib/brand-tokens.mjs` or carry `PAPER_CSS` verbatim, and any surface still pending (§12). It reads past a
`house-css` block and requires every page carrying one to be a registered copy. A generator's
"Generated by" header exempts only the files that generator writes, so an imported docsite source
that names `bin/docsite-build.mjs` is checked as a producer, and any colour it restates outside
`PAPER_CSS` must equal its token.

### Surfaces

| Surface | How it takes the style | Light and dark |
|---|---|---|
| The panel, `/config`, the sign-in page, the `serve.mjs` placeholders, the off-box page | `panel.css` and `panel-light.css`, through `admin/lib/theme-head.mjs` | Stored choice; AUTO / LIGHT / DARK control |
| `admin/menus/styles.html` (workspace shell) | Panel tokens | Panel switch |
| Memory view (`admin/lib/memory-view.mjs`) | House tokens and the switch script, inlined | Stored choice; the OS when opened from disk |
| Memory view's 503 page (`renderUnavailable`) | `houseCss()`, no font | Follower |
| Docsite shell (`lib/docsite-page.mjs`), the pages it builds, and `bin/taxonomy-web.mjs` | `PAPER_CSS` | Light only, by design (§2.3) |
| `docsite/imported/commitwork-coverage-survey.html`, a recovered page the build copies | The docsite shell's stylesheet, header and footer, held equal to `lib/docsite-page.mjs` by `admin/test/theme-conformity.test.mjs`; its own names alias the tokens, and `--warn` restates light `--part` under the palette guard | Light only |
| Docsite editor | `PAPER_CSS`, and the dark values restated under a parity test | Own `data-theme` toggle |
| `bin/taxonomy-render.mjs`, `bin/scanner-taxonomy-render.mjs` | `LIGHT` / `DARK` interpolated | Chosen at build time with `--dark` |
| `bin/taxonomy-structure.mjs` | `LIGHT` interpolated | Light only |
| `lib/md-view.mjs` | `houseTokens()` and `houseBase()`, faces inlined | Follower and toggle |
| Monitor reports (`rollup`, `runtime-report`, `timeline`, `timeline2`) | `houseCss()`, faces served | Follower and toggle, embedded or standalone |
| `map/generate.mjs` | `houseTokens()`, faces served; its own names are aliases | Follower |
| `lib/launchlist-render.mjs`, the `map/render.mjs` no-data placeholder | `houseCss()`, faces served | Follower |
| `bin/projectstatus.mjs`, `cra/dashboard.mjs`, `chunk-diff/generate.mjs`, `bin/lib/lattice-html.mjs`, `bin/lib/brief.mjs`, `bin/vuln-profile.mjs` | `houseCss()`, a Plex subset inlined | Follower |
| `bin/top100-html.mjs`, `bin/render-report.mjs`, `bin/verdict-flow.mjs`, `bin/remediation-web.mjs`, `bin/cvd-palette.mjs` report | `houseCss()`, a Plex subset inlined; no script | The OS |
| `we/public/` (commitwork-web repository) | A `house-css` block with Plex Sans 400/600/700 and Mono 400/600 inlined (its CSP admits inline style, `data:` images and `data:` fonts); the panel's lockup as `MARK_URI` and `SEAL_FAVICON` images | The OS |
| `admin/public/index.html` | A `house-css` block, no fonts; `MARK_ICON` as its tab icon. No route in this tree serves it and it declares no CSP, so a host that adds one must admit `data:` images | The OS |
| `sitemap/mainline.html`, `sitemap/demo.html` | A `house-css` block, no fonts; scene tokens shared with the 3D view stay per mode | Follower; mainline rebuilds its scene on a change |

## 12. Known deviations

A surface found departing from this document is recorded here, and a producer that declares its own
`--bg`, `--ink` or `--acc` meanwhile goes in the palette guard's pending list with the item number
(`bin/test/house-palette-guard.test.mjs`). These two remain from the conformity audit of 2026-10-07.

1. **`bin/vuln-profile.mjs` severity palette.** It declares `--s-crit`, `--s-high`, `--s-med` and
   `--s-low` with values of its own, and `--aff`, `--clean`, `--unproven` and `--blocked` beside them,
   instead of aliasing the §3.3 and §3.4 tokens.
2. **`map/generate.mjs` keeps its sticky bar when embedded.** Under `html[data-embed]` it hides the logo
   and title (`.embed-hide`), but the bar keeps its background and 3px accent border. The other
   embedded reports make theirs static and transparent.
