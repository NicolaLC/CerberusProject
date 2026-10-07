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
- `?debug` URL flag: no pointer lock, `window.game` exposes `{ player, camRig, weapon, enemies, world, input, ... }`.
- Headless check: Playwright with Chromium (`--use-angle=swiftshader`), drive `game.input.keys` /
  `game.input.pressed` / `game.input.mouse` between `requestAnimationFrame`s and screenshot.
  SwiftShader runs at ~6 fps and `dt` is clamped to 0.05, so count frames, not milliseconds.
