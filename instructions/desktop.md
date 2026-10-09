# Desktop (Electron)

The desktop app is the same Vite build (`dist/`) inside Electron, which bundles its own Chromium: the
renderer, gamepad, pointer lock and audio behave exactly as in the Chromium the tests run on.

## Why Electron (decided 2026-10)
- Tauri 2 uses the OS webview: WebView2 on Windows is fine, but WKWebView on macOS caps rAF at 60 fps
  (macOS 13–15) with reported frame-pacing jitter, and WebKitGTK on Linux / Steam Deck can silently fall
  back to slow WebGL paths. Raw mouse input (`unadjustedMovement`) is Chromium-only.
- Tauri 3 adds a bundled-Chromium (CEF) runtime; it was alpha when this was decided. Revisit when it is
  stable if a Rust backend is wanted; the game code doesn't change.
- Electron and electron-builder are MIT (compatible with the proprietary license). Steam later:
  `steamworks.js` (MIT).

## Files
- `desktop/main.js` (ESM main process):
  - serves `dist/` from `app://game/` (fixed origin, so localStorage settings persist; path traversal refused)
  - fullscreen window, F11 / Alt+Enter toggle, no menu bar (macOS keeps the app menu for Cmd+Q)
  - no background throttling (`backgroundThrottling: false`, renderer backgrounding and timer throttling
    switches off), discrete GPU on dual-GPU Macs (`force_high_performance_gpu`)
  - no navigation, no popups, single instance
  - `--debug`: windowed, `?debug`, DevTools
- `desktop/preload.cjs`: `window.cerberusDesktop` = `{ platform, quit(), toggleFullscreen() }`; the start
  panel shows QUIT TO DESKTOP only when it exists. Context isolation and sandbox stay on.

## Commands
- `npm run desktop` — build and run (`npm run desktop -- --debug` for DevTools).
- `npm run desktop:dist` — installers in `release/`: Windows NSIS, macOS dmg, Linux AppImage
  (pass `--win`, `--mac`, `--linux` to pick; a macOS build needs a Mac).
- The app archive holds only `dist/` (minus `dist/artifact`) and `desktop/`: three.js is bundled by Vite, so
  `node_modules` is excluded (~0.7 MB archive; installer ~125 MB, mostly Chromium).

## Releases (GitHub)
- `.github/workflows/release.yml` runs on a pushed commit whose message contains `[release]`, a pushed tag
  `v<version>` (must equal package.json `version`) or a manual run; it tags the commit `v<version>`:
  web job (tests, `dist/` zip + single-file page), desktop matrix (ubuntu → AppImage, windows → NSIS exe,
  macos → universal dmg), then a GitHub prerelease with `RELEASE_NOTES.md` as the body.
- To cut one: bump `version` in package.json, rewrite RELEASE_NOTES.md, commit with `[release]` in the message,
  push. (Claude cloud sessions can't push tags: the git proxy refuses them, so use `[release]`.)
- File names: `Cerberus-<version>-<os>-<arch>.<ext>` (electron-builder `artifactName`).
- Builds are unsigned (`mac.identity: null`, `CSC_IDENTITY_AUTO_DISCOVERY=false`).

## Not done yet
- App icon (default Electron icon), code signing (Windows certificate, Apple Developer ID + notarization),
  Steam integration.

## Testing
- Headless: `xvfb-run -a` + Playwright `_electron.launch({ executablePath: 'node_modules/electron/dist/electron',
  args: ['--no-sandbox', '--use-angle=swiftshader', '.'] })`. In this cloud container the Electron postinstall
  download is cut by the proxy: fetch the zip with curl, verify it against `node_modules/electron/checksums.json`,
  unzip into `node_modules/electron/dist` and write `electron` to `node_modules/electron/path.txt`; package with
  `-c.electronDist=node_modules/electron/dist`.
