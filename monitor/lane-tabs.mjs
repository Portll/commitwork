// monitor/lane-tabs.mjs — every scanner lane gets a tab, and the tab is DERIVED.
//
// Seventeen of forty-three categories had no panel tab. Each one already carried a ROW_SCHEMA, so
// the panel knew how to draw its rows and simply had nowhere to draw them: they ran, produced
// findings, and were reachable only through the perf table. Adding them by hand meant six registries
// per lane — SCANNER_TABS, NATIVE, VALID_VIEWS, LANE_TITLE, LANE_FOOT, PANEL_VIEWS — which is the
// count that produced this repo's most-repeated defect, a lane added to five of the seven places it
// belongs and silently absent from the sixth.
//
// So one thing is declared here and the rest is derived. The declaration is SECTION, because which
// group a lane belongs to is a judgement no rule can make: `lintRust` is quality and `sastJoern` is
// static, and nothing in either name says so. Everything else — the view slug, the title, the tab
// button, the route — follows from the category id and the schema that already exists.
//
// A category with no entry here is NOT dropped: laneSection() answers 'other' and the tab still
// renders, filed under a section that says the placement is missing. A lane that is invisible
// because nobody classified it is the failure this file exists to end.

/** Category -> section slug. Sections are TAB_GROUPS' own vocabulary; see admin/index.html. */
export const LANE_SECTION = Object.freeze({
  // read the code without running it
  sastCodeqlPython: 'static', sastCodeqlRuby: 'static', sastCodeqlCpp: 'static',
  sastCodeqlSwift: 'static', sastCodeqlCsharp: 'static', sastAuto: 'static',
  sastJoern: 'static', sastBearer: 'static', sastElixir: 'static',
  sastPython: 'static',
  // is this idiomatic / safe-by-pattern. Section 'lint', not 'quality': every member is
  // lane(H,'not-a-vulnerability') in LANE_KINDS, and that non-additiveness is the line the section
  // draws. lintJava had NO entry here and was filing under 'other'.
  lintRust: 'lint', lintHaskell: 'lint',
  formatRust: 'lint',
  lintGo: 'lint',
  lintPython: 'lint',
  lintJava: 'lint',
  // Lanes that reached the roster after this map was last extended, so laneSection() answered
  // 'other' and they rendered under a literal Other heading. Sectioned by what each READS.
  sastCCppcheck: 'static', sastCFlawfinder: 'static', sastCodeqlRust: 'static', sastCodeqlGo: 'static',
  sastBrakeman: 'static', sastPhp: 'static', nodeHazards: 'static', weakRandom: 'static',
  sastCobol: 'static',
  mobileManifest: 'static',
  // reads instruction files without running anything
  agentInstructions: 'static',
  agentConfig: 'static',
  // reads workflow files without running anything
  actionsGaps: 'static',
  // reads platform state via API
  actionsHealth: 'other',
  // runs the test suite
  testHermetic: 'dynamic',
  // reads Java and Spring config without running anything
  jacksonCaseInsensitive: 'static',
  // these read a lockfile, not the code
  depsBundlerAudit: 'deps', depsRustAudit: 'deps', depsContent: 'deps',
  // model artefacts and hub-loading calls are what the tree pulls in from a model hub
  modelArtefacts: 'deps',
  // needs something running to answer
  bola: 'dynamic',
  // what the tree pulls in, and from whom
  depsGradleDeclared: 'deps', supplyChainPosture: 'deps', depsReachability: 'deps',
  gradleWrapper: 'deps',
  // who made each commit — the "from whom" half, read from the object graph rather than a lockfile
  commitProvenance: 'deps',
  // conformance, not vulnerability
  accessibility: 'quality',
});

/** The section a lane belongs to. Unclassified answers 'other' rather than vanishing. */
export const laneSection = (cat) => (Object.hasOwn(LANE_SECTION, cat) ? LANE_SECTION[cat] : 'other');

/**
 * A URL-safe view slug from a category id. Lower-cased and stripped of separators, which is the
 * shape every hand-written view already uses (`secretsHistory` -> `secretshistory`), so the
 * generated ones cannot look like a second species of tab.
 */
export const laneView = (cat) => String(cat || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();

/**
 * A CHIP label: the same lane, led by what distinguishes it.
 *
 * Labels are written family-first (`SAST · CodeQL (Python)`) which reads correctly in a sentence and
 * badly in a row of tabs — sixteen lanes share the `SAST` prefix and six more share `SAST · CodeQL (`,
 * so the strip is identical for the first twenty characters and the discriminator falls off the end.
 * This drops the family word (the SECTION already carries it) and promotes the parenthetical, so the
 * eye lands on `CodeQL · Python` / `Brakeman · Ruby`. The full label is unchanged and still supplies
 * the tab's `title` and the view heading — this is the chip only.
 *
 * A trailing aside is cut at the comma: `clippy (Rust, not a security scan)` -> `clippy · Rust`.
 * The aside is load-bearing and is NOT lost — it stays in `label`, which the tooltip renders.
 */
export function laneTabLabel(full) {
  const s = String(full || '').trim();
  if (!s) return '';
  const segs = s.split(' · ');
  const tail = (segs.length > 1 ? segs.slice(1) : segs).join(' · ').trim();
  const m = tail.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  // BOTH halves must survive the transform. An empty name or an empty parenthetical would compose a
  // bare separator — `SAST · ()` became `·`, a chip naming nothing — so a degenerate parenthetical
  // is left alone rather than promoted.
  const name = m ? m[1].trim() : '';
  const qual = m ? m[2].split(',')[0].trim() : '';
  const out = (m && name && qual ? `${name} · ${qual}` : tail).replace(/\s+/g, ' ').trim();
  // a chip with no letters or digits names nothing; keep the full label instead of shortening to
  // punctuation. This is the floor, not an optimisation — `()` and `·` both reach here.
  return /[\p{L}\p{N}]/u.test(out) ? out : s;
}

/**
 * The tabs a panel must render for categories that have a row schema and no hand-written tab.
 * @param {string[]} categories every category the rollup knows (SCANNER_SPECS keys)
 * @param {Set<string>|string[]} declared categories that already own a hand-written tab
 * @param {(cat:string)=>string|null} labelFor resolves the display label, usually SCANNER_LABELS
 */
export function derivedLaneTabs(categories, declared, labelFor = () => null) {
  const have = declared instanceof Set ? declared : new Set(declared || []);
  const tabs = (categories || [])
    .filter((c) => !have.has(c))
    .map((cat) => {
      const label = labelFor(cat) || cat;
      return {
        key: cat,
        view: laneView(cat),
        section: laneSection(cat),
        label,
        short: laneTabLabel(label),
        // `derived: true` travels so the panel can say a tab was generated rather than authored.
        // A reader who finds a tab nobody wrote should be able to learn that from the page.
        derived: true,
      };
    })
    .sort((a, b) => a.section.localeCompare(b.section) || a.key.localeCompare(b.key));

  // COLLISION IS THE ONE FAILURE THAT MATTERS. Shortening exists to tell lanes apart, so a rule that
  // maps two lanes onto one chip has done the opposite of its purpose — and unlike a long label, the
  // reader cannot see that it happened. Any short form claimed by more than one lane reverts to the
  // full label for every claimant: the worst case is today's crowding, never a wrong identity.
  const byShort = new Map();
  for (const t of tabs) byShort.set(t.short, (byShort.get(t.short) || 0) + 1);
  for (const t of tabs) if (byShort.get(t.short) > 1) t.short = t.label;
  return tabs;
}
