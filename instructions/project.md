# Project

Browser third-person sci-fi cover shooter prototype (Mass Effect-like feel). Scope: a training
arena that proves aiming, shooting, cover, enemies and lighting. Prototype art only.

## Stack
- Three.js (`three`), plain ES modules, Vite for dev/build. No framework, no physics engine.
- Everything procedural: geometry, textures (canvas), audio (WebAudio). No binary assets yet.

## Commands
- `npm run dev` — dev server on :5173
- `npm run build` — must pass before committing
- `npm run build:artifact` — single-file page in `dist/artifact/cerberus.html` (game inlined, three.js from jsDelivr via import map). Run it after `npm run build` (vite empties `dist/`). Published as a claude.ai Artifact: https://claude.ai/artifact/2dVW5ms3KtVJpkC6ap5fAL — republish the same file to update it.
- No pointer lock (sandboxed frames): input falls back to free-mouse mode; arrow keys also turn the camera.

## Testing
- `?debug` URL flag: no start panel, stats readout on, `window.game` is the `Game` (`player`, `camRig`, `weapon`,
  `enemies`, `controls`, `engine` with `scene`, `input`, `events`, `timings`, `perf`).
- Headless check: Playwright with Chromium (`--use-angle=swiftshader`); real keyboard/mouse events work once the
  start button is clicked (pointer lock). SwiftShader runs at 3-15 fps and frames are clamped to 0.1 s,
  so count frames, not milliseconds.
- Headless stepping: `engine.headless = true` skips the render phase (the scene's world matrices are still
  updated, so raycasts and hitboxes stay correct). Every browser suite except `render` (draw calls, LOD) uses it:
  the whole set runs in ~40 s instead of ~40 min on SwiftShader. Only render where a test checks pixels.
- `npm test`: pure-math unit tests (`tests/ballistics.test.mjs`).
- `tests/gunplay.browser.mjs`: deterministic gunplay checks in Chromium (first-shot accuracy, recoil pattern
  and recovery, crosshair states, hit registration). Needs `npm run dev` and Playwright.
- `tests/render.browser.mjs`: draw-call budget and batching invariants (same setup).
- `tests/enemies.browser.mjs`: destroyed puppets stay destroyed, shooters engage only within range, troopers.
- `tests/boss.browser.mjs`: spider mech (wake, lock-on camera, attacks, arena bounds, armor, legs, core).
- `tests/animation.browser.mjs`: planted feet don't slide at walk / jog / sprint / strafe / backpedal.
- `tests/gamepad.browser.mjs`: controller with a simulated standard gamepad (`navigator.getGamepads` replaced
  by an init script; set `window.__pad.axes` / `.buttons`).
- Key presses in tests: add the code to `engine.input.keys` and `engine.input.pressed` (edges come from events).
- Fault injection: `game.engine.add({ name: 'bad', update() { throw 1 } })` must get disabled while the game runs on.
