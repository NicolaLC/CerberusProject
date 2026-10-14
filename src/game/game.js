import * as THREE from 'three';
import { Engine } from '../engine/engine.js';
import { Registry } from './registry.js';
import { World, WORLD_PIECES } from './world/world.js';
import { Pickups, PICKUP_PIECES } from './world/pickups.js';
import { Mission } from './world/mission.js';
import { RunStats } from './run-stats.js';
import { Encounter, ENCOUNTER_PIECES, levelSpawn } from './world/encounter.js';
import { Player } from './actors/player.js';
import { Enemies, ENEMY_PIECES } from './actors/enemies.js';
import { Weapon } from './combat/weapon.js';
import { GUN_ORDER } from './combat/guns.js';
import { CameraRig } from './view/camera.js';
import { FX } from './view/fx.js';
import { Hud } from './view/hud.js';
import { Log } from './view/log.js';
import { Boot } from './view/boot.js';
import { Cinematic } from './view/cinematic.js';
import { Summary } from './view/summary.js';
import { Audio } from './view/audio.js';
import { Post } from './view/post.js';
import { Juice } from './view/juice.js';
import { Controls, inputName } from './controls.js';
import { settings } from './settings.js';
import { Shell } from './view/shell.js';
import { applyQuality, QUALITY } from './view/quality.js';
import { SCENES, resolveScene, saveProgress } from './scenes.js';
import { TOOLS } from './gym/tools.js';
import { KeyHints } from './view/keyhints.js';
import { disposeTree } from '../engine/dispose.js';

// Composition root: builds every game system on top of the engine, wires events and declares the
// frame order. This is the only file that knows about all systems; they only know their direct
// dependencies (constructor args) and the event bus.
const RESPAWN_AFTER = 3; // s
const BOSS_FOCUS_RANGE = 40; // m: an awake boss this close keeps the camera on it
// Puppet LOD by distance to the camera, with hysteresis (switch at `far`, back at `near`) so nothing flickers
// at the edge. Detail: one draw with baked colors instead of one per material. Shadow: stop casting (a few
// pixels at that range; the sun's shadow map is centered on the player anyway).
const LOD = {
  detail: { far: 32, near: 28 },
  shadow: { far: 34, near: 30 },
};
const beyond = (d2, on, band) => d2 > (on ? band.near : band.far) ** 2;

export class Game {
  // scene: name from scenes.js (`?scene=`); unknown or missing = the default arena.
  constructor({ canvas, debug = false, scene: sceneName = null }) {
    const engine = (this.engine = new Engine({ canvas, fov: 70 }));
    const { scene, camera, events, renderer, input } = engine;
    this.debug = debug;

    // ---- level + piece registry: every system builds its part of the level from data ----
    const registry = new Registry({ guns: GUN_ORDER }).register('world', WORLD_PIECES).register('enemies', ENEMY_PIECES).register('pickups', PICKUP_PIECES).register('encounter', ENCOUNTER_PIECES);
    this.registry = registry;
    const first = resolveScene(sceneName);

    // ---- systems ----
    const world = new World(scene, { lights: QUALITY[settings.quality]?.lights, inputName });
    // upload every permanent level texture now (grids and skins): a scene's first visit has no upload hitch, and GPU memory
    // doesn't depend on which scenes were visited (scenes.browser.mjs compares it exactly)
    for (const tex of world.permanentTextures()) renderer.initTexture(tex);
    const controls = new Controls(input, settings);
    const camRig = new CameraRig(camera, world);
    const player = new Player({ scene, world, events, spawn: levelSpawn(registry.check(SCENES[first])) });
    const enemies = new Enemies({ scene, world, events, registry });
    const pickups = new Pickups({ scene, events, registry, world });
    const mission = new Mission({ events, enemies, owns: (gun) => weapon.owned.has(gun) });
    const encounter = new Encounter({ scene, events, registry, enemies, world, mission });
    const weapon = new Weapon({ camera, rig: camRig, player, world, enemies, events });
    const fx = new FX(scene, camera, world).listen(events);
    const hud = new Hud().listen(events, camRig);
    const log = new Log().listen(events);
    const audio = new Audio(weapon, camera, world, enemies).listen(events);
    const post = new Post(renderer, scene, camera, events);
    const boot = new Boot({ controls, post, camRig }).listen(events);
    const cinematic = new Cinematic({ camRig, controls, post, player }).listen(events);
    // No HUD while the intro plays: from the cinematic until control returns (the boot it hands over to, or its own end).
    const hudEl = document.getElementById('hud');
    const hideHud = (on) => hudEl.classList.toggle('cine', on);
    // a mid-level cut hides the HUD but the log, so its HiveMind broadcast reads over the shots (inline: the stylesheet's .cine hides all)
    const hideHudCut = (on) => { for (const el of hudEl.children) if (el.id !== 'log') el.style.visibility = on ? 'hidden' : ''; };
    events.on('cinematic:start', (e) => {
      enemies.holdFire = true; // nobody fires while the camera is scripted
      if (e.cut) hideHudCut(true);
      else hideHud(true);
    });
    events.on('cinematic:done', (e) => {
      enemies.holdFire = false;
      if (e?.cut) hideHudCut(false);
      else queueMicrotask(() => !boot.active && hideHud(false));
    });
    events.on('intro:done', () => hideHud(false));
    applyQuality(settings.quality, { engine, post, world });
    const juice = new Juice({ camRig, post, fx }).listen(events);
    const stats = new RunStats().listen(events);
    // the mission complete screen: it frees the pointer for its button, and RESTART reloads the scene (or restarts the Workshop's play)
    const summary = new Summary({
      stats,
      juice,
      controls,
      title: () => this.level?.title ?? this.sceneName ?? '',
      release: () => {
        this.padPlay = true; // keep running without the lock
        if (input.locked) document.exitPointerLock();
      },
      restart: () => {
        if (this.tool?.playing) this.tool.restart();
        else this.loadScene(this.sceneName);
        this.padPlay = false;
        input.lock();
      },
    }).listen(events);
    events.on('puppet:down', (p) => {
      pickups.drop(p.pos);
      if (p.dropGun) pickups.dropGun(p.pos, p.dropGun, weapon.owned); // enemy params dropGun / dropAmmo / dropOnce
    });
    events.on('mission:grant', ({ gun, ammo }) => {
      weapon.grant(gun, { ammo }); // emits weapon:discovered the first time (toast, discovered:<gun> log line)
      weapon.switchTo(gun);
    });
    events.on('checkpoint:reached', (c) => {
      hud.toast('CHECKPOINT');
      saveProgress(this.sceneName, c.id); // campaign scenes only
    });
    // env.alarm: the lighting state (the siren is Audio's)
    events.on('alarm:on', (a) => world.setAlarm(a.color, a.strength));
    events.on('alarm:off', (a) => !a.active && world.setAlarm(null));
    events.on('alarm:clear', () => world.setAlarm(null, undefined, true));
    // controller rumble (only while the pad is the device in use)
    events.on('weapon:shot', (s) => {
      const big = s.gun === 'sniper' || s.beam;
      input.rumble(big ? 0.7 : s.heavy ? 0.3 : 0.12, big ? 0.5 : 0.35, big ? 140 : 50);
    });
    events.on('player:hurt', () => input.rumble(0.6, 0.5, 180));
    events.on('player:jet', () => input.rumble(0.2, 0.3, 90));
    fx.player = player; // jet flame follows the nozzle while thrusting
    events.on('blast', (b) => {
      const near = Math.max(0, 1 - b.point.distanceTo(player.pos) / (b.radius * 4));
      if (near > 0) input.rumble(near, near * 0.6, 260);
    });
    events.on('boss:step', (st) => {
      const near = Math.max(0, 1 - st.point.distanceTo(player.pos) / 14);
      if (near > 0) input.rumble(near * 0.35, 0, 70);
    });
    // a gate closing behind the player (kit.gate closeOn) waits while an enemy stands in it
    world.blocked = (box) => {
      for (const e of enemies.all) if (e.alive && box.distanceToPoint(e.pos) < 1.2) return true;
      return false;
    };
    addEventListener('pointerdown', () => audio.init()); // resumes audio started from a controller
    Object.assign(this, { world, controls, camRig, player, enemies, pickups, encounter, mission, weapon, fx, hud, log, boot, cinematic, audio, post, juice, stats, summary, settings });

    // skeleton debug overlay (H): the player's helper is permanent, the enemies' come and go with the level
    this.skeletons = false;
    this.playerHelper = this.#helper(player.view.rigModel);
    this.helpers = [];
    this.keyHints = new KeyHints();
    if (debug) this.loadScene(first); // the main menu has no level behind it: NEW GAME / CONTINUE / DEVELOPMENT load one

    // ---- frame order ----
    const look = { x: 0, y: 0 };
    const assistTargets = [];
    engine.add({
      name: 'controls',
      phase: 'pre',
      whilePaused: true,
      update: (realDt) => {
        controls.update();
        this.shell.update();
        engine.timeScale = juice.update(realDt); // hitstop / slow motion
        if (engine.paused) return;
        // aim assist (friction + gentle pull) while aiming, stronger on a trackpad or a controller
        let friction = 1;
        const assisted = settings.trackpad || controls.pad;
        if (player.aiming && settings.aimAssist) friction = camRig.assist(realDt * engine.timeScale, assistTargets, enemies.aimPoints(assistTargets), assisted ? 1.6 : 0.8, assisted);
        controls.look(realDt, look);
        const k = settings.sensitivity * friction;
        camRig.look(look.x * k, look.y * k, player.aiming);
        if (controls.pressed('shoulder')) camRig.shoulder *= -1;
        if (controls.pressed('skeleton')) this.#toggleSkeletons();
      },
    });
    engine.add({
      name: 'stats',
      phase: 'pre',
      whilePaused: true,
      update: () => {
        if (controls.pressed('stats')) engine.stats.visible = !engine.stats.visible;
      },
    });
    // The Workshop editor owns input and the camera: it switches the engine to mode 'edit', so the 'play' group (player,
    // weapon, pickups, encounter, camera rig) stands still. Systems that do something else while editing (world) branch inside.
    engine.add({
      name: 'player',
      group: 'play',
      update: (dt) => {
        player.update(dt, controls, camRig, weapon);
        if (player.dead && player.deadTime > RESPAWN_AFTER) player.respawn(encounter.checkpoint); // the last checkpoint reached, else the spawn
      },
    });
    engine.add({ name: 'weapon', group: 'play', update: (dt) => weapon.update(dt, controls) });
    engine.add({ name: 'runStats', group: 'play', update: (dt) => !boot.active && !cinematic.active && stats.update(dt) }); // the intro (cinematic, boot) is not play time
    engine.add({ name: 'enemies', update: (dt) => enemies.update(dt, player) });
    engine.add({ name: 'playerPose', phase: 'late', group: 'play', update: () => player.view.pose() });
    engine.add({ name: 'enemyAnim', phase: 'late', update: (dt) => enemies.animate(dt, camera) });
    engine.add({ name: 'encounter', group: 'play', update: (dt) => encounter.update(dt, player, controls.pressed('interact')) });
    engine.add({ name: 'pickups', group: 'play', update: (dt) => pickups.update(dt, player, weapon) });
    // intro cinematic: drives camRig.script before the camera runs; skip = a fire / jump / interact press (only a skippable piece)
    engine.add({
      name: 'cinematic',
      phase: 'late',
      group: 'play',
      update: (dt) => cinematic.update(dt, cinematic.active && (controls.actions.pressed('fire') || controls.actions.pressed('jump') || controls.actions.pressed('interact'))),
    });
    // boss lock-on: an engaged boss within range stays framed (CameraRig.focus)
    const bossFocus = new THREE.Vector3();
    engine.add({
      name: 'camera',
      phase: 'late',
      group: 'play',
      whilePaused: true,
      update: (dt) => {
        const b = enemies.boss;
        const engaged = b && b.alive && b.awake && !player.dead && b.pos.distanceTo(player.pos) < BOSS_FOCUS_RANGE;
        camRig.focus = engaged ? b.focusPoint(bossFocus) : null;
        camRig.update(dt, player, engine.realDt);
      },
    });
    // the Gym room's tool, if the level has one (gym/tools.js)
    engine.add({ name: 'gymTool', phase: 'late', update: (dt) => this.tool?.update(dt) });
    engine.add({ name: 'aimProbe', phase: 'late', update: () => weapon.probe() });
    engine.add({ name: 'fx', phase: 'present', update: (dt) => fx.update(dt) });
    engine.add({
      name: 'world',
      phase: 'present',
      update: () => {
        world.update(engine.time, camera.position); // the light pool picks the lights nearest the camera
        world.setScheme(controls.scheme);
        world.updateSun(this.editing ? camera.position : player.pos); // the editor's shadow window follows its camera
        world.cull(camera, player.pos, this.editing); // sectored levels: draw / build the rooms the camera can see into (sectors.js)
        enemies.cull(); // dormant enemies in rooms out of sight are not drawn
        // hide the player model when the camera is pushed into it or held at the eye (the boot intro's POV hold)
        player.view.root.visible = !this.editing && (!!camRig.script || (camRig.povW < camRig.t.pov.hide && camera.position.distanceTo(camRig.pivot) > 0.45));
      },
    });
    engine.add({
      name: 'lod',
      phase: 'present',
      update: () => {
        const cam = camera.position;
        for (const p of enemies.all) {
          const s = p.skin;
          const d2 = p.pos.distanceToSquared(cam);
          const far = beyond(d2, s.far, LOD.detail);
          if (far !== s.far) s.setFar(far);
          const cast = !beyond(d2, !s.castShadow, LOD.shadow);
          if (cast !== s.castShadow) s.setCastShadow(cast);
        }
      },
    });
    engine.add({
      name: 'hud',
      phase: 'present',
      update: (dt) => {
        hud.update(dt, { player, weapon, enemies, camRig, world, mission, scheme: controls.scheme, pin: !boot.active && !cinematic.active });
      },
    });
    engine.add({ name: 'log', phase: 'present', update: (dt) => log.update(dt) });
    // boot intro: scaled time (pause freezes it); skip = a fire / jump / interact press (pad A is jump)
    engine.add({
      name: 'boot',
      phase: 'present',
      group: 'play',
      update: (dt) => boot.update(dt, boot.active && (controls.actions.pressed('fire') || controls.actions.pressed('jump') || controls.actions.pressed('interact'))),
    });
    // mission complete screen: real time (the game is in slow motion behind it); a pad A press restarts, keys are its own listener
    engine.add({ name: 'summary', phase: 'present', update: (dt, e) => summary.update(e.realDt, summary.open && controls.pressed('restart')) });
    engine.add({
      name: 'audio',
      phase: 'present',
      whilePaused: true, // silences the MG whine and swaps the combat music for the menu track on pause
      update: () => {
        audio.spin(weapon.t.spinUp > 0 && !engine.paused ? weapon.spin : 0);
        audio.mood(engine.paused);
      },
    });
    engine.add({
      name: 'post',
      phase: 'render',
      whilePaused: true,
      update: (realDt) => post.render(realDt, { player, inside: world.isInterior(camera.position) }),
    });
    engine.events.on('engine:systemFailed', ({ name }) => hud.toast(`SYSTEM FAULT: ${name.toUpperCase()}`));

    this.shell = new Shell({ engine, audio, controls, debug, systems: this, editing: () => this.editing, sceneName: () => this.sceneName, loadScene: (k) => this.loadScene(k), unloadScene: () => this.unloadScene() });
    if (debug) engine.stats.visible = true;
  }

  // ---- scenes: one level at a time; every per-level system loads from and unloads to its level file ----

  // Switches to another scene (a key of scenes.js; unknown names warn and open the default). Call it between
  // frames (a test, the console, a menu), never from inside a system update. The old level is freed completely
  // (instructions/architecture.md: every per-level system must be disposable), the player is put at the new spawn
  // with full health, the camera and weapon are reset. A malformed level file throws and leaves the old scene up.
  loadScene(name) {
    const key = resolveScene(name);
    const level = this.registry.check(SCENES[key]);
    if (level.tool && !TOOLS[level.tool]) throw new Error(`level "${key}": unknown tool "${level.tool}"`); // before anything is unloaded
    const { world, enemies, pickups, encounter } = this;
    if (this.sceneName) this.#unloadLevel();
    this.sceneName = key;
    this.level = level;
    this.shell?.markScene(); // not built yet during the constructor's first load
    world.load(level, this.registry);
    enemies.load(level);
    pickups.load(level);
    for (const it of pickups.items) for (const o of [it.model, it.ring]) world.sectors.tag(o); // drawn with their sector
    encounter.load(level);
    this.resetRun(level);
    this.tool = level.tool ? new TOOLS[level.tool](this, level) : null;
    this.keyHints.set({ debug: this.debug, tool: this.tool });
    this.rebuildHelpers();
    this.#warmShaders();
    return this;
  }

  // Frees the current level (QUIT TO MAIN MENU): no scene is loaded until the next loadScene. Systems never update meanwhile
  // (the main menu idles the engine).
  unloadScene() {
    if (!this.sceneName) return this;
    this.#unloadLevel();
    this.sceneName = null;
    this.level = null;
    this.shell?.markScene();
    return this;
  }

  // Compiles the programs first used mid-fight (pooled fx sit invisible, rigs draw their far LOD only at range) now, at
  // the load, so they don't hitch the first time: everything hidden is shown, compiled, hidden again; rigs go far and back.
  // Synchronous. Debris shares the far LOD material (parts.js), so it is covered. Skipped when headless (nothing is drawn).
  #warmShaders() {
    const { engine, enemies } = this;
    if (engine.headless) return;
    const hidden = [];
    engine.scene.traverse((o) => {
      if (!o.visible) hidden.push(o);
    });
    for (const o of hidden) o.visible = true;
    const warm = this.world.sectors.active ? this.world.warmMeshes() : []; // every permanent world material: a sector built later compiles nothing
    for (const m of warm) engine.scene.add(m);
    const skins = enemies.all.map((e) => e.skin).filter(Boolean);
    const far = skins.map((k) => k.far);
    for (const k of skins) k.setFar(true);
    engine.renderer.compile(engine.scene, engine.camera);
    skins.forEach((k, i) => k.setFar(far[i]));
    for (const o of hidden) o.visible = false;
    for (const m of warm) m.removeFromParent();
    warm[0]?.geometry.dispose();
  }

  // Player at the level's spawn with full health, camera / weapon / fx / hud / juice reset: the start of a run on
  // the level the systems were just loaded with (loadScene, and the Workshop's play in place).
  // `spawn` defaults to the level's own (levelSpawn: a `marker.spawn` piece, else `level.spawn`).
  resetRun(level, spawn = levelSpawn(level)) {
    const { player, camRig, weapon, fx, hud, log, boot, cinematic, juice, stats, summary } = this;
    player.place(spawn);
    camRig.reset(player.facing);
    weapon.reset(level.loadout);
    fx.reset();
    hud.reset(level);
    log.reset();
    boot.reset();
    cinematic.reset();
    this.enemies.holdFire = false;
    const hudEl = document.getElementById('hud');
    hudEl.classList.remove('cine');
    for (const el of hudEl.children) el.style.visibility = ''; // a cut cut short by a reload
    juice.reset();
    stats.reset();
    summary.reset();
  }

  // Skeleton debug helpers of the enemies that exist now (H shows them); dropHelpers frees them (before the enemies go).
  rebuildHelpers() {
    this.dropHelpers();
    this.helpers = this.enemies.all.filter((p) => p.rig).map((p) => this.#helper(p.rig));
  }

  dropHelpers() {
    for (const h of this.helpers) disposeTree(h);
    this.helpers.length = 0;
  }

  // True while the Workshop editor is editing (it sets engine mode 'edit'; not while it plays in place).
  get editing() {
    return this.engine.mode === 'edit';
  }

  #unloadLevel() {
    if (this.editing) this.padPlay = false; // it ran without pointer lock (start button)
    this.tool?.dispose();
    this.tool = null;
    this.dropHelpers();
    this.encounter.unload();
    this.enemies.unload();
    this.pickups.unload();
    this.world.unload();
  }

  #helper(rig) {
    const h = rig.helper();
    h.visible = this.skeletons;
    this.engine.scene.add(h);
    return h;
  }

  #toggleSkeletons() {
    this.skeletons = !this.skeletons;
    for (const h of [this.playerHelper, ...this.helpers]) h.visible = this.skeletons;
  }

  // the shell owns the pad-play flag and the run / pause switch; the Workshop editor drives them through the game
  get padPlay() {
    return this.shell.padPlay;
  }

  set padPlay(v) {
    this.shell.padPlay = v;
  }

  setRunning(running) {
    this.shell.setRunning(running);
  }

  start() {
    this.engine.start();
    return this;
  }
}
