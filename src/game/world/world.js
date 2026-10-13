import * as THREE from 'three';
import { gridTexture, panelTexture, applyWorldUVs } from './textures.js';
import { mergeStatic, mergeGroup } from '../../engine/batch.js';
import { disposeTree } from '../../engine/dispose.js';
import { GUNS, gunMaterials } from '../combat/guns.js';
import { KIT_PIECES, MAT } from './kit.js';
import { Grid } from './grid.js';
import { onProblem } from './encounter.js';
import { PROP_PIECES, propMaterials, animateProps } from './props.js';
import { ARCH_PIECES } from './arch.js';

// Static level: axis-aligned boxes only (collision, cover and shadows depend on that).
// Coordinates: x = east, z = south, y = up. Floor is y = 0.
// The layout lives in the level file (src/levels/*.json, instructions/level.md); this module builds its
// environment pieces (env.*, light.*) through the piece registry and frees them again (unload). Sky, sun, fog and
// materials stay in code and outlive every level.

// Point lights are a fixed pool: three.js compiles every lit material's program for the number of lights in the scene, so
// the count must never change while a level is loaded or edited (a hitch per light placed, per scene switch). The pool is
// built with the World and sized by the quality tier (QUALITY[tier].lights = the point-light cap in instructions/engine.md);
// only a quality change resizes it (setLightPool, one recompile, a settings action). A level's lights are records (pointLight:
// position, colour, intensity, distance), any number of them; every LIGHT_PICK.every s (or when the focus jumps) the pool is
// handed to the records that matter most from the camera, and lights swapping in or out fade over LIGHT_PICK.fade s.
// An unused pool light has intensity 0 and waits far below the floor (three still loops it in the shader).
const PARKED = new THREE.Vector3(0, -1000, 0);
// every: s between reselects; move: m of focus travel that forces one; fade: s to ramp a light in / out;
// keep: score bonus of a light already live (two equal lights do not trade places every reselect)
const LIGHT_PICK = { every: 0.2, move: 2, fade: 0.25, keep: 1.2 };

export const ALARM = { color: '#ff9a2a', strength: 0.4, rate: 1.6, pulse: 3.2 }; // alarm lighting state: amber warning tint (not red: that reads as low health), 0..1 mix, blend per second, pulse rad/s
const HAZE = '#4f7b7e'; // horizon and fog: teal-cyan haze, desaturated
export const SUN_DIR = new THREE.Vector3(0.45, 0.78, 0.43).normalize();

// Per-face material array for BoxGeometry (order: +x, -x, +y, -y, +z, -z).
function faces(def, { px, nx, py, ny, pz, nz } = {}) {
  return [px ?? def, nx ?? def, py ?? def, ny ?? def, pz ?? def, nz ?? def];
}

// Environment pieces (registry ids, a public contract: instructions/level.md). Builders run against the World.
// data: { id, pos, name?, params }. `pos` is the box center x/z and its bottom y. An entry is a builder or
// { build, example: { params, yaw? }, label } (what the Library spawns and its one-line stats); the kit.* pieces live in kit.js.
export const WORLD_PIECES = {
  ...KIT_PIECES,
  // params: size [w, h, d], mat (key of World.mats), faces? { px|nx|py|ny|pz|nz: mat key } (overrides one side),
  // cover? 'low' | 'high' | 'wall', collide? (default true), shadow? (default true)
  'env.box': {
    example: { params: { size: [3, 1.1, 1], mat: 'low', cover: 'low' } },
    label: 'BOX any size, axis-aligned',
    fields: [{ key: 'size', type: 'vec3', min: 0.1 }, { ...MAT, optional: false }, { key: 'cover', type: 'enum', options: ['low', 'high', 'wall'], optional: true }, { key: 'collide', type: 'bool', def: true }, { key: 'shadow', type: 'bool', def: true }],
    build: (world, d) => {
      const { size, cover, collide, shadow } = d.params;
      const opts = { cover: cover ?? null, collide: collide ?? true, shadow: shadow ?? true };
      return world.box(d.pos[0], d.pos[1], d.pos[2], ...size, world.material(d.params), opts);
    },
  },
  // emissive, non-colliding, non-shadowing box. params: size, mat, ownMaterial? (clone the material, e.g. to flicker alone)
  'env.strip': {
    example: { params: { size: [4, 0.2, 0.2], mat: 'stripCyan' } },
    label: 'STRIP emissive, no collision',
    fields: [{ key: 'size', type: 'vec3', min: 0.01 }, { ...MAT, optional: false }],
    build: (world, d) => {
      const m = world.strip(d.pos[0], d.pos[1], d.pos[2], ...d.params.size, world.material(d.params, d.params.ownMaterial));
      if (d.name) world.named.set(d.name, m);
      return m;
    },
  },
  // params: color '#rrggbb', intensity, distance, flicker? { strip: name of an earlier env.strip }
  'light.point': {
    example: { params: { color: '#38d8ff', intensity: 40, distance: 14 } },
    label: 'POINT LIGHT colour, intensity, distance',
    fields: [{ key: 'color', type: 'text' }, { key: 'intensity', type: 'number', min: 0 }, { key: 'distance', type: 'number', min: 0 }],
    build: (world, d) => {
      const { color, intensity, distance, flicker } = d.params;
      let f = null;
      if (flicker) {
        const strip = flicker.strip == null ? undefined : world.named.get(flicker.strip);
        if (flicker.strip != null && !strip) throw new Error(`light.point: flicker strip "${flicker.strip}" must be defined before the light`);
        f = { strip };
      }
      return world.pointLight(d.pos[0], d.pos[1], d.pos[2], color, intensity, distance, f);
    },
  },
  // Unlit text sign (Gym / Library markers), no collision, no shadow. pos = bottom center of the text.
  // params: text, size? (letter height in m, default 0.6), yaw? (rad, default 0 = readable from +Z),
  // flat? (lie on the floor, readable walking toward -Z, rotated by yaw), color? '#rrggbb', bg? css color
  // text may hold input tokens ({jump} {aim} {fire} {sprint} {interact} {reload}, controls.js): the key / button of the active device, repainted on a device change
  'env.label': {
    example: { params: { text: 'LABEL', size: 0.6 } },
    label: 'LABEL text sign, no collision',
    fields: [{ key: 'text', type: 'text' }, { key: 'size', type: 'number', min: 0.1 }, { key: 'flat', type: 'bool', def: false }],
    build: (world, d) => world.label(d.pos, d.params),
  },
  // Display model of one gun (Library). params: gun (key of GUNS). The model sits at pos with its stock at the origin,
  // barrel along +Z turned by yaw. No collision; freed on unload.
  // params: gun (key of GUNS), hideOn? (an `on` form, encounter.js: the model disappears when it happens, e.g. `objective:armoury:done` for a rack)
  'prop.gun': {
    example: { params: { gun: 'rifle' } },
    label: 'display model of one gun, can hide on an event',
    fields: [{ key: 'gun', type: 'enum', options: Object.keys(GUNS) }, { key: 'hideOn', type: 'text', optional: true }],
    check: (p, registry) => (p.hideOn == null ? null : onProblem(p.hideOn, 'hideOn', registry.guns)),
    build: (world, d) => world.gunProp(d),
  },
  ...PROP_PIECES, // set dressing: prop.console, prop.crate, prop.cables, prop.pipes, prop.puppetRack, prop.arm, prop.cradle, prop.bench, prop.hazard, prop.panel (props.js)
  ...ARCH_PIECES, // architectural dressing: arch.cove, arch.rib, arch.panelling, arch.bulkhead, arch.floorChannel, arch.coffers, arch.catwalk (arch.js)
};

const COLLIDER_CELL = 4; // m, grid cell of the collider hash (arena boxes are 1-10 m; bigger spans use several cells)
let _t0 = 0;
let _t1 = 1;
// 1D slab of the segment parameter range [_t0, _t1] against (lo, hi); true while the range is non-empty.
function slab(p, d, lo, hi) {
  if (Math.abs(d) < 1e-9) return p > lo && p < hi;
  let ta = (lo - p) / d;
  let tb = (hi - p) / d;
  if (ta > tb) {
    const t = ta;
    ta = tb;
    tb = t;
  }
  if (ta > _t0) _t0 = ta;
  if (tb < _t1) _t1 = tb;
  return _t0 < _t1;
}

export class World {
  // Two lifetimes. Permanent (built once): materials + grid textures, sky, fog, hemisphere and sun. Per level
  // (load / unload, mirrored step by step): zones, boxes and strips (+ merged batches), point lights, colliders.
  // The arrays are cleared in place, other systems hold them by reference.
  constructor(scene, { lights = 8, inputName = (t) => { throw new Error(`label token {${t}}: no input resolver`); } } = {}) {
    this.scene = scene;
    this.inputName = inputName; // (token, scheme) -> key name, injected by Game (controls.js); signs never see Controls
    this.scheme = 'kbm'; // input scheme the token labels show (setScheme)
    this.named = new Map(); // piece name -> mesh (for references between pieces, e.g. a light flickering a strip)
    this.colliders = []; // { box: Box3, mesh, cover: 'low' | 'high' | null }
    this.grid = new Grid(COLLIDER_CELL);
    this.gridDirty = true;
    this.meshes = []; // raycast targets for bullets / camera / LOS
    this.coverMeshes = [];
    this.interiorZones = [];
    this.flickerLights = [];
    this.alarm = { level: 0, target: 0, strength: ALARM.strength, color: new THREE.Color(ALARM.color), t: null }; // lighting state (setAlarm)
    this.staticMeshes = []; // every level box; merged per material for rendering, kept as raycast proxies
    this.lights = []; // the level's point-light records (pointLight), any number; the pool lights show the best of them
    this.pool = []; // permanent THREE.PointLights (QUALITY lights); one without a record is parked at intensity 0
    this.lightFocus = new THREE.Vector3(); // where the last reselect looked from
    this.lightClock = 0; // s since the last reselect
    this.lightsDirty = true; // a record came or went, or the pool changed size: reselect on the next update
    this.lightSnap = true; // the next reselect lights its picks at once, no fade (level load, quality change)
    this.lightPending = 0; // picked records still waiting for a free pool light
    this.labels = []; // env.label meshes: own geometry, material and canvas texture each
    this.props = []; // prop.gun display models, prop.arm / prop.cradle rigs and the props' hidden colliders: own geometry, shared materials
    this.consoles = []; // prop.console positions (Vector3), for the audio's console hum; cleared with the level
    this.gates = []; // kit.gate records (addGate): { mesh, col, y0, h, dir, time, on, open, opening, inert }
    this.gizmoMode = false; // set while spawn() builds a gizmo piece (editor, Library): a gate is inert and shows its travel
    this.registry = null; // of the loaded level, for spawn()
    this.batches = [];

    this.mats = this.#makeMaterials();
    this.skins = this.#makeSkins();
    this.skin = null; // the loaded level's `skin` (a key of this.skins), null = the grid prototype materials
    // gun display models share these (STEM-00's olive furniture, like the player's guns); permanent like the level materials
    this.propMats = gunMaterials();
    this.dressing = propMaterials(); // the prop.* set dressing materials (props.js); panels add theirs to `keep` as they appear
    const dressing = Object.values(this.dressing).filter((m) => m.isMaterial);
    this.keep = new Set([...Object.values(this.mats), ...Object.values(this.propMats), ...dressing, ...Object.values(this.skins).flatMap((t) => Object.values(t))]); // shared across levels: never disposed with a level
    this.#buildSky();
    this.#buildLights();
    this.setLightPool(lights);
  }

  // Resizes the pool (quality change only: the light count changes, so shaders recompile once); the records are reassigned at once.
  setLightPool(n) {
    if (n === this.pool.length) return;
    while (this.pool.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 1, 2);
      l.position.copy(PARKED);
      l.userData.rec = null; // the record it shows
      l.userData.k = 0; // fade, 0..1
      this.scene.add(l);
      this.pool.push(l);
    }
    while (this.pool.length > n) {
      const l = this.pool.pop();
      if (l.userData.rec) l.userData.rec.userData.slot = null;
      disposeTree(l);
    }
    this.lightsDirty = this.lightSnap = true;
  }

  // level: parsed level file; registry: Registry holding WORLD_PIECES.
  load(level, registry) {
    this.unload();
    this.registry = registry;
    this.#buildLevel(level, registry);
    // ~60 boxes x up to 6 face materials -> one draw per material per 64 m chunk, one chunk for small levels (+ one shadow draw per chunk)
    this.batches = mergeStatic(this.staticMeshes, this.scene);
    this.lightSnap = true; // the level opens lit, no fade-in
    return this;
  }

  // Removes and frees the level: proxies and merged batches (geometry, own material clones), point lights.
  unload() {
    for (const m of this.staticMeshes) disposeTree(m, { keep: this.keep });
    for (const m of [...this.batches, ...(this.batches.shadows ?? [])]) disposeTree(m, { keep: this.keep });
    for (const l of this.lights.slice()) this.releaseLight(l);
    // disposeTree leaves textures alone (shared caches); a label's canvas texture is its own
    for (const m of this.labels) {
      m.material.map.dispose();
      disposeTree(m);
    }
    for (const g of this.props) disposeTree(g, { keep: this.keep });
    for (const g of this.gates) {
      disposeTree(g.mesh, { keep: this.keep });
      for (const l of g.lamps) disposeTree(l, { keep: this.keep });
    }
    this.batches = [];
    this.gridDirty = true;
    for (const list of [this.props, this.consoles, this.gates, this.staticMeshes, this.colliders, this.meshes, this.coverMeshes, this.interiorZones, this.flickerLights, this.lights, this.labels]) list.length = 0;
    this.named.clear();
  }

  // Runtime spawn (tools, tests): builds one world piece after load through the registry and returns a handle for
  // despawn(). Boxes spawned this way are not merged into the level batches (they stay individual meshes).
  // gizmo: for the editor and the Library (a gate is inert and draws where it slides to; nothing reacts to events).
  spawn(data, { gizmo = false } = {}) {
    const seen = new Set(this.scene.children);
    this.gizmoMode = gizmo;
    let piece;
    try {
      piece = this.registry.build('world', this, data);
    } finally {
      this.gizmoMode = false;
    }
    return { piece, objects: this.scene.children.filter((o) => !seen.has(o)) };
  }

  // Removes and frees what spawn() built (boxes, labels, lights, props, and their collision).
  despawn(handle) {
    if (handle.piece?.isLightRecord) this.releaseLight(handle.piece); // light records are not scene objects: none in the handle
    const gone = new Set(handle.objects);
    for (const o of handle.objects) {
      if (this.labels.includes(o)) o.material.map.dispose();
      disposeTree(o, { keep: this.keep });
    }
    const drop = (list, of = (x) => x) => {
      for (let i = list.length - 1; i >= 0; i--) if (gone.has(of(list[i]))) list.splice(i, 1);
    };
    for (const list of [this.staticMeshes, this.meshes, this.coverMeshes, this.lights, this.labels, this.props]) drop(list);
    drop(this.gates, (g) => g.mesh);
    drop(this.colliders, (c) => c.mesh);
    this.gridDirty = true;
    drop(this.flickerLights, (f) => f.light);
    for (const [k, v] of this.named) if (gone.has(v)) this.named.delete(k);
  }

  // A gun's display model: its own model builder, merged to one mesh per material (shared propMats: free it with
  // disposeTree(g, { keep: world.keep })). Stock at the origin, barrel along +Z. `who` names the piece in the error.
  gunModel(gun, who = 'prop.gun') {
    const def = GUNS[gun];
    if (!def) throw new Error(`${who}: unknown gun "${gun}"`);
    return mergeGroup(def.build(this.propMats));
  }

  // prop.gun: the gun's display model standing at pos.
  gunProp({ pos, yaw = 0, params }) {
    const g = this.gunModel(params?.gun);
    g.position.set(...pos);
    g.rotation.y = yaw;
    g.traverse((o) => (o.castShadow = o.isMesh));
    g.userData.hideOn = params.hideOn ?? null;
    this.scene.add(g);
    this.props.push(g);
    return g;
  }

  // A sliding gate (kit.gate): `mesh` is the box kit.js just built through box(). It leaves the static batches (it moves) but keeps its
  // collider and raycast entry; `react('<on form>')` starts it opening. opts: { on, height, slide: 'up' | 'down', time, lamps (status lamp meshes), lampOpen (their material once open) }. Inert in gizmo mode
  // (editor, Library): it stays shut whatever happens and shows a ghost of the space it slides into.
  addGate(mesh, { on, height, slide, time, lamps = [], lampOpen = null }) {
    const i = this.staticMeshes.indexOf(mesh);
    if (i >= 0) this.staticMeshes.splice(i, 1); // merged batches are static
    const g = { mesh, col: mesh.userData.collider, y0: mesh.position.y, h: height, dir: slide === 'down' ? -1 : 1, time, on, lamps, lampOpen, open: 0, opening: false, inert: this.gizmoMode };
    this.gates.push(g);
    if (g.inert) {
      const { width, height: h, depth } = mesh.geometry.parameters;
      const box = new THREE.BoxGeometry(width, h, depth);
      const ghost = new THREE.Group();
      ghost.add(new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0x3fe0ff, transparent: true, opacity: 0.2, depthWrite: false })), new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0x3fe0ff, depthTest: false })));
      ghost.position.y = g.dir * height;
      ghost.traverse((o) => {
        o.raycast = () => {};
        o.userData.gizmo = true;
      });
      mesh.add(ghost);
    }
    return mesh;
  }

  // A level event happened (`key` in the `on` forms of encounter.js): gates waiting for it start opening, props with `hideOn` hide,
  // arms with `retractOn` fold up, cradles with `releaseOn` open. Called by Encounter. Returns how many gates started opening.
  // onArm(pos): called once for each arm that starts folding up (Encounter emits `prop:retract`).
  react(key, onArm) {
    for (const g of this.props) {
      if (g.userData.hideOn === key) g.visible = false;
      const arm = g.userData.arm;
      if (arm?.on === key && !arm.retracting) {
        arm.retracting = true;
        onArm?.(g.position);
      }
      if (g.userData.cradle?.on === key) g.userData.cradle.releasing = true;
    }
    let n = 0;
    for (const g of this.gates) {
      if (g.inert || g.opening || g.on !== key) continue;
      g.opening = true;
      for (const l of g.lamps) l.material = g.lampOpen; // status lamp: sealed red -> open cyan
      n++;
    }
    return n;
  }

  // Moves a gate to `open` (0 shut .. 1 open). Fully open it is out of the way: no collision, no raycast hits, not drawn.
  #moveGate(g, open) {
    g.open = open;
    const dy = g.dir * g.h * open;
    const m = g.mesh;
    m.position.y = g.y0 + dy;
    m.updateMatrix();
    const b = g.col.box;
    if (open >= 1) {
      b.min.y = b.max.y = -1000; // parked: collideCircle and groundAt skip it (x / z stay so the collider grid stays valid)
      m.visible = false;
      const k = this.meshes.indexOf(m);
      if (k >= 0) this.meshes.splice(k, 1);
    } else {
      b.min.y = g.y0 - g.h / 2 + dy;
      b.max.y = g.y0 + g.h / 2 + dy;
    }
  }

  // Textures of the permanent materials (grid textures, skins, gun props), for an upfront GPU upload (game.js).
  permanentTextures() {
    return [...new Set([...this.keep].map((m) => m.map).filter(Boolean))];
  }

  // Material of a piece: params.mat names an entry of this.mats, params.faces overrides single box sides. A level with
  // a `skin` swaps each key for the skin's material of the same role (same keys, so draw calls don't change).
  material({ mat, faces: f }, clone = false) {
    const pick = (key) => this.skins[this.skin]?.[key] ?? this.mats[key];
    const base = pick(mat);
    if (!base) throw new Error(`level: unknown material "${mat}"`);
    if (f) return faces(base, Object.fromEntries(Object.entries(f).map(([side, name]) => [side, pick(name)])));
    return clone ? base.clone() : base;
  }

  #makeMaterials() {
    const std = (tex, opts = {}) =>
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.0, ...opts });
    return {
      floor: std(gridTexture({ base: '#7d8187', label: '2m' })),
      wall: std(gridTexture({ base: '#b9bcc1', alt: 'rgba(0,0,0,0.05)' })),
      low: std(gridTexture({ base: '#e07a2e', major: 'rgba(255,255,255,0.35)', label: 'LOW' })),
      high: std(gridTexture({ base: '#4f7fb8', major: 'rgba(255,255,255,0.3)', label: 'HIGH' })),
      platform: std(gridTexture({ base: '#9a9ea4' })),
      inFloor: std(gridTexture({ base: '#4a4f57', minor: 'rgba(255,255,255,0.06)', major: 'rgba(255,255,255,0.12)', label: 'B1', labelColor: 'rgba(255,255,255,0.15)' })),
      inWall: std(gridTexture({ base: '#565c66', minor: 'rgba(255,255,255,0.04)', major: 'rgba(255,255,255,0.10)' })),
      inLow: std(gridTexture({ base: '#a8581f', major: 'rgba(255,255,255,0.18)', label: 'LOW', labelColor: 'rgba(255,255,255,0.2)' })),
      inHigh: std(gridTexture({ base: '#34587f', major: 'rgba(255,255,255,0.15)', label: 'HIGH', labelColor: 'rgba(255,255,255,0.2)' })),
      roof: std(gridTexture({ base: '#5a5e65' })),
      stripCyan: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x38d8ff, emissiveIntensity: 2.5 }),
      stripRed: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a2a, emissiveIntensity: 2.0 }), // story beats only (Rejects, alarms) and Gym markers
      stripWhite: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xeaf6fa, emissiveIntensity: 2.0 }), // cold white
    };
  }

  // Level skins (level.md `skin`): the grid prototype textures stay where metrics read off them (Gym, Library,
  // Workshop); a "real" scene (arena, Prologue) wears weathered metal (art-style.md). Cover keeps a value split
  // (low cover warmer and darker, high cover cooler and lighter) so heights still read at a glance, and both
  // a painted hue (khaki / grey-green) the blue-grey floor and walls never use, so cover reads as cover.
  #makeSkins() {
    const std = (tex, opts = {}) => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.25, ...opts });
    return {
      weathered: {
        floor: std(panelTexture({ tint: '#5a5f62', grime: 0.8 }), { roughness: 0.7 }),
        wall: std(panelTexture({ tint: '#787f82', grime: 0.6 })),
        low: std(panelTexture({ tint: '#6e6646', grime: 0.7, seams: 'rgba(0,0,0,0.6)' })), // barrier khaki: warm against the cold floor
        high: std(panelTexture({ tint: '#6f8078', grime: 0.5, seams: 'rgba(0,0,0,0.55)' })), // barrier grey-green
        platform: std(panelTexture({ tint: '#666c70', grime: 0.7 })),
        inFloor: std(panelTexture({ tint: '#454a4f', grime: 0.9, label: 'B1' }), { roughness: 0.55 }), // wet, darker
        inWall: std(panelTexture({ tint: '#576066', grime: 0.8 })),
        inLow: std(panelTexture({ tint: '#655d3f', grime: 0.8, seams: 'rgba(0,0,0,0.6)' })),
        inHigh: std(panelTexture({ tint: '#5f7068', grime: 0.7, seams: 'rgba(0,0,0,0.55)' })),
        roof: std(panelTexture({ tint: '#474c52', grime: 0.9 })),
      },
    };
  }

  // Sky: teal-cyan haze over a dark ground, the sun a cold smear through it, heavy fog of the same colour
  // (art-style.md 3: haze #2E6F78, cold white light). Every scene shares it.
  #buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color('#163238') },
        horizon: { value: new THREE.Color(HAZE) },
        ground: { value: new THREE.Color('#263033') },
        sunDir: { value: SUN_DIR },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunDir;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, ground, pow(-h, 0.4));
          float s = max(dot(d, sunDir), 0.0);
          col += vec3(0.85, 0.95, 0.97) * (pow(s, 400.0) * 5.0 + pow(s, 10.0) * 0.3);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.scene.fog = new THREE.Fog(HAZE, 22, 210);
    this.base = { fog: this.scene.fog.color.clone(), horizon: mat.uniforms.horizon.value.clone() };
  }

  #buildLights() {
    const hemi = new THREE.HemisphereLight(0xa6ccce, 0x3a3a36, 1.6); // teal sky fill, dark ground bounce
    this.scene.add(hemi);
    this.hemi = hemi;

    const sun = new THREE.DirectionalLight(0xe4f0f0, 3.0); // cold, softened by the haze
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const s = sun.shadow.camera;
    s.left = -48; s.right = 48; s.top = 48; s.bottom = -48;
    s.near = 1; s.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    this.scene.add(sun, sun.target);
    this.sun = sun;
    Object.assign(this.base, { hemi: hemi.color.clone(), ground: hemi.groundColor.clone(), hemiI: hemi.intensity, sun: sun.color.clone() });
  }

  // Keep the shadow frustum centered on the player.
  updateSun(focus) {
    const snap = 2;
    const fx = Math.round(focus.x / snap) * snap;
    const fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(SUN_DIR, 110);
  }

  // Lighting state (env.alarm): `color` (a CSS colour) fades the haze, fog, hemisphere, sun and the level's point lights toward it
  // (by `strength`, 0..1) with a slow pulse; `null` fades back to the normal look. `instant` skips the fade. Permanent state, not part of a level.
  setAlarm(color, strength = ALARM.strength, instant = false) {
    const a = this.alarm;
    if (color != null) {
      a.color.set(color);
      a.strength = strength;
    }
    a.target = color == null ? 0 : 1;
    if (instant) a.level = a.target;
    this.#applyAlarm(a.t ?? 0);
  }

  #applyAlarm(t) {
    const a = this.alarm;
    const k = a.level * a.strength * (0.85 + 0.15 * Math.sin(t * ALARM.pulse));
    const mix = (c, base) => c.copy(base).lerp(a.color, k);
    mix(this.scene.fog.color, this.base.fog);
    mix(this.sky.material.uniforms.horizon.value, this.base.horizon);
    mix(this.hemi.color, this.base.hemi);
    mix(this.hemi.groundColor, this.base.ground);
    mix(this.sun.color, this.base.sun);
    this.hemi.intensity = this.base.hemiI * (1 - 0.35 * k);
    for (const l of this.lights) if (l.userData.base) mix(l.color, l.userData.base);
  }

  // focus: where the light pool looks from (the camera position, game.js); optional
  update(t, focus) {
    const a = this.alarm;
    const dt = a.t == null ? 0 : Math.min(0.1, Math.max(0, t - a.t));
    a.t = t;
    if (a.level !== a.target || a.level > 0) {
      a.level = a.level < a.target ? Math.min(a.target, a.level + dt * ALARM.rate) : Math.max(a.target, a.level - dt * ALARM.rate);
      this.#applyAlarm(t);
    }
    animateProps(this, t, dt);
    for (const g of this.gates) {
      if (!g.opening || g.open >= 1) continue;
      const k = Math.min(1, g.open + dt / g.time);
      this.#moveGate(g, k);
    }
    for (const f of this.flickerLights) {
      const n = Math.sin(t * 23.0 + f.seed) * Math.sin(t * 7.3 + f.seed * 2.0);
      const off = n > 0.82 || (Math.sin(t * 1.3 + f.seed) > 0.97);
      f.light.intensity = off ? f.base * 0.08 : f.base * (0.85 + 0.15 * Math.sin(t * 40));
      if (f.strip) f.strip.material.emissiveIntensity = off ? 0.2 : 2.0; // the record flickers, live or not, so its strip does too
    }
    this.#updateLights(dt, focus);
  }

  // Hands the pool to the records that matter most from `focus` (the camera; the last focus if none is given) and fades swaps.
  #updateLights(dt, focus) {
    const P = LIGHT_PICK;
    this.lightClock += dt;
    const at = focus ?? this.lightFocus;
    if (this.lightsDirty || this.lightClock >= P.every || at.distanceToSquared(this.lightFocus) > P.move * P.move) this.#pickLights(at);
    const step = dt / P.fade;
    for (const p of this.pool) {
      const s = p.userData;
      let rec = s.rec;
      if (rec && !rec.userData.want) {
        s.k -= step;
        if (s.k <= 0 || this.lightSnap) {
          this.#park(p);
          rec = null;
        }
      } else if (rec) s.k = this.lightSnap ? 1 : Math.min(1, s.k + step);
      if (!rec && this.lightPending > 0) {
        rec = this.lights.find((r) => r.userData.want && !r.userData.slot) ?? null;
        if (rec) {
          s.rec = rec;
          s.k = this.lightSnap ? 1 : 0;
          rec.userData.slot = p;
          this.lightPending--;
        } else this.lightPending = 0;
      }
      if (!rec) continue;
      p.position.copy(rec.position);
      p.color.copy(rec.color); // the alarm tints the record
      p.distance = rec.distance;
      p.intensity = rec.intensity * s.k; // the record's intensity flickers
    }
    this.lightSnap = false;
  }

  // Marks the pool-size best records `want`: pinned first, then by score = power * r^2 / (r^2 + d^2) (r = the light's
  // distance, d = from the focus), x keep for a live one. No sort: pool size passes of max over the records, a reselect only.
  // ponytail: no occlusion, a bright light behind a wall still competes; add a room / zone test if that shows.
  #pickLights(at) {
    const P = LIGHT_PICK;
    this.lightClock = 0;
    this.lightsDirty = false;
    this.lightFocus.copy(at);
    const L = this.lights;
    for (const r of L) {
      const u = r.userData;
      const r2 = r.distance > 0 ? r.distance * r.distance : 1e6; // distance 0 = no cutoff in three
      u.score = u.pin ? Infinity : (u.power * r2 / (r2 + r.position.distanceToSquared(at))) * (u.slot ? P.keep : 1);
      u.want = false;
    }
    let pending = 0;
    for (let i = 0; i < this.pool.length; i++) {
      let best = null;
      for (const r of L) if (!r.userData.want && r.userData.score > 0 && (!best || r.userData.score > best.userData.score)) best = r;
      if (!best) break;
      best.userData.want = true;
      if (!best.userData.slot) pending++;
    }
    this.lightPending = pending;
  }

  #park(p) {
    if (p.userData.rec) p.userData.rec.userData.slot = null;
    p.userData.rec = null;
    p.userData.k = 0;
    p.intensity = 0;
    p.distance = 1;
    p.position.copy(PARKED);
  }

  isInterior(p) {
    const z = this.interiorZones;
    for (let i = 0; i < z.length; i++) if (z[i].containsPoint(p)) return true;
    return false;
  }

  // Static colliders in a Grid, rebuilt lazily when the list changed (box(), despawn(), clear() set `gridDirty`; a
  // length mismatch catches anyone pushing straight to `colliders`). Returns the colliders near the rectangle, in
  // `colliders` order (shared array, valid until the next query).
  nearColliders(x0, z0, x1, z1) {
    if (this.gridDirty || this.grid.n !== this.colliders.length) {
      const g = this.grid;
      g.clear();
      for (const c of this.colliders) g.insert(c, c.box.min.x, c.box.min.z, c.box.max.x, c.box.max.z);
      this.gridDirty = false;
    }
    return this.grid.query(x0, z0, x1, z1);
  }

  // Highest walkable top under (x,z) that is at or below maxY. minSize: ignore boxes narrower than that on either
  // horizontal axis (walls, parapets, posts), for fliers that should keep their height over them.
  groundAt(x, z, maxY, radius = 0, minSize = 0) {
    let g = 0;
    const near = this.nearColliders(x - radius, z - radius, x + radius, z + radius);
    for (let i = 0; i < near.length; i++) {
      const b = near[i].box;
      if (b.max.y > maxY) continue;
      if (minSize > 0 && (b.max.x - b.min.x < minSize || b.max.z - b.min.z < minSize)) continue;
      if (x < b.min.x - radius || x > b.max.x + radius || z < b.min.z - radius || z > b.max.z + radius) continue;
      if (b.max.y > g) g = b.max.y;
    }
    return g;
  }

  // Pushes a standing body (feet at pos.y, radius r, height h) out of every collider it overlaps.
  // Boxes lower than `step` above the feet are stepped over (stairs, curbs).
  collideCircle(pos, r, h, step) {
    const feet = pos.y;
    const top = feet + h;
    for (let iter = 0; iter < 2; iter++) {
      // pad: a push moves the body up to r, so colliders just out of reach at the start can come into range
      const near = this.nearColliders(pos.x - 3 * r, pos.z - 3 * r, pos.x + 3 * r, pos.z + 3 * r);
      for (let i = 0; i < near.length; i++) {
        const b = near[i].box;
        if (b.max.y <= feet + step || b.min.y >= top) continue;
        const cx = Math.max(b.min.x, Math.min(pos.x, b.max.x));
        const cz = Math.max(b.min.z, Math.min(pos.z, b.max.z));
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x += (dx / d) * (r - d);
          pos.z += (dz / d) * (r - d);
        } else {
          // center inside the box: push out on the shallowest axis
          const px0 = pos.x - b.min.x + r;
          const px1 = b.max.x - pos.x + r;
          const pz0 = pos.z - b.min.z + r;
          const pz1 = b.max.z - pos.z + r;
          const m = Math.min(px0, px1, pz0, pz1);
          if (m === px0) pos.x -= px0;
          else if (m === px1) pos.x += px1;
          else if (m === pz0) pos.z -= pz0;
          else pos.z += pz1;
        }
      }
    }
  }

  // Can a body of radius r walk the straight line a -> b (xz) at feet height a.y without touching a box?
  // 2D slab test against every collider in the body's vertical band. Cheap: no raycasts.
  segmentClear(a, b, r, step = 0.45, h = 1.6) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const near = this.nearColliders(Math.min(a.x, b.x) - r, Math.min(a.z, b.z) - r, Math.max(a.x, b.x) + r, Math.max(a.z, b.z) + r);
    for (let i = 0; i < near.length; i++) {
      const bx = near[i].box;
      if (bx.max.y <= a.y + step || bx.min.y >= a.y + h) continue;
      _t0 = 0;
      _t1 = 1;
      if (slab(a.x, dx, bx.min.x - r, bx.max.x + r) && slab(a.z, dz, bx.min.z - r, bx.max.z + r)) return false;
    }
    return true;
  }

  // Box from min corner style args: center x/z, bottom y, size w/h/d.
  box(cx, y, cz, w, h, d, mat, { cover = null, collide = true, shadow = true } = {}) {
    // Walls standing on the ground floor sink 0.3 m into it (mesh only, the collider keeps y): a shadow caster that
    // only touches the floor leaks a thin line of sun at its foot (shadow bias), visible inside closed rooms.
    const sink = shadow && collide && Math.abs(y) < 1e-6 && h >= 1.5 ? 0.3 : 0;
    const geo = new THREE.BoxGeometry(w, h + sink, d);
    const center = new THREE.Vector3(cx, y + (h - sink) / 2, cz);
    applyWorldUVs(geo, center);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(center);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.staticMeshes.push(mesh);
    if (collide) {
      const box = new THREE.Box3(
        new THREE.Vector3(cx - w / 2, y, cz - d / 2),
        new THREE.Vector3(cx + w / 2, y + h, cz + d / 2),
      );
      const col = { box, mesh, cover };
      mesh.userData.collider = col;
      this.colliders.push(col);
      this.gridDirty = true;
      this.meshes.push(mesh);
      if (cover) this.coverMeshes.push(mesh);
    }
    return mesh;
  }

  strip(cx, y, cz, w, h, d, mat) {
    return this.box(cx, y, cz, w, h, d, mat, { collide: false, shadow: false });
  }

  // Adds a light record (not a scene object: the pool shows it while it is among the best, #updateLights). Any number.
  // pin: always live (a tool's light that must show); more pins than the pool is warned and the extras stay dark.
  pointLight(x, y, z, color, intensity, distance, flicker = null, { pin = false } = {}) {
    const l = { isLightRecord: true, position: new THREE.Vector3(x, y, z), color: new THREE.Color(color), intensity, distance, userData: { power: intensity, pin, slot: null, want: false, score: 0 } };
    l.userData.base = l.color.clone(); // the alarm state tints from this
    this.lights.push(l);
    if (flicker) this.flickerLights.push({ light: l, base: intensity, seed: Math.random() * 100, strip: flicker.strip });
    if (pin && this.lights.filter((r) => r.userData.pin).length > this.pool.length) console.warn(`world: more than ${this.pool.length} pinned point lights: the extras stay dark`);
    this.lightsDirty = true;
    return l;
  }

  // Drops a light record; the pool light showing it goes dark at once (a deletion, not a swap).
  releaseLight(l) {
    let i = this.lights.indexOf(l);
    if (i >= 0) this.lights.splice(i, 1);
    i = this.flickerLights.findIndex((f) => f.light === l);
    if (i >= 0) this.flickerLights.splice(i, 1);
    if (l.userData.slot) this.#park(l.userData.slot);
    l.userData.want = false;
    this.lightsDirty = true;
  }

  // Text sign, see env.label. Not merged into the static batches (one texture per sign).
  label(pos, { text, size = 0.6, yaw = 0, flat = false, color = '#ffffff', bg = 'rgba(0,0,0,0.55)' }) {
    const tokens = /\{(\w+)\}/g.test(text);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.userData.label = { text: String(text), tokens, pos, size, flat, color, bg };
    this.#paintLabel(mesh); // throws on an unknown token
    if (flat) mesh.rotation.set(-Math.PI / 2, yaw, 0, 'YXZ');
    else mesh.rotation.y = yaw;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.scene.add(mesh);
    this.labels.push(mesh);
    return mesh;
  }

  // (Re)draws a label's canvas texture and plane for the active scheme (a new texture: the size can change).
  #paintLabel(mesh) {
    const { text, tokens, pos, size, flat, color, bg } = mesh.userData.label;
    const px = 64; // canvas pixels per letter height
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const font = `bold ${px}px monospace`;
    g.font = font;
    const lines = (tokens ? text.replace(/\{(\w+)\}/g, (_, t) => this.inputName(t, this.scheme)) : text).split('\n');
    const pad = px * 0.25;
    c.width = Math.ceil(Math.max(...lines.map((l) => g.measureText(l).width)) + pad * 2);
    c.height = Math.ceil(lines.length * px * 1.15 + pad * 2);
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.font = font;
    g.fillStyle = color;
    g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, pad, pad + i * px * 1.15));
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const k = size / px;
    mesh.geometry.dispose();
    mesh.geometry = new THREE.PlaneGeometry(c.width * k, c.height * k);
    mesh.material.map?.dispose();
    mesh.material.map = tex;
    mesh.material.needsUpdate = true;
    if (flat) mesh.position.set(pos[0], pos[1] + 0.02, pos[2]);
    else mesh.position.set(pos[0], pos[1] + (c.height * k) / 2, pos[2]);
  }

  // Input scheme ('kbm' | 'pad' | 'trackpad', Controls.scheme): repaints the labels with tokens, only when it changed.
  setScheme(scheme) {
    if (scheme === this.scheme) return;
    this.scheme = scheme;
    for (const m of this.labels) {
      if (!m.userData.label.tokens) continue;
      this.#paintLabel(m);
      m.updateMatrix();
    }
  }

  #buildLevel(level, registry) {
    registry.check(level);
    if (level.skin != null && !this.skins[level.skin]) throw new Error(`level: unknown skin "${level.skin}"`);
    this.skin = level.skin ?? null;
    for (const z of level.interiorZones ?? []) this.interiorZones.push(new THREE.Box3(new THREE.Vector3(...z.min), new THREE.Vector3(...z.max)));
    for (const piece of registry.piecesOf(level, 'world')) registry.build('world', this, piece);
  }
}
