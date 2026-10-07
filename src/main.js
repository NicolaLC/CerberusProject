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
import { Post } from './post.js';
import { Juice } from './juice.js';

const DEBUG = new URLSearchParams(location.search).has('debug');

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
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
const fx = new FX(scene, camera, world);
const hud = new Hud();
const post = new Post(renderer, scene, camera);
const juice = new Juice({ camRig, post, fx });
player.juice = juice;
const enemies = new Enemies({ scene, world, fx, audio, juice });
const weapon = new Weapon({ camera, rig: camRig, player, world, enemies, fx, hud, audio, juice });

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
function setRunning(r) {
  running = r;
  overlay.style.display = running ? 'none' : 'flex';
  canvas.style.cursor = input.free && running ? 'crosshair' : '';
}
document.addEventListener('pointerlockchange', () => setRunning(input.locked || input.free || DEBUG));
addEventListener('keydown', (e) => {
  // Esc pauses in free-mouse mode (pointer lock handles it otherwise)
  if (e.code === 'Escape' && input.free && running) {
    input.free = false;
    setRunning(false);
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let time = 0;

function frame() {
  requestAnimationFrame(frame);
  const realDt = Math.min(clock.getDelta(), 0.05);
  if (realDt <= 0) return;
  if (!running) {
    camRig.update(realDt, player);
    post.render(realDt, { player, inside: world.isInterior(camera.position) });
    input.endFrame();
    return;
  }
  const dt = realDt * juice.update(realDt); // hitstop / slow-mo
  time += dt;

  // arrow keys turn too (handy when the mouse can't be locked)
  const turnX = (input.down('ArrowRight') ? 1 : 0) - (input.down('ArrowLeft') ? 1 : 0);
  const turnY = (input.down('ArrowDown') ? 1 : 0) - (input.down('ArrowUp') ? 1 : 0);
  camRig.look(input.mouse.dx + turnX * 900 * realDt, input.mouse.dy + turnY * 500 * realDt, player.aiming);
  if (input.wasPressed('KeyQ')) camRig.shoulder *= -1;
  if (input.wasPressed('KeyH')) helpers.forEach((h) => (h.visible = !h.visible));

  player.update(dt, input, camRig, weapon);
  if (player.dead && player.deadTime > 3) player.respawn();
  camRig.update(dt, player, realDt);
  weapon.update(dt, input);
  enemies.update(dt, player, hud, camRig);
  fx.update(dt);
  world.update(time);
  world.updateSun(player.pos);
  hud.update(dt, { player, weapon, enemies, camRig, world });

  const inside = world.isInterior(camera.position);
  const target = inside ? 1.7 : 1.0;
  exposure += (target - exposure) * (1 - Math.exp(-dt * 1.2));
  renderer.toneMappingExposure = exposure;

  // hide the player model when the camera is pushed into it
  player.root.visible = camera.position.distanceTo(camRig.pivot) > 0.45;

  post.render(realDt, { player, inside });
  input.endFrame();
}
frame();

if (DEBUG) window.game = { scene, camera, camRig, player, weapon, enemies, world, input, renderer, post, juice };
