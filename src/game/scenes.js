import arena from '../levels/arena.json';
import gym from '../levels/gym.json';
import gymRange from '../levels/gym-range.json';
import gymAi from '../levels/gym-ai.json';
import gymStress from '../levels/gym-stress.json';
import library from '../levels/library.json';
import workshop from '../levels/workshop.json';
import prologue from '../levels/prologue.json';
import underworks from '../levels/underworks.json';
import { loadJSON, saveJSON } from '../engine/storage.js';

// Scene list: name -> level file. `?scene=<name>` opens one directly, `game.loadScene(name)` switches at runtime
// (instructions/level.md). Add a scene: put the level file in src/levels/ and list it here.
// The Gym is four rooms (Gym epic #58): gym = traversal and cover, then weapon range, enemy rooms, stress test.
export const SCENES = { arena, gym, 'gym-range': gymRange, 'gym-ai': gymAi, 'gym-stress': gymStress, library, workshop, prologue, underworks };
export const DEFAULT_SCENE = 'prologue'; // a new game opens the Prologue (#13); the arena is `?scene=arena`

// Valid scene name for `name` (null / undefined / '' = default). Unknown names warn and fall back to the default.
export function resolveScene(name) {
  if (name == null || name === '') return DEFAULT_SCENE;
  if (Object.hasOwn(SCENES, name)) return name;
  console.warn(`scene "${name}" is unknown (${Object.keys(SCENES).join(', ')}): using "${DEFAULT_SCENE}"`);
  return DEFAULT_SCENE;
}

// Campaign: the missions of a new game, in order (`NEW GAME` opens the first): the first scene and every scene its `next` field chains to
// (level.md "Level chaining"). Only these write progress; a chained load (`Game` on `mission:complete`) records the scene it enters.
const chain = (first) => {
  const out = [];
  for (let s = first; s && Object.hasOwn(SCENES, s) && !out.includes(s); s = SCENES[s].next) out.push(s);
  return out;
};
export const CAMPAIGN = chain(DEFAULT_SCENE);

// Progress (main menu CONTINUE): the campaign scene played last and the last checkpoint reached there.
// ponytail: CONTINUE restarts the scene; the checkpoint is kept for a later mid-mission resume (mission state is not saved).
const PROGRESS = 'cerberus.progress';
export function loadProgress() {
  const p = loadJSON(PROGRESS, null);
  return p && CAMPAIGN.includes(p.scene) ? p : null;
}
export const saveProgress = (scene, checkpoint = null) => CAMPAIGN.includes(scene) && saveJSON(PROGRESS, { scene, checkpoint });
export const clearProgress = () => saveJSON(PROGRESS, null);
