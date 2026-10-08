// FCA: formal concept analysis over objects x attributes.
//
// Subsumption between taxonomy classes currently lives in free prose inside each
// class description ("Distinct from K5, where ..."), so it cannot be queried,
// cycle-checked or rendered. Encoding each class into a controlled attribute
// vocabulary and closing the incidence relation gives the same order as extent
// containment, decided mechanically rather than by argument.
//
// NextClosure (Ganter) enumerates closed attribute sets in lectic order, so the
// concept list is a function of the input alone -- same incidence, byte-identical
// output, no dependence on iteration order of a Set or Map.

/** Attributes shared by every object in `extent`. */
export function intentOf(extent, objects) {
  if (extent.length === 0) return null; // caller substitutes the full attribute set
  let acc = null;
  for (const id of extent) {
    const attrs = objects.get(id);
    if (!attrs) throw new Error(`fca: unknown object ${id}`);
    if (acc === null) acc = new Set(attrs);
    else for (const a of acc) if (!attrs.has(a)) acc.delete(a);
  }
  return acc;
}

/** Objects carrying every attribute in `intent`. */
export function extentOf(intent, objects, order) {
  const out = [];
  for (const id of order) {
    const attrs = objects.get(id);
    let all = true;
    for (const a of intent) {
      if (!attrs.has(a)) {
        all = false;
        break;
      }
    }
    if (all) out.push(id);
  }
  return out;
}

/** Closure: attributes shared by every object that carries all of `intent`. */
function closure(intent, objects, order, allAttrs) {
  const ext = extentOf(intent, objects, order);
  const int = intentOf(ext, objects);
  return int === null ? new Set(allAttrs) : int;
}

// Lectic order: B is lectically greater than A at attribute m when B and A agree
// on every attribute before m and B gains m. Comparing on a FIXED attribute order
// is what makes the enumeration reproducible.
function lecticLess(a, b, attrs, upto) {
  for (let i = 0; i < upto; i++) {
    const m = attrs[i];
    if (a.has(m) !== b.has(m)) return false;
  }
  return true;
}

/**
 * Every formal concept, in lectic order.
 *
 * `maxConcepts` is a refusal, not a truncation: a lattice can be exponential in
 * the attribute count, and silently returning the first N concepts would report a
 * partial order as if it were the whole one. Hitting the cap throws.
 */
export function concepts(objectsInput, { maxConcepts = 20000 } = {}) {
  const objects = new Map();
  for (const [id, attrs] of Object.entries(objectsInput)) {
    objects.set(id, new Set(attrs));
  }
  const order = [...objects.keys()].sort();

  const attrSet = new Set();
  for (const attrs of objects.values()) for (const a of attrs) attrSet.add(a);
  const attrs = [...attrSet].sort();

  const out = [];
  const push = (intent) => {
    const extent = extentOf(intent, objects, order);
    out.push({ extent, intent: [...intent].sort() });
    if (out.length > maxConcepts) {
      throw new Error(
        `fca: concept count exceeded ${maxConcepts} — refusing to report a partial lattice as a whole one`,
      );
    }
  };

  let current = closure(new Set(), objects, order, attrs);
  push(current);

  // NextClosure: walk attributes downward, take the first that yields a
  // lectically greater closed set.
  for (;;) {
    let next = null;
    for (let i = attrs.length - 1; i >= 0; i--) {
      const m = attrs[i];
      if (current.has(m)) continue;
      const candidate = new Set([...current].filter((x) => attrs.indexOf(x) < i));
      candidate.add(m);
      const closed = closure(candidate, objects, order, attrs);
      if (lecticLess(current, closed, attrs, i)) {
        next = closed;
        break;
      }
    }
    if (next === null) break;
    current = next;
    push(current);
  }

  return out;
}

/**
 * Cover edges of the concept lattice: [childIndex, parentIndex] where the child's
 * intent strictly contains the parent's and nothing sits between them.
 *
 * A larger intent is a MORE specific concept, so an edge child->parent reads
 * "child is a specialisation of parent".
 */
export function hasse(conceptList) {
  const intents = conceptList.map((c) => new Set(c.intent));
  const strictlyContains = (a, b) => {
    if (a.size <= b.size) return false;
    for (const x of b) if (!a.has(x)) return false;
    return true;
  };

  const edges = [];
  for (let i = 0; i < conceptList.length; i++) {
    for (let j = 0; j < conceptList.length; j++) {
      if (i === j || !strictlyContains(intents[i], intents[j])) continue;
      let covered = true;
      for (let k = 0; k < conceptList.length; k++) {
        if (k === i || k === j) continue;
        if (strictlyContains(intents[i], intents[k]) && strictlyContains(intents[k], intents[j])) {
          covered = false;
          break;
        }
      }
      if (covered) edges.push([i, j]);
    }
  }
  return edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * Objects that no attribute set separates.
 *
 * Two classes with identical attribute sets occupy one concept, so the encoding
 * cannot tell them apart. That is a reading about the ENCODING, not about the
 * classes -- the registry's prose distinctions are the control it is checked
 * against.
 */
export function indistinguishable(objectsInput) {
  const bySignature = new Map();
  for (const [id, attrs] of Object.entries(objectsInput)) {
    const sig = [...attrs].sort().join('\u0001');
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(id);
  }
  return [...bySignature.values()]
    .filter((g) => g.length > 1)
    .map((g) => g.sort())
    .sort((a, b) => a[0].localeCompare(b[0]));
}
