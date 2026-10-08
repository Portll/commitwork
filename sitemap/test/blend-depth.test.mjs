// node --test sitemap/test/ — additive light is the aperture glow and nothing else. Bridges, fault
// marks, sewer sinks and chain seams blend normally and test depth on a DARK ground too, so
// overlapping corridors cannot saturate to white and a seam cannot draw through solid geometry.
// The builders are LIFTED from demo.html by source anchor and run against a recording THREE stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(fileURLToPath(new URL('../demo.html', import.meta.url)), 'utf8');

// [start, stop) — the stop anchor is excluded
function between(startAnchor, stopAnchor, label) {
  const a = SRC.indexOf(startAnchor);
  assert.ok(a > -1, `${label}: start anchor not found in demo.html — the lift is stale, not the code`);
  const b = SRC.indexOf(stopAnchor, a);
  assert.ok(b > a, `${label}: stop anchor not found after start — the lift is stale`);
  return SRC.slice(a, b);
}

// three.js defaults: a material blends normally and tests and writes depth unless told otherwise
class Material { constructor(p = {}) { Object.assign(this, { blending: 'normal', depthTest: true, depthWrite: true }, p); } dispose() {} }
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new V3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
}
class Obj3D {
  constructor(geometry, material) { Object.assign(this, { geometry, material, userData: {}, renderOrder: 0, position: new V3() }); this.scale = { set() {} }; }
  lookAt() {}
}
class Geometry { setAttribute() {} dispose() {} }
const THREE = {
  NormalBlending: 'normal', AdditiveBlending: 'additive', DoubleSide: 'double',
  Color: class { offsetHSL() { return this; } },
  Vector3: V3, QuadraticBezierCurve3: class {}, BufferAttribute: class {}, BufferGeometry: Geometry,
  TubeGeometry: Geometry, ConeGeometry: Geometry, TorusGeometry: Geometry, CircleGeometry: Geometry, OctahedronGeometry: Geometry,
  Mesh: Obj3D, Sprite: class extends Obj3D { constructor(m) { super(null, m); } }, LineSegments: Obj3D,
  MeshBasicMaterial: Material, LineBasicMaterial: Material, SpriteMaterial: Material,
};
const MODE_LAYER = { dark: { neon: 0, chain: 0xff3355 }, light: { neon: -0.22, chain: 0xd0103a } };

function harness(M) {
  const added = [];
  const scene = { add: (o) => added.push(o), remove() {} };
  const h = new Function('THREE', 'MODE_LAYER', 'document', 'KIND_COLOR', 'M', 'posIndex', 'scene', 'glowByVulnId', 'hash01', 'radialGlowTexture',
    `${between('let TH=null;', 'const sceneSev=', 'scene helpers')}
     ${between('const detected=', '\n', 'detected')}
     ${between('function buildAirBridges(L,T){', '// LAYERS 5+6', 'air bridges')}
     ${between('let chainLine=null;', '// LAYER 7', 'chain seams')}
     ${between('function faultGeometryFor(type,base,nx,nz,col,sev){', 'function animate(){', 'fault marks')}
     return { set:(t)=>{TH=t;}, blend, buildAirBridges, showChain, faultGeometryFor };`,
  )(THREE, MODE_LAYER, { documentElement: { getAttribute: () => 'dark' } }, {}, M,
    { svc: new Map([['a', { x: 0, z: 0 }], ['b', { x: 90, z: 40 }], ['c', { x: -60, z: 70 }]]) },
    scene, {}, () => 0.5, () => ({}));
  h.set({ dark: true }); // the dark ground, where blend() answers additive
  return { ...h, added };
}

test('on a dark ground blend() is still additive — the aperture pass keeps its glow', () => {
  const h = harness({});
  assert.equal(h.blend(), 'additive');
  h.set({ dark: false });
  assert.equal(h.blend(), 'normal');
});

test('the aperture pass is the one additive site in the page', () => {
  assert.equal(SRC.split('THREE.AdditiveBlending').length - 1, 1, 'additive is reached only through blend()');
  const sites = SRC.match(/blending:[^,}]+/g) || [];
  assert.deepEqual(sites, ['blending:blend()'], `every other layer blends normally, found ${sites}`);
  assert.match(SRC, /apMesh=new THREE\.InstancedMesh\(new THREE\.BoxGeometry\(1,1,\.7\),\n\s*new THREE\.MeshBasicMaterial\(\{blending:blend\(\),/);
});

test('air bridges blend normally and their cores occlude by depth, halos drawn after the cores', () => {
  const h = harness({ airBridges: [
    { from: 'a', to: 'b', kind: 'grpc', count: 2, secure: true },
    { from: 'b', to: 'c', kind: 'kafka', count: 1, secure: true },   // crosses the first corridor
    { from: 'c', to: null, kind: 'http', count: 1, resolved: false }, // dangling stub
  ] });
  h.buildAirBridges({}, {});
  const bridges = h.added.filter((o) => o.userData.layer === 'bridges');
  assert.equal(bridges.length, 5, 'two corridors of core + halo, one stub');
  for (const o of bridges) {
    assert.equal(o.material.blending, 'normal', 'additive corridors wash out to white where they cross');
    assert.equal(o.material.depthTest, true);
  }
  const halos = bridges.filter((o) => o.material.opacity === 0.14);
  const cores = bridges.filter((o) => o.material.opacity !== 0.14);
  assert.equal(halos.length, 2);
  for (const c of cores) assert.equal(c.material.depthWrite, true, 'a core that writes no depth cannot hide the corridor behind it');
  for (const hl of halos) {
    assert.equal(hl.material.depthWrite, false, 'a halo is a haze, not a surface');
    for (const c of cores) assert.ok(hl.renderOrder > c.renderOrder, 'halos draw after every core, so they are depth-tested against them');
  }
});

test('a chain seam blends normally and is hidden by solid geometry in front of it', () => {
  const at = (x) => ({ pos: new V3(x, 0, 0) });
  const e = { ...at(0), vulns: [{ id: 'v1', chain: ['v2', 'v3'] }] };
  // showChain reads the page's glowByVulnId; this test's map is handed in under the same name
  const run = new Function('THREE', 'MODE_LAYER', 'document', 'scene', 'glowByVulnId', 'hovered',
    `${between('let TH=null;', 'const sceneSev=', 'scene helpers')}
     ${between('let chainLine=null;', '// LAYER 7', 'chain seams')}
     TH={dark:true}; showChain(hovered); return chainLine;`);
  const line = run(THREE, MODE_LAYER, {}, { add() {}, remove() {} }, { v2: at(40), v3: at(-40) }, e);
  assert.ok(line, 'no seam drawn');
  assert.equal(line.material.blending, 'normal');
  assert.notEqual(line.material.depthTest, false, 'a seam with depthTest off draws through the buildings between its ends');
});

test('every fault mark on the megalith blends normally', () => {
  const h = harness({});
  for (const type of ['memory', 'generic', 'fracture', 'corrosion', 'breach', 'erosion']) {
    const before = h.added.length;
    h.faultGeometryFor(type, new V3(0, 0, 0), 1, 0, new THREE.Color(), 'high');
    const marks = h.added.slice(before);
    assert.ok(marks.length > 0, `${type} drew nothing`);
    for (const o of marks) {
      assert.equal(o.material.blending, 'normal', `${type} mark is additive`);
      assert.notEqual(o.material.depthTest, false, `${type} mark ignores depth`);
    }
  }
});
