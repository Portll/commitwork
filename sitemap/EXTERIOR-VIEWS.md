<!-- verified-against: 2026-10-07 -->
# SiteMap — "City from the Outside": 6 Exterior Views

Companion to `demo.html`. The interior layers (functions, roads, wiring, air bridges, sewer,
CVE glows, containers, the Noir floor) map the codebase-as-a-city seen **from within**. This
document specifies six **exterior** views: the whole codebase rendered as one object seen from
the outside, where the surface itself carries the security story.

## The load-bearing rule (applies to all six)

> **Clean surface = smooth like glass. Vulnerable surface = physical deformation whose CHARACTER
> is keyed to the TYPE of vulnerability.**

A face/region with no `M.vulnerabilities` targeting it renders as an unbroken specular surface
(high `shininess`, low roughness, mirror-like). Where a vulnerability lands, the surface **erupts**
— and *how* it erupts encodes the vuln class. On mouseover the vulnerability is shown (id, severity,
pkg, fixed version, title); if the vuln is in a `chain`, a glowing seam connects its deformation to
the deformations of the other CVEs in the chain, so you can read the exploit path across the hull.

### Shared vuln-type → deformation map

This is already implemented in `demo.html` as `vulnType(v)` (a heuristic over `pkg`+`title`), and
the Megalith prototype's `faultGeometryFor()` renders each type. Every exterior view reuses the
same classification so the *language of damage* is consistent across all six:

| `vulnType` | Trigger (heuristic over pkg/title) | Deformation character | Colour |
|---|---|---|---|
| `memory` | buffer/overflow/UAF/OOB/segfault | **jagged crack** — thin zig-zag fracture line | severity |
| `fracture` | inject/sql/xss/rce/deserialize/ssrf/traversal | **splitting shard** — a wedge pushed out of the face | severity |
| `breach` | auth/jwt/oauth/token/privilege/bypass/BOLA/IDOR | **hole punched through** — dark ring + glowing rim | severity |
| `corrosion` | outdated/deprecated/EOL/stale version | **rust / pitting** — cluster of pocked patches | rust-brown |
| `erosion` | dos/denial/regex/redos/resource/leak | **worn / melted dent** — soft smear | severity |
| `generic` | (fallback) | **short zig-zag** — memory's crack branch with fewer, shorter segments (there is no distinct hairline-seam geometry) | severity |

Severity drives colour for every type except corrosion, whose pits are a fixed rust-brown:
`critical` red `#ff4d5e`, `high` orange `#ff6a00`, `medium` yellow `#ffd400`, `low` slate, and an
unrecognised severity lavender `#b58cff`. It also drives the glow PULSE RATE, which
`prefers-reduced-motion` holds still. It does **not** drive
deformation magnitude: `faultGeometryFor` takes `sev` as a parameter and never reads it, and every
dimension is a literal (memory `n=9, len=22`; generic `n=4, len=10`; cone `w=6, h=14`; torus `r=6`;
smear `10×20`). Measured 2026-08-29 — a critical crack is the same size as a low one. What DOES
compound is stacking: one deformation per CVE, so a heavily-vulnerable district visibly rots.

### Data these views actually consume

- `M.services[]` — `container`, `io[]` (I/O apertures by kind), `lifecycle`, and the service `tree`
  (size comes from `countFiles`, a `demo.html`-local tree walker — it is not a manifest field).
- `service.container` (image/baseImage) — groups services into **fleet units** (islands, wards, plates…).
- `io[].kind` — where the surface **opens** (http/grpc/amqp/kafka/jdbc/oauth/client…); becomes
  windows, vents, docks, antennae depending on the view.
- `M.vulnerabilities[]` — `{severity, target:{scope,ref}, pkg, title, chain, …}` — drives all
  deformation. Feature-detected; on a v1 manifest the synthetic fixture (`augmentV2`) supplies it,
  tagged `provenance:'synthetic'` so nothing implies certainty it doesn't have.
- `service.wiring` / `fileWiring` / `M.airBridges` — become inter-region seams, filaments, bridges.

With no `vulnerabilities` in the data, `augmentV2` synthesises a demo set tagged
`provenance:'synthetic'`, and the hover card names it as synthetic. No view renders a
"no vuln data" label.

---

## View 1 — **Obsidian Megalith** *(PROTOTYPED — live theme `megalith` in demo.html)*

**Form / colour / scale.** The entire repo as a single monolithic slab of black volcanic glass,
seen from a slow orbit against a void with a neon grid horizon (reuses the Monolith idiom). One
object, kilometre-tall proportions; the four faces are subdivided into per-service facade panels by
walking the perimeter (`layoutMonolith`'s `at(u)`).

**Services + containers → morphology.** Each service owns a vertical panel; panel **width** ∝
√(file count). Panels follow `placementPolicy`'s order, internal services first and the most external last;
services sharing a container image are not grouped.
I/O apertures glow as neon cut-outs on the face (existing Monolith behaviour), so the megalith reads
as inhabited.

**Clean vs vulnerable.** A clean panel is mirror-smooth black glass (`MeshPhongMaterial`, high
`shininess`, faint cyan specular) — you see the horizon reflected, nothing else. A vulnerable panel
**cracks**: `buildExteriorFaults()` places one deformation per CVE where the affected file or
function sits on the facade — `faultAnchor()` resolves the column and height from the vuln's target,
so distribution follows function. The stable hash-scatter is the FALLBACK, used only when a target
cannot be resolved.

**Vuln-type → deformation.** Exactly the shared map: `memory` → a 9-segment jagged emissive crack
climbing the face; `fracture` → a cone-shard pushed out through the glass; `breach` → a torus rim
around a punched-black circle (you can see *through* the megalith where auth broke); `corrosion` →
a stain of dim rust sprites; `erosion` → a soft vertical melt-smear.

**three.js approach (implemented).** Reuses `buildMonolith(T)`; when `T.exterior`, calls
`buildExteriorFaults(ML,T)`. Each fault is line/cone/torus/sprite geometry, normally blended,
placed using the face normal `(nx,nz)` and tangent `(-nz,nx)`. Every fault registers in the shared
`glowNodes`/`glowByVulnId` registry, so hover shows the CVE card and `showChain()` draws red
depth-tested seams between chained faults across the slab. A near-invisible pick-sprite per
fault makes even line-only faults hoverable. *Production upgrade:* replace the line-cracks
with true surface displacement — give the slab a subdivided `BoxGeometry` and a `ShaderMaterial`
whose vertex shader offsets vertices by `fbm(noise)` gated to a per-panel `uFault` uniform (0 =
glass-flat, 1 = shattered), with the noise octave count chosen by `vulnType` (few octaves =
smooth dent for erosion, many = sharp crack for memory).

---

## View 2 — **Living Reef** *(organic / coral)*

**Form / colour / scale.** The codebase as a deep-sea coral reef photographed from above and to
the side — a warm biological mass (bone-white / coral-pink / kelp-green) growing off a dark seabed.
Scale reads as "an organism", not a machine. Auto-rotating, gentle current sway.

**Services + containers → morphology.** Each service is a **coral colony**; colony *volume* ∝ file
count, its branching depth ∝ directory nesting (reuse `layoutRadial`'s recursion to spawn branch
tubes). Container groups are colonies growing on a shared **rock shelf** (a low extruded platform per
image). I/O apertures become **polyps**: outward clients as feeding tendrils, listeners (http/grpc)
as open mouths, brokers (amqp/kafka) as pulsing siphons — coloured by `KIND_COLOR`.

**Clean vs vulnerable.** Healthy coral is smooth, glossy, translucent (subsurface-scatter look via a
bright `MeshPhongMaterial` + rim light). Vulnerable coral is **diseased**: the shared deformation map
re-skinned biologically — `corrosion` → **bleaching** (colour drained to chalky white + pitting);
`memory`/`fracture` → **snapped branches** with jagged broken stubs; `breach` → a **bore-hole**
eaten clean through a branch (parasite tunnel); `erosion` → **necrosis** (a soft grey rot smear).

**Vuln-type → deformation.** Same `vulnType`. Magnitude drives how much of the colony is diseased;
stacked CVEs bleach a whole colony. Chains render as a **glowing infection filament** creeping from
colony to colony along the reef.

**three.js approach.** Colonies = recursively instanced `CylinderGeometry` branch tubes + `IcosahedronGeometry`
tips (low-poly, `flatShading:false` for the wet look). Health as a per-branch vertex-colour lerp
toward chalk-white; disease deformation via `vertexShader` displacement using `sin`-noise for
bleaching bulges and a boolean-ish notch for snapped branches (drop the tip geometry, expose a
darkened cross-section disc). Bore-holes: subtract with a dark `TorusGeometry` collar. One
`InstancedMesh` per geometry type keeps it cheap at fleet scale.

---

## View 3 — **Crystalline Lattice** *(mineral / gem)*

**Form / colour / scale.** The repo as a single grown crystal cluster — interlocking prismatic
spires of tinted glass rising from a common matrix, lit from inside. Cool palette (amethyst,
aquamarine, smoky quartz per dominant language). Reads as precise, faceted, engineered.

**Services + containers → morphology.** Each service is a **prism** whose height ∝ symbol count and
whose facet-count ∝ number of distinct I/O kinds (a service that speaks http+grpc+amqp+jdbc is a
richly-faceted spire; a leaf util is a simple shard). Container groups **share a base cluster** —
prisms fused at the root, same tint. Language mix sets the internal colour (reuse `langColor`).

**Clean vs vulnerable.** A flawless crystal is optically perfect: `MeshPhysicalMaterial`-style
transmission, sharp edges, internal caustics. A vulnerable crystal has **inclusions and cleavage
planes** — the shared map as mineral defects: `memory`/`fracture` → a **cleavage crack** splitting
the prism along a plane (a bright internal fault); `corrosion` → **clouding / occlusion** (the glass
goes milky, light stops passing); `breach` → a **missing facet** (a chunk cleaved away, a raw hole);
`erosion` → **frosting** (surface roughened, specular lost).

**Vuln-type → deformation.** Same `vulnType`. Severity = crack depth / cloud density. A crystal with
stacked criticals is shot through with fractures and barely transmits light — it reads as "sick" from
across the room. Chains = a **refracted light-beam** that bends from inclusion to inclusion.

**three.js approach.** Prisms = `CylinderGeometry(rTop, rBottom, h, facets)` with `facets` from the
I/O-kind count; edges emphasised with `EdgesGeometry`. Clean material: high `shininess`, `transparent`,
low opacity, additive rim. Defects via a `ShaderMaterial` mixing (a) a clip-plane-style dark band for
cleavage cracks (drive plane offset from CVE hash), (b) a `uCloud` uniform raising a milky emissive
term for corrosion, (c) vertex displacement inward for a missing facet. Internal light = a small
`PointLight` per prism dimmed by total corrosion so sick crystals literally go dark.

---

## View 4 — **Walled Fortress-City** *(silhouette / rampart)*

**Form / colour / scale.** The classic "city skyline from outside the walls" — a fortified ring wall
enclosing a dense keep, viewed from the plain at dusk. Stone-grey ramparts, warm window-light within,
a moat. Emphasis on **silhouette** and **defensibility**, which is the security metaphor made literal.

**Services + containers → morphology.** The **outer wall** is built from the services that expose
public I/O (http/socket/oauth) — each such service is a **gate or tower** in the wall, sized by its
exposed surface. Internal-only services form the **inner keep** (towers behind the wall). Container
groups are **wards** (walled sub-districts). I/O apertures are **gates** (http), **arrow-slits**
(internal grpc), **posterns** (outbound client), **watchtowers** (oauth/IdP — the guard posts).

**Clean vs vulnerable.** Sound masonry is smooth dressed stone. Vulnerabilities are **breaches in the
defences**, and the wall is exactly where an attacker reads the map: `breach` (auth) → a literal
**collapsed section of wall** / broken gate (this is the headline view for auth CVEs); `memory` →
**cracked battlements**; `fracture` (injection) → a **sapped tower** leaning/split; `corrosion` →
**crumbling weathered stone** (outdated deps literally erode the wall); `erosion` (dos) → a
**silted, breachable moat**.

**Vuln-type → deformation.** Same `vulnType`, re-skinned as siege damage. Severity = size of the
breach. A perimeter service with a stacked critical auth CVE shows a **gaping hole with fire-glow**
you can see from the orbit view — the fastest possible read of "this is where they get in". Chains =
a **torchlit path** drawn from breach to breach: the attacker's route through the walls.

**three.js approach.** Wall = extruded `BoxGeometry` segments along the treemap perimeter; towers =
taller boxes at exposing services. Windows/gates = emissive quad decals (reuse the aperture
instancing) coloured by `KIND_COLOR`. Damage: for each fault, boolean-style *remove* a wall segment
(scale a segment's `y` toward 0 and add a jagged `LineSegments` rubble crown) for breaches; a
`ShaderMaterial` roughness/darkening ramp for corrosion; a tilt on the tower `rotation.z` for saps.
Fire-glow at criticals = an additive sprite + flicker in `animate()`. Chains via a floor `Line`
path with animated dash offset.

---

## View 5 — **Floating Archipelago** *(container-islands)* — *strongest container story*

**Form / colour / scale.** A cluster of islands adrift over a dark sea of cloud, each island a
**container image**, tethered to its neighbours by rope-bridges (this is where `service.container`
and `M.airBridges` shine). Bright, diorama-like, gently bobbing. Scale reads as an *archipelago you
could sail between* — the fleet made spatial.

**Services + containers → morphology.** **One island per container image** (`containerKey`). The
services in that image are the island's **buildings/hills**, sized by file count — so a fat base
image hosting many services is a large crowded island, a single-service image is a lone rock. Island
*altitude* could encode `lifecycle` (retired images sink lower, greyer). **Air bridges** (`M.airBridges`)
are the **rope-bridges** between islands, coloured/animated by `io kind` (reuse the interior air-bridge
arc code directly — same `KIND_COLOR`, same `TubeGeometry`), so you literally see the secure
corridors spanning the sea.

**Clean vs vulnerable.** A healthy island is lush, smooth green with clean rock cliffs. Vulnerabilities
are **geological/biological damage** on the island that owns the CVE (`target.scope==='container'`
hits the whole island; `file`/`function` hit a specific building): `memory`/`fracture` → **cliff
cracks / a calving chunk**; `corrosion` → **a rust-red blighted patch of dead ground** (outdated
base image = the island is rotting); `breach` → **a sinkhole / cave-in** (a hole you can see the sea
through); `erosion` → **coastal erosion**, the shoreline eaten back.

**Vuln-type → deformation.** Same `vulnType`. A container image with many stacked CVEs is a
**sinking, cracked, blighted island** — the fleet's worst image is obvious from orbit. Chains draw a
**glowing storm-arc** between the affected islands (the exploit weather system), distinct from the
calm rope-bridges.

**three.js approach.** Islands = a low `CylinderGeometry` (rock) capped by a displaced
`PlaneGeometry`/`ConeGeometry` (terrain), grouped in a `THREE.Group` per `containerKey`; buildings =
the existing file `InstancedMesh` re-parented onto the island. Bob = per-island `position.y +=
sin(t*rate+phase)` in `animate()`. Bridges = the interior `buildAirBridges` tubes, unchanged. Damage
via terrain-vertex displacement keyed to the island's aggregated vuln set: a `uBlight` uniform tints
+ pits ground for corrosion, a vertex-carve for sinkholes (push a disc of vertices down through the
island), edge-crack `LineSegments` for cliffs. Labels reuse the container-envelope label code.

---

## View 6 — **Planet from Orbit** *(globe / biosphere)*

**Form / colour / scale.** The whole codebase as a single planet seen from orbit — a slowly turning
sphere with continents, city-lights on the night side, and an atmosphere. The grandest scale: the
repo as a *world*. Deep-space black background, a rim of atmospheric scatter, one key light as the
sun so there's a terminator (day/night) sweeping the surface.

**Services + containers → morphology.** Services are **territories** partitioned across the sphere
(a spherical treemap / equal-area partition of `layoutTreemap` rects mapped onto lat-long). Territory
*area* ∝ file count. Container groups are **continents** (contiguous territory blocs sharing a plate).
I/O apertures become **city-lights on the night side** (each endpoint a lit point, brightness ∝
count, colour by `KIND_COLOR`) — so the planet's night side glows exactly where the code talks to the
world. `airBridges` are **satellite/comm arcs** in low orbit between territories.

**Clean vs vulnerable.** A healthy surface is smooth ocean-and-land with a clean atmosphere.
Vulnerabilities are **planetary-scale scars** on the owning territory: `memory`/`fracture` → a
**rift valley / tectonic crack** splitting the crust (glowing lava seam); `corrosion` → a
**spreading blight / dead-zone** (outdated deps desertify the region); `breach` → an **impact
crater** punched into the surface (a hole with an ejecta ring); `erosion` → a **coastal / storm
scar**. The **atmosphere** aggregates health: a heavily-vulnerable planet grows an angry red haze
(total critical count raises a global emissive atmosphere term) — you read the repo's overall
security posture from the *colour of the air* before you even zoom in.

**Vuln-type → deformation.** Same `vulnType`, at planetary scale. Chains render as a **glowing
fault-arc following the great-circle** between affected territories — a crack that girdles the world.
Stacked CVEs deepen the rift / widen the crater.

**three.js approach.** Base = an `IcosahedronGeometry(r, detail)` sphere with a `ShaderMaterial`:
day/night by `dot(normal, sunDir)`, night-side city-lights sampled from an aperture data-texture
(bake service endpoints to a lat-long `DataTexture`). Territory partition: assign each vertex a
service via nearest-territory-centroid, pass a per-vertex `vSvc` attribute. Deformation via **vertex
displacement in the shader** keyed to a per-territory vuln-type/severity uniform array (or a second
data-texture): rifts = high-frequency ridged noise along a line; craters = a radial `smoothstep`
dimple; blight = a colour+roughness ramp with no geometry change. Atmosphere = a slightly larger
back-face sphere with additive Fresnel, its tint driven by global critical count. Comm arcs reuse
`buildAirBridges` in orbit. Rotation via `autoRotate` (already supported per theme).

---

## Implementation posture (all six)

- **One scene graph, theme presets.** Each view is a `THEMES` entry (like `megalith`) plus one
  `buildX()` builder branched by a theme flag — never a second renderer. View 1 is already wired
  this way; Views 2–6 follow the same `T.exterior`/dedicated-builder pattern.
- **Feature-detected, honest provenance.** Every view reads `M.vulnerabilities` through the same
  `detected()` gate as the interior layers; `vulnType()` classifies faults for the exterior view
  only. Synthetic demo data is
  tagged `provenance:'synthetic'`; deformation from synthetic vulns should render slightly
  translucent / dashed exactly like the interior heuristic styling, so an exterior view never
  *implies* a scan it doesn't have.
- **Shared hover + chain.** All six register deformations in `glowNodes`/`glowByVulnId` and reuse
  `vulnTip()`, `showChain()`, and `showFileFromVuln()` — hover shows the CVE, chained CVEs draw a
  connecting seam, click opens the side panel. Zero new UI plumbing per view.
- **Vendored three.js r147 only.** All geometry/materials above are r147 built-ins
  (`Ico/Cylinder/Cone/Torus/CircleGeometry`, `ShaderMaterial`, `TubeGeometry`, `Sprite`). Custom
  looks come from inline GLSL in `ShaderMaterial`, no external libraries, no build step.
- **Displacement is the throughline.** The production form of every view drives deformation through
  **vertex displacement in a `ShaderMaterial`**, with a per-region `uFault`/`uType`/`uSeverity`
  uniform (or data-texture at fleet scale). The Megalith prototype uses additive overlay geometry as
  a no-shader stand-in; upgrading it to displacement is the same pattern the other five specify.
