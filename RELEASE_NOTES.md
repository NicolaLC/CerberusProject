# Cerberus 0.0.2 — Linux packages

New: `.deb` and `.tar.gz` Linux builds that don't need FUSE (the AppImage does). Same game as 0.0.1.

Third-person sci-fi cover shooter prototype: one training arena with puppets, troopers, drones and a spider-mech boss.

## Downloads
| Platform | File | Notes |
|---|---|---|
| Windows 10/11 (x64) | `Cerberus-0.0.2-win-x64.exe` | Installer. Unsigned: SmartScreen shows "Windows protected your PC" → More info → Run anyway. |
| macOS 11+ (Apple silicon and Intel) | `Cerberus-0.0.2-mac-universal.dmg` | Unsigned: first launch with right-click → Open (or System Settings → Privacy & Security → Open Anyway). |
| Linux: Ubuntu / Debian (x64) — **recommended** | `Cerberus-0.0.2-linux-amd64.deb` | `sudo apt install ./Cerberus-0.0.2-linux-amd64.deb`, then start "Cerberus" from the app menu or run `cerberus`. Sets up the sandbox and AppArmor profile (Ubuntu 24.04+). |
| Linux: any distro (x64) | `Cerberus-0.0.2-linux-x64.tar.gz` | `tar xzf` it, then run `./Cerberus-0.0.2-linux-x64/cerberus`. No FUSE needed. On Ubuntu 24.04+ run `./cerberus --no-sandbox`. |
| Linux: AppImage (x64) | `Cerberus-0.0.2-linux-x86_64.AppImage` | `chmod +x` it, then run. Needs FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04, `libfuse2` on 22.04); without it: `--appimage-extract`, then `./squashfs-root/AppRun`. On Ubuntu 24.04+ add `--no-sandbox`. |
| Web | `Cerberus-0.0.2-web.zip` | Static site: serve the folder with any web server (opening index.html from disk is blocked by browsers). |
| Web, single file | `Cerberus-0.0.2-web-single-file.html` | Open in Chrome/Edge/Firefox; needs internet (three.js from jsDelivr). |

## What's in it
- Cover shooting: snap to cover, peek and pop up, vault (jump over thin cover, slide over deep cover), shoulder swap.
- Six guns: assault rifle, machine gun, sniper (scope), 3-round burst rifle, charged railgun (pierces), pistol. Active reload.
- Keyboard + mouse, trackpad mode, controller (Xbox / PlayStation layouts, rumble).
- Desktop app: fullscreen (F11 / Alt+Enter), raw mouse input, no throttling when unfocused, Quit to desktop.
- Graphics presets: Low / High / Ultra (supersampling, MSAA, bloom, shadow resolution, texture filtering).

## Known limits
- Prototype art: everything is procedural; default app icon.
- Builds are not code-signed yet.
