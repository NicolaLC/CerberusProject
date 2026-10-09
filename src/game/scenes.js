import arena from '../levels/arena.json';
import gym from '../levels/gym.json';
import library from '../levels/library.json';
import workshop from '../levels/workshop.json';

// Scene list: name -> level file. `?scene=<name>` opens one directly, `game.loadScene(name)` switches at runtime
// (instructions/level.md). Add a scene: put the level file in src/levels/ and list it here.
export const SCENES = { arena, gym, library, workshop };
export const DEFAULT_SCENE = 'arena';

// Valid scene name for `name` (null / undefined / '' = default). Unknown names warn and fall back to the default.
export function resolveScene(name) {
  if (name == null || name === '') return DEFAULT_SCENE;
  if (Object.hasOwn(SCENES, name)) return name;
  console.warn(`scene "${name}" is unknown (${Object.keys(SCENES).join(', ')}): using "${DEFAULT_SCENE}"`);
  return DEFAULT_SCENE;
}
