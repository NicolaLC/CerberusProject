import * as THREE from 'three';
import { Engine } from '../engine/engine.js';
import { World } from './world/world.js';
import { Pickups } from './world/pickups.js';
import { Player } from './actors/player.js';
import { Enemies } from './actors/enemies.js';
import { Weapon } from './combat/weapon.js';
import { CameraRig } from './view/camera.js';
import { FX } from './view/fx.js';
import { Hud } from './view/hud.js';
import { Audio } from './view/audio.js';
import { Post } from './view/post.js';
import { Juice } from './view/juice.js';
import { Controls } from './controls.js';
import { settings, bindSettingsUI } from './settings.js';
import { applyQuality } from './view/quality.js';

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
  constructor({ canvas, debug = false }) {
    const engine = (this.engine = new Engine({ canvas, fov: 70 }));
    const { scene, camera, events, renderer, input } = engine;
    this.debug = debug;

    // ---- systems ----
    const world = new World(scene);
    const controls = new Controls(input);
    const camRig = new CameraRig(camera, world);
    const player = new Player({ scene, world, events });
    const enemies = new Enemies({ scene, world, events });
    const pickups = new Pickups({ scene, events });
    const weapon = new Weapon({ camera, rig: camRig, player, world, enemies, events });
    const fx = new FX(scene, camera, world).listen(events);
    const hud = new Hud().listen(events, camRig);
    const audio = new Audio().listen(events);
    const post = new Post(renderer, scene, camera, events);
    applyQuality(settings.quality, { engine, post, world });
    const juice = new Juice({ camRig, post, fx }).listen(events);
    events.on('puppet:down', (p) => pickups.drop(p.pos));
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
    addEventListener('pointerdown', () => audio.init()); // resumes audio started from a controller
    Object.assign(this, { world, controls, camRig, player, enemies, pickups, weapon, fx, hud, audio, post, juice, settings });

    // skeleton debug overlay (H)
    const helpers = [player.rigModel, ...enemies.puppets.filter((p) => p.rig).map((p) => p.rig)].map((r) => r.helper());
    for (const h of helpers) {
      h.visible = false;
      scene.add(h);
    }

    // ---- frame order ----
    const look = { x: 0, y: 0 };
    const assistTargets = [];
    engine.add({
      name: 'controls',
      phase: 'pre',
      whilePaused: true,
      update: (realDt) => {
        controls.update();
        this.#padShell();
        engine.timeScale = juice.update(realDt); // hitstop / slow motion
        if (engine.paused) return;
        // aim assist (friction + gentle pull) while aiming, stronger on a trackpad or a controller
        let friction = 1;
        const assisted = settings.trackpad || controls.pad;
        if (player.aiming && settings.aimAssist) friction = camRig.assist(realDt * engine.timeScale, enemies.aimPoints(assistTargets), assisted ? 1.6 : 0.8, assisted);
        controls.look(realDt, look);
        const k = settings.sensitivity * friction;
        camRig.look(look.x * k, look.y * k, player.aiming);
        if (controls.pressed('shoulder')) camRig.shoulder *= -1;
        if (controls.pressed('skeleton')) for (const h of helpers) h.visible = !h.visible;
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
    engine.add({
      name: 'player',
      update: (dt) => {
        player.update(dt, controls, camRig, weapon);
        if (player.dead && player.deadTime > RESPAWN_AFTER) player.respawn();
      },
    });
    engine.add({ name: 'weapon', update: (dt) => weapon.update(dt, controls) });
    engine.add({ name: 'enemies', update: (dt) => enemies.update(dt, player) });
    engine.add({ name: 'pickups', update: (dt) => pickups.update(dt, player, weapon) });
    // boss lock-on: an engaged boss within range stays framed (CameraRig.focus)
    const bossFocus = new THREE.Vector3();
    engine.add({
      name: 'camera',
      phase: 'late',
      whilePaused: true,
      update: (dt) => {
        const b = enemies.boss;
        const engaged = b && b.alive && b.awake && !player.dead && b.pos.distanceTo(player.pos) < BOSS_FOCUS_RANGE;
        camRig.focus = engaged ? b.focusPoint(bossFocus) : null;
        camRig.update(dt, player, engine.realDt);
      },
    });
    engine.add({ name: 'aimProbe', phase: 'late', update: () => weapon.probe() });
    engine.add({ name: 'fx', phase: 'present', update: (dt) => fx.update(dt) });
    engine.add({
      name: 'world',
      phase: 'present',
      update: () => {
        world.update(engine.time);
        world.updateSun(player.pos);
        // hide the player model when the camera is pushed into it
        player.root.visible = camera.position.distanceTo(camRig.pivot) > 0.45;
      },
    });
    engine.add({
      name: 'lod',
      phase: 'present',
      update: () => {
        const cam = camera.position;
        for (const p of enemies.puppets) {
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
        hud.update(dt, { player, weapon, enemies, camRig, world });
      },
    });
    engine.add({
      name: 'audio',
      phase: 'present',
      whilePaused: true, // silences the MG whine on pause
      update: () => audio.spin(weapon.t.spinUp > 0 && !engine.paused ? weapon.spin : 0),
    });
    engine.add({
      name: 'post',
      phase: 'render',
      whilePaused: true,
      update: (realDt) => post.render(realDt, { player, inside: world.isInterior(camera.position) }),
    });
    engine.events.on('engine:systemFailed', ({ name }) => hud.toast(`SYSTEM FAULT: ${name.toUpperCase()}`));

    this.#bindShell();
    if (debug) engine.stats.visible = true;
  }

  // Start / pause overlay and pointer lock.
  #bindShell() {
    const { engine, audio } = this;
    const { input, canvas } = engine;
    const overlay = document.getElementById('overlay');
    bindSettingsUI({ onQuality: (q) => applyQuality(q, this) });
    const setRunning = (running) => {
      engine.paused = !running;
      overlay.style.display = running ? 'none' : 'flex';
      canvas.style.cursor = input.free && running ? 'crosshair' : '';
    };
    this.setRunning = setRunning;
    this.padPlay = false; // started from a controller: runs without pointer lock
    setRunning(this.debug);
    document.getElementById('start').addEventListener('click', () => {
      audio.init();
      input.lock();
    });
    // desktop build (desktop/preload.cjs): quit button in the panel
    const desktop = window.cerberusDesktop;
    const quit = document.getElementById('quit');
    quit.hidden = !desktop;
    quit.addEventListener('click', () => desktop?.quit());
    document.addEventListener('pointerlockchange', () => setRunning(input.locked || input.free || this.padPlay || this.debug));
    addEventListener('keydown', (e) => {
      // Esc pauses in free-mouse mode (pointer lock handles it otherwise)
      if (e.code === 'Escape' && input.free && !engine.paused) {
        input.free = false;
        setRunning(false);
      }
    });
  }

  // Controller: A / Menu deploys from the start panel, Menu pauses; the panel shows the connected pad.
  #padShell() {
    const { engine, controls, audio } = this;
    const input = engine.input;
    if (engine.paused) {
      const status = input.pad.connected ? `Controller: ${input.pad.id.replace(/\s*\(.*$/, '').slice(0, 40)} ✓` : 'Controller: press any button to connect.';
      if (this.padStatus !== status) document.getElementById('pad-status').textContent = this.padStatus = status;
      if (controls.pressed('pause') || (input.device === 'pad' && input.wasPressed('Pad0'))) {
        audio.init();
        this.padPlay = true;
        this.setRunning(true);
      }
    } else if (controls.pressed('pause')) {
      this.padPlay = false;
      if (input.locked) document.exitPointerLock();
      input.free = false;
      this.setRunning(false);
    }
  }

  start() {
    this.engine.start();
    return this;
  }
}
