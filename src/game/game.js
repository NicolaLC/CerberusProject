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

// Composition root: builds every game system on top of the engine, wires events and declares the
// frame order. This is the only file that knows about all systems; they only know their direct
// dependencies (constructor args) and the event bus.
const RESPAWN_AFTER = 3; // s

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
    const juice = new Juice({ camRig, post, fx }).listen(events);
    events.on('puppet:down', (p) => pickups.drop(p.pos));
    Object.assign(this, { world, controls, camRig, player, enemies, pickups, weapon, fx, hud, audio, post, juice });

    // skeleton debug overlay (H)
    const helpers = [player.rigModel, ...enemies.puppets.map((p) => p.rig)].map((r) => r.helper());
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
        engine.timeScale = juice.update(realDt); // hitstop / slow motion
        if (engine.paused) return;
        // aim assist (friction + gentle pull) while aiming, stronger in trackpad mode
        let friction = 1;
        if (player.aiming && settings.aimAssist) friction = camRig.assist(realDt * engine.timeScale, enemies.aimPoints(assistTargets), settings.trackpad ? 1.6 : 0.8);
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
    engine.add({ name: 'camera', phase: 'late', whilePaused: true, update: (dt) => camRig.update(dt, player, engine.realDt) });
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
      name: 'hud',
      phase: 'present',
      update: (dt) => {
        hud.aimLabel = controls.aimLabel;
        hud.update(dt, { player, weapon, enemies, camRig, world });
      },
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
    bindSettingsUI();
    const setRunning = (running) => {
      engine.paused = !running;
      overlay.style.display = running ? 'none' : 'flex';
      canvas.style.cursor = input.free && running ? 'crosshair' : '';
    };
    setRunning(this.debug);
    document.getElementById('start').addEventListener('click', () => {
      audio.init();
      input.lock();
    });
    document.addEventListener('pointerlockchange', () => setRunning(input.locked || input.free || this.debug));
    addEventListener('keydown', (e) => {
      // Esc pauses in free-mouse mode (pointer lock handles it otherwise)
      if (e.code === 'Escape' && input.free && !engine.paused) {
        input.free = false;
        setRunning(false);
      }
    });
  }

  start() {
    this.engine.start();
    return this;
  }
}
