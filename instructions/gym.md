# Gym

Four scenes, one per room (Gym epic #58). Each room is a level file plus a tool (`src/game/gym/<tool>.js`, level
field `tool`) for its readouts, overlays and keys, and a browser suite that uses the room as its fixture.
Measured values go into `instructions/metrics.md` (section 8); this file says what each room contains and how to use it.

## Traversal and cover (`?scene=gym`, #64)

(to be written)

---

## Weapon range (`?scene=gym-range`, #65)

(to be written)

---

## Enemy behaviour (`?scene=gym-ai`, #66)

(to be written)

---

## Performance stress (`?scene=gym-stress`, #67)

Measures what content costs, so encounters can be budgeted (numbers: `engine.md`, "Per-encounter budget").
- **Room**: 80 x 80 m floor, a ring of 16 cover boxes at r = 26 (alternating low 1.1 and high 2.8, so cover and shadows are drawn too),
  a few labels. Spawn (0, 0, 36) facing the centre. Axis-aligned boxes and the existing materials only.
- **Tool** (`gym/stress.js`, `StressTool`): a DOM panel (top-left) with a slider per kind: puppets (`enemy.static`), troopers
  (`enemy.trooper`), drones (`enemy.drone`), point lights (`light.point`), effect bursts per second (a `blast` event: 16 sparks,
  smoke, shockwave ring; sparks are capped at 256 by `fx.js`). Units are built through the registry (same builders as a level file)
  on concentric rings around the centre (`ringSlot`), so a count always costs the same. Buttons: Destroy (kills every spawned enemy:
  debris cost), Clear, Sweep.
- **Keys**: click a row to select it, `[` / `]` step its count down / up (Shift: 4 at a time), `P` runs the sweep: for every kind
  0, 4, 8, 16, 32, 64 units, 0.6 s settle + 1.2 s sampled, a table in the console (`console.table`) and in `tool.results`.
- **Readout**: frame ms (avg and p95 of the last 120 frames, wall time between frames), draws, triangles, geometries, textures, lights
  (`renderer.info`, whole frame incl. shadow and post passes). The frame time is only meaningful on target hardware.
- **Enemies don't fight**: the tool sets `enemies.demo` (they see a dead player), so only rendering and update cost is measured.
  Killing puppets still drops ammo clips (Pickups, 45%, gone after 25 s).
- **Runtime spawning**: `Enemies.spawn(piece)` / `Enemies.despawn(actor)` (stand slots are reused, the stand buffers grow on demand).
  Lights are built with the `light.point` builder and freed by the tool (`disposeTree`); `dispose()` frees everything it spawned.
- **Test** (`tests/gym-stress.browser.mjs`): per-unit draws / triangles / geometries are asserted linear and stable (0..32 of each
  kind, worst case: all in view, near LOD, culling off); frame time only printed. Also: far LOD cost, debris cost, enemies never
  fire, keys and sweep, clearing returns geometries / textures / scene objects to the baseline, scene switches with 80 units spawned
  leave no leak. `SHOT=/path.png` saves a screenshot with a crowd; `ONLY=fx` runs the cost table of one kind.
- Gotchas: adding / removing point lights recompiles shaders (a hitch, not a leak; the sweep's `settle` skips it). The fx pools
  create hidden meshes on demand, so the scene object count grows up to the most particles ever alive at once, then stays.
