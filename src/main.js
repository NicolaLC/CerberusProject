import * as THREE from 'three';
import { World } from './world.js';
import { Input } from './input.js';
import { CameraRig } from './camera.js';
import { Player } from './player.js';
import { Weapon } from './weapon.js';
import { Enemies } from './enemies.js';
import { FX } from './fx.js';
import { Hud } from './hud.js';
import { Audio } from './audio.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 2000);

const world = new World(scene);
const input = new Input(canvas);
const camRig = new CameraRig(camera, world);
const player = new Player(scene, world);
const audio = new Audio();
const fx = new FX(scene, camera);
const hud = new Hud();
const enemies = new Enemies({ scene, world, fx, audio });
const weapon = new Weapon({ camera, rig: camRig, player, world, enemies, fx, hud, audio });

// skeleton debug (H)
const helpers = [player.rigModel, ...enemies.puppets.map((p) => p.rig)].map((r) => r.helper());
helpers.forEach((h) => {
  h.visible = false;
  scene.add(h);
});

// exposure adaptation: eyes open up indoors, clamp down in the sun
let exposure = 1.0;

let running = DEBUG;
const overlay = document.getElementById('overlay');
if (DEBUG) overlay.style.display = 'none';
document.getElementById('start').addEventListener('click', () => {
  audio.init();
  input.lock();
});
document.addEventListener('pointerlockchange', () => {
  running = input.locked || DEBUG;
  overlay.style.display = running ? 'none' : 'flex';
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let time = 0;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (dt <= 0) return;
  if (!running) {
    camRig.update(dt, player);
    renderer.render(scene, camera);
    input.endFrame();
    return;
  }
  time += dt;

  camRig.look(input.mouse.dx, input.mouse.dy, player.aiming);
  if (input.wasPressed('KeyQ')) camRig.shoulder *= -1;
  if (input.wasPressed('KeyH')) helpers.forEach((h) => (h.visible = !h.visible));

  player.update(dt, input, camRig, weapon);
  if (player.dead && player.deadTime > 3) player.respawn();
  camRig.update(dt, player);
  weapon.update(dt, input);
  enemies.update(dt, player, hud, camRig);
  fx.update(dt);
  world.update(time);
  world.updateSun(player.pos);
  hud.update(dt, { player, weapon, enemies, camRig, world });

  const inside = world.isInterior(camera.position);
  const target = inside ? 1.45 : 1.0;
  exposure += (target - exposure) * (1 - Math.exp(-dt * 1.2));
  renderer.toneMappingExposure = exposure;

  // hide the player model when the camera is pushed into it
  player.root.visible = camera.position.distanceTo(camRig.pivot) > 0.45;

  renderer.render(scene, camera);
  input.endFrame();
}
frame();

if (DEBUG) window.game = { scene, camera, camRig, player, weapon, enemies, world, input, renderer };
