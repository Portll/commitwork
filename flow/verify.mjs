// W2 — V8's own parser, used as the floor under the hand-rolled lexer in flow/lexer.mjs.
//
// `vm.SourceTextModule` PARSES at construction; link and evaluate are separate explicit steps that
// are never called here, so nothing runs. Requires --experimental-vm-modules and THROWS when it is
// absent rather than degrading to "the lexer said so" — a silent downgrade to an unfloored
// extractor is how a checker reports a clean tree it never read.
//
// Two directions, kept apart because only one of them lies to you:
//   FALSE POSITIVES — maskConsistent(). Rebuild the source from the lexer's own classification and
//     make V8 re-parse it. A desync garbles real code into filler and V8 refuses it.
//   FALSE NEGATIVES — specifiersOf(). V8 names the static import specifiers; every one must appear
//     among the lexer's string spans. A literal V8 can see and the lexer cannot is a hole.
//
// BOUNDED LIMITATION, stated rather than buried in a coverage claim: `dependencySpecifiers` is
// STATIC-ONLY. A dynamic `import(expr)` is absent from it entirely, and a dynamic `import('./x')`
// with a literal argument is absent too. So specifiersOf() is a false-negative test over the static
// import subset ONLY — it says nothing about path literals, env keys or spawn targets, which is
// why flow/lexer.mjs carries the independent W3 scan and flow/runtime.mjs is W4.

export function vmModulesAvailable(vm) {
  return typeof vm?.SourceTextModule === 'function';
}

async function sourceTextModule() {
  const vm = await import('node:vm');
  if (!vmModulesAvailable(vm)) {
    throw new Error('vm.SourceTextModule unavailable — run node with --experimental-vm-modules. '
      + 'Refusing to fall back to the unfloored lexer.');
  }
  return vm.SourceTextModule;
}

/** -> { ok, error, specifiers } — specifiers are STATIC imports only (see the header). */
export async function parseModule(src, identifier = 'anonymous.mjs') {
  const SourceTextModule = await sourceTextModule();
  try {
    const m = new SourceTextModule(String(src), { identifier });
    return { ok: true, error: null, specifiers: m.dependencySpecifiers.slice() };
  } catch (e) {
    return { ok: false, error: `${e.name}: ${e.message}`, specifiers: null };
  }
}

/**
 * Rewrite every classified interior to filler, preserving delimiters AND newlines.
 *
 * Newlines are preserved because a block comment containing one is a line terminator for ASI:
 * `const a = 1 /*<newline>*<slash> const b = 2` parses and its newline-free rewrite does not. Losing
 * that turns a valid file into a phantom mask failure — grey where there is nothing wrong.
 */
export function maskFrom(src, spans) {
  const s = String(src);
  const ordered = [...spans].sort((a, b) => a.innerStart - b.innerStart);
  let out = '';
  let at = 0;
  for (const sp of ordered) {
    if (sp.innerStart < at) return { ok: false, error: `overlapping spans at ${sp.innerStart}`, masked: null };
    if (sp.innerEnd < sp.innerStart) return { ok: false, error: `inverted span at ${sp.innerStart}`, masked: null };
    out += s.slice(at, sp.innerStart);
    for (let i = sp.innerStart; i < sp.innerEnd; i += 1) out += s[i] === '\n' ? '\n' : 'x';
    at = sp.innerEnd;
  }
  out += s.slice(at);
  if (out.length !== s.length) return { ok: false, error: 'mask changed length', masked: null };
  return { ok: true, error: null, masked: out };
}

/**
 * -> { ok, error }. ok means V8 accepts the source rebuilt from the lexer's classification, so the
 * classification is coherent with what V8 believes the file is.
 *
 * It is a FLOOR, not a proof: a wrong classification that happens to stay parseable passes here.
 * That residual is what W3 and W4 are for, and flow/README.md states it rather than implying the
 * floor is a ceiling.
 */
export async function maskConsistent(src, spans, identifier = 'anonymous.mjs') {
  const m = maskFrom(src, spans);
  if (!m.ok) return { ok: false, error: m.error };
  const parsed = await parseModule(m.masked, `${identifier}#masked`);
  return { ok: parsed.ok, error: parsed.error };
}

/**
 * -> { missing, checked } — static specifiers V8 reports that the lexer's string values do not
 * contain. Non-empty `missing` is a measured FALSE NEGATIVE in the literal enumeration.
 */
export function specifierCoverage(specifiers, spans) {
  const values = new Set(spans.filter((s) => s.value !== null).map((s) => s.value));
  return { checked: specifiers.length, missing: specifiers.filter((x) => !values.has(x)) };
}
