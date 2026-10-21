// W2 — V8's own answer to "what does this module export, and what names does it demand from each
// import", obtained WITHOUT RUNNING A LINE.
//
// `new vm.SourceTextModule(src)` parses. `link()` instantiates — it resolves specifiers and binds
// names, and it is NOT evaluation: top-level code does not run. `evaluate()` is never called here,
// and that distinction is the whole reason this witness is usable on this repository at all.
// flow/report.mjs already records why: several modules in this tree publish, sweep or rewrite a
// directory when merely loaded, so a witness that imported them would be a tool that does work when
// asked a question.
//
// HOW THE IMPORT NAMES ARE LEARNED, and why it is not circular: nothing tells a linker which names
// the importer wants. So every specifier is first stubbed with NO exports, V8 refuses the link and
// names the one binding it could not find, that name is added to the stub, and the link is retried.
// Every name in the result therefore came out of V8's parser. W1 is never consulted — if it were,
// this would be W1 with extra steps, and the two witnesses would share the failure mode that makes
// a second one worth having.
//
// FAIL CLOSED. A link error this cannot account for makes the FILE unknown; it never yields a
// smaller export surface that reads downstream as "nothing exported".

const MISSING_EXPORT = /The requested module '(.+?)' does not provide an export named '(.+?)'/;

/** Attempts before the loop is declared non-convergent. Each attempt learns at least one name. */
export const LINK_ATTEMPT_CAP = 500;

export function vmModulesAvailable(vm) {
  return typeof vm?.SourceTextModule === 'function';
}

async function vmModule() {
  const vm = await import('node:vm');
  if (!vmModulesAvailable(vm)) {
    throw new Error('vm.SourceTextModule unavailable — run node with --experimental-vm-modules. '
      + 'Refusing to report an export surface from a witness that cannot parse.');
  }
  return vm;
}

/**
 * -> { ok, reason, exports, imports, specifiers, reexports, starReexports, surfaceComplete }
 *
 *   exports          names V8 puts on the module namespace, `default` included. Sorted.
 *   imports          [{ specifier, names }] — names V8 demanded, `default` included. Sorted.
 *   specifiers       every static specifier, including those imported only for side effects.
 *   reexports        [{ exported, spec, imported }] — exports V8 resolves into a stub; see reexportsOf.
 *   surfaceComplete  false when the module carries `export * from`, whose contribution lives in a
 *                    file this witness deliberately did not load. A partial surface that claimed to
 *                    be whole would turn a re-export into a dead export.
 */
export async function surfaceOf(src, identifier = 'anonymous.mjs') {
  const vm = await vmModule();
  const wanted = new Map();
  let specifiers = null;

  for (let attempt = 0; attempt < LINK_ATTEMPT_CAP; attempt += 1) {
    let mod;
    try {
      mod = new vm.SourceTextModule(String(src), { identifier });
    } catch (e) {
      return fail(`parse failed: ${e.name}: ${e.message}`, wanted);
    }
    specifiers = mod.dependencySpecifiers.slice();
    const stubs = [];
    try {
      // eslint-disable-next-line no-await-in-loop -- each attempt depends on the previous failure
      await mod.link((spec) => {
        const names = [...(wanted.get(spec) || [])].sort();
        const stub = new vm.SyntheticModule(names, function evaluateStub() {
          for (const n of names) this.setExport(n, undefined);
        }, { identifier: `stub://${spec}` });
        stubs.push({ spec, stub, names });
        return stub;
      });
      const exports = Reflect.ownKeys(mod.namespace).filter((k) => typeof k === 'string').sort();
      let reexports;
      try {
        reexports = reexportsOf(mod, stubs, exports);
      } catch (e) {
        return fail(`re-export probe failed: ${e.name}: ${String(e.message).slice(0, 200)}`, wanted, specifiers);
      }
      const stars = await starSpecifiers(vm, src, identifier, wanted, specifiers);
      return {
        ok: true,
        reason: null,
        exports: exports.filter((n) => n !== STAR_PROBE),
        imports: [...wanted].map(([specifier, names]) => ({ specifier, names: [...names].sort() }))
          .sort((a, b) => a.specifier.localeCompare(b.specifier)),
        specifiers,
        reexports,
        starReexports: stars,
        surfaceComplete: stars.length === 0,
        attempts: attempt + 1,
      };
    } catch (e) {
      const hit = MISSING_EXPORT.exec(e.message || '');
      if (!hit) return fail(`link failed: ${e.name}: ${String(e.message).slice(0, 200)}`, wanted, specifiers);
      if (!wanted.has(hit[1])) wanted.set(hit[1], new Set());
      wanted.get(hit[1]).add(hit[2]);
    }
  }
  return fail(`link did not converge in ${LINK_ATTEMPT_CAP} attempts`, wanted, specifiers);
}

/**
 * Which specifiers are `export * from` — asked of V8, not of a regex.
 *
 * `export * from './x'` and `import './x'` are indistinguishable on `dependencySpecifiers`, and the
 * difference decides whether an export surface is whole. So the stub is given a name nothing else
 * could produce, and the namespace is read back: a sentinel that arrives on the OUTER module can
 * only have travelled through a star re-export.
 *
 * One sentinel PER SPECIFIER, in one link. A single shared name is ambiguous the moment two
 * specifiers star, V8 drops an ambiguous star name from the namespace, and the module read back as
 * starring nothing — `surfaceComplete: true` on a surface with two holes in it.
 *
 * A star re-export makes the surface INCOMPLETE, never larger. Findings that rest on a complete
 * surface — a dead export, above all — are withheld for such a module rather than published from a
 * surface known to be missing names.
 */
export const STAR_PROBE = '__cw_star_probe_9c1f__';

async function starSpecifiers(vm, src, identifier, wanted, specifiers) {
  if (!specifiers.length) return [];
  const probes = new Map(specifiers.map((spec, i) => [`${STAR_PROBE}${i}`, spec]));
  const probeOf = new Map([...probes].map(([p, spec]) => [spec, p]));
  const mod = new vm.SourceTextModule(String(src), { identifier });
  await mod.link((spec) => {
    const names = [...(wanted.get(spec) || []), probeOf.get(spec)].filter(Boolean).sort();
    return new vm.SyntheticModule(names, function evaluateStub() {
      for (const n of names) this.setExport(n, undefined);
    }, { identifier: `stub://${spec}` });
  });
  return Reflect.ownKeys(mod.namespace).filter((k) => probes.has(k)).map((k) => probes.get(k)).sort();
}

/**
 * Which exported names resolve into another module — V8's ResolveExport, still without evaluating.
 *
 * Every stub binding is given a unique token with `setExport`, which a linked SyntheticModule allows
 * and which is not `evaluate()`. The outer namespace is then read: a name whose value is a token, or
 * a stub's namespace object, can only have got there through V8's own resolution. A local binding
 * reads as a hoisted function, `undefined`, or a TDZ ReferenceError — never as a token. That covers
 * `export { x as y } from`, `export * as ns from` and `import { x } …; export { x }` alike, because
 * V8 treats all three as indirect exports.
 *
 * -> [{ exported, spec, imported }], imported '*' for a namespace object. Sorted.
 */
function reexportsOf(mod, stubs, exports) {
  const tokens = new Map();
  const spaces = new Map();
  for (const { spec, stub, names } of stubs) {
    for (const n of names) {
      const token = Object.freeze({});
      tokens.set(token, { spec, imported: n });
      stub.setExport(n, token);
    }
    spaces.set(stub.namespace, spec);
  }
  const out = [];
  for (const exported of exports) {
    let value;
    try {
      value = mod.namespace[exported];
    } catch (e) {
      if (e?.name === 'ReferenceError') continue;     // TDZ: a local binding, never initialised here
      throw e;
    }
    const hit = tokens.get(value);
    if (hit) out.push({ exported, spec: hit.spec, imported: hit.imported });
    else if (spaces.has(value)) out.push({ exported, spec: spaces.get(value), imported: '*' });
  }
  return out;
}

function fail(reason, wanted, specifiers = null) {
  return {
    ok: false,
    reason,
    exports: [],
    imports: [...wanted].map(([specifier, names]) => ({ specifier, names: [...names].sort() })),
    specifiers,
    reexports: [],
    starReexports: [],
    surfaceComplete: false,
    attempts: null,
  };
}
