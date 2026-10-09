# Credits

Third-party assets and code shipped with Cerberus. Everything else (geometry, textures, audio, code) is
original and procedural. Keep this file in sync whenever an external asset or library is added, replaced or removed.

## Fonts

| Font | Use | Designer | Files | Licence |
|---|---|---|---|---|
| Direction | main UI font (HUD labels, menus) | Brandsemut — https://brandsemut.com | `src/fonts/direction.otf` | **Demo: personal use only, no commercial use.** Under evaluation; commercial licence: https://brandsemut.com/product/direction/ |
| Space Nova | numbers (ammo, damage numbers, counters) | Maknastudio — https://maknastudio.com | `src/fonts/space-nova.otf` | **Freeware, non-commercial: personal use only.** Under evaluation; commercial licence: https://maknastudio.com/product/space-nova/ |

Source pages: https://www.fontspace.com/direction-font-f139984, https://www.fontspace.com/space-nova-font-f130563.
Both are demo licences: see `before-shipping.md` before any release.

## Libraries

| Library | Version | Use | Licence |
|---|---|---|---|
| three.js | 0.180.0 | 3D rendering | MIT, © 2010-2025 three.js authors |
| Electron | 44.7.0 | desktop app shell | MIT, © Electron contributors (bundles Chromium; electron-builder ships its licence files) |

Build tools (Vite, esbuild, electron-builder) are not shipped in the game.
