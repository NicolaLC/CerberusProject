# Project

Browser third-person sci-fi cover shooter prototype (Mass Effect-like feel). Scope: a training
arena that proves aiming, shooting, cover, enemies and lighting. Prototype art only.

## Stack
- Three.js (`three`), plain ES modules, Vite for dev/build. No framework, no physics engine.
- Everything procedural: geometry, textures (canvas), audio (WebAudio, plus recorded samples in `src/assets/sfx/` that
  replace a synth sound once decoded: `SAMPLES` in audio.js). Other binary assets: two UI fonts in `src/fonts/`
  (Chakra Petch, OFL; Space Nova, demo licence under evaluation: `credits.md`, `before-shipping.md`), set as `--font-main` / `--font-num` in `src/style.css`.

## Commands
Package manager: **bun** (`bun install`, `bun.lock`; no npm, no `package-lock.json`). The scripts and tests themselves still
run on Node (`node tests/...`, `node:module` hooks), bun only installs and launches them. `bun run test` runs our suites;
plain `bun test` is bun's own test runner and finds nothing.
- `bun run dev` — dev server on :5173
- `bun run build` — must pass before committing
- `bun run build:artifact` — single-file page in `dist/artifact/cerberus.html` (game inlined, three.js from jsDelivr via import map). Run it after `bun run build` (vite empties `dist/`). Published as a claude.ai Artifact: https://claude.ai/artifact/2dVW5ms3KtVJpkC6ap5fAL — republish the same file to update it.
- `bun run desktop` / `bun run desktop:dist` — Electron desktop build, see `instructions/desktop.md`.
- Releases: a merge to `main` that bumps package.json `version` (or a pushed commit with `[release]` in its message, or a `v<version>` tag) → GitHub Actions builds web + Windows/macOS/Linux (`instructions/desktop.md`).
- Vite `base: './'`: the web build runs from any folder or sub-path.
- Pointer lock asks for raw mouse input (`unadjustedMovement`, no OS acceleration), falls back to plain lock.
- No pointer lock (sandboxed frames): input falls back to free-mouse mode; arrow keys also turn the camera.

## Testing
- `?debug` URL flag: no main menu, stats readout on, `window.game` is the `Game` (`player`, `camRig`, `weapon`,
  `enemies`, `controls`, `engine` with `scene`, `input`, `events`, `timings`, `perf`; `loadScene(name)`, `sceneName`).
- `?scene=<name>` URL flag: opens `prologue` (default: a new game starts the Prologue) / `arena` / `gym` / `library` / `workshop` directly; unknown name → prologue + console warning (`instructions/level.md`).
- Headless check: Playwright with Chromium (`--use-angle=swiftshader`); real keyboard/mouse events work once the
  start button is clicked (pointer lock). SwiftShader runs at 3-15 fps and frames are clamped to 0.1 s,
  so count frames, not milliseconds.
- Headless stepping: `engine.headless = true` skips the render phase (the scene's world matrices are still
  updated, so raycasts and hitboxes stay correct). Every browser suite except `render` (draw calls, LOD) uses it:
  the whole set runs in ~40 s instead of ~40 min on SwiftShader. Only render where a test checks pixels.
- `bun run test`: pure-math unit tests (`tests/ballistics.test.mjs`, `tests/levelio.test.mjs`).
- `bun run test:browser` (`tests/run-browser.mjs`): starts a vite dev server on a free port, sets `URL`, runs every
  `tests/*.browser.mjs` in parallel (one browser each, `-j N` or `BROWSER_JOBS`, default cores - 1; output printed per suite
  with its time) and exits non-zero on a non-zero exit or any `FAIL` line. `gym-stress` and `bench` are skipped (slow);
  `--all` adds them, run alone after the rest. One run per machine (lock file in the OS temp dir): a second run, from
  another agent or worktree, waits. While working, run only the suites the change touches (`node tests/run-browser.mjs boss
  animation`, seconds to a minute each); the full set once at the end (CI runs it on every push anyway). Names filter: `node tests/run-browser.mjs scenes render`. Suites must not
  share state outside their own browser (no files, no fixed ports) so they can run side by side.
- CI (`.github/workflows/ci.yml`, every push and PR): `bun install --frozen-lockfile`, Playwright Chromium, `bun run test`, `bun run build`,
  `bun run test:browser`. The release workflow's web job runs the same browser suites before packaging.
- `tests/gunplay.browser.mjs`: deterministic gunplay checks in Chromium (first-shot accuracy, recoil pattern
  and recovery, crosshair states, hit registration). Needs `bun run dev` and Playwright.
- `tests/render.browser.mjs`: draw-call budget and batching invariants (same setup).
- `tests/enemies.browser.mjs`: destroyed puppets stay destroyed, shooters engage only within range, troopers.
- `tests/boss.browser.mjs`: spider mech (wake, lock-on camera, attacks, arena bounds, armor, legs, core).
- `tests/animation.browser.mjs`: planted feet don't slide at walk / jog / sprint / strafe / backpedal.
- `tests/movement.browser.mjs`: automatic cover (enter, along-wall, exits, cooldown), jetpack burst, jump onto low cover, vault, ceiling.
- `tests/gamepad.browser.mjs`: controller with a simulated standard gamepad (`navigator.getGamepads` replaced
  by an init script; set `window.__pad.axes` / `.buttons`).
- `tests/scenes.browser.mjs`: every scene opens via `?scene=`; arena → every other scene (the four Gym rooms, library, workshop, prologue) → arena for 3 cycles in one page:
  player at the spawn, enemy / pickup counts match the level file, boss bar / lock-on / kills / weapon reset, HUD zone title per scene, the Library's demo enemies
  never fire or wake (10 s in range), the panel's scene buttons, no console errors, and no leaks
  (`renderer.info.memory.geometries` / `textures` and scene object count identical after every cycle, exact, no tolerance). The probe also shows all six player gun models for its draw (the raised gun is the only one that uploads otherwise, and the Prologue raises the pistol).
  This suite RENDERS (info.memory counts uploads) and, before each reading, draws once with culling off and both LOD variants,
  because three uploads lazily and the counts would otherwise follow what the camera happens to see.
- `tests/art.browser.mjs`: art-style readability rules (art-style.md): weak spots brighter than every other enemy glow at rest,
  enemy glows violet / magenta only, STEM-00's amber only and `setCore`, arena `weathered` skin vs Library grids, no red arena light.
- `scripts/screenshots.mjs <outDir> [names]`: the fixed art-review screenshot set (20 angles, canvas only, no HUD), for before / after.
- `tests/loadout.browser.mjs`: owned guns (#91): a pistol-only `loadout` (keys, wheel, pad, HUD ∞ and slots), `pickup.gun` discovery (event once, switch, toast, then ammo), no `loadout` = all six, bad ids fail validation; uses `?scene=workshop`.
- `tests/prologue-warden.browser.mjs`: the Prologue weapon discovery (#93): armoury rack, skip and trooper drop, pause before the troopers.
- `tests/log.browser.mjs`: STEM-00 log lines (#40): `log.line` on start / trigger / objective done / discovered, once, delay, priority queue, entries, validation; uses `?scene=workshop`.
- `tests/intro.browser.mjs`: boot intro (#13): `intro.boot` overlay and input lock, `intro:done`, `log.line` on `intro:done`, skip only once seen, pause, restart / edit, validation; uses `?scene=workshop`.
- `tests/prologue.browser.mjs`: the Prologue level (`?scene=prologue`): boot overlay, input lock, `intro:done` within 12 s, first log line and objective, pistol only (HUD ∞), skip only with the seen flag, passive yard, dormant `purge-*` groups.
- `tests/prologue-exit.browser.mjs`: the Prologue's end (#15): exit gate shut then open, the exit needs the Warden, mission complete screen with real stats, RESTART, checkpoint respawn.
- `tests/mission.browser.mjs`: mission framework (objective pieces, full mission in play, order, reinforcements, trigger reach, limit, restart / edit / scene switch, bad params); uses `?scene=workshop`.
- `tests/gym-traversal|gym-range|gym-ai|gym-stress.browser.mjs`: the Gym rooms as fixtures (instructions/gym.md); they
  also print the measured metrics (metrics.md 8b). gym-stress takes several minutes under SwiftShader.
- Semi-auto guns (sniper, railgun, pistol) in tests need a fire press edge: `engine.input.pressed.add('Mouse0')`.
- Key presses in tests: add the code to `engine.input.keys` and `engine.input.pressed` (edges come from events).
- Fault injection: `game.engine.add({ name: 'bad', update() { throw 1 } })` must get disabled while the game runs on.
