# Credits

Third-party assets and code shipped with Cerberus. Everything else (geometry, textures, audio, code) is
original and procedural. Keep this file in sync whenever an external asset or library is added, replaced or removed.

## Fonts

| Font | Use | Designer | Files | Licence |
|---|---|---|---|---|
| Chakra Petch | main UI font (HUD labels, menus) | Cadson Demak (Chakra Petch Project Authors) — https://github.com/m4rc1e/Chakra-Petch | `src/fonts/chakra-petch-500.woff2`, `chakra-petch-700.woff2` (latin subset, via Fontsource) | SIL Open Font License 1.1, text in `public/licenses/chakra-petch-OFL.txt` (copied into every build). Free for commercial use; the licence must ship with the font. |
| Space Nova | numbers (ammo, damage numbers, counters) | Maknastudio — https://maknastudio.com | `src/fonts/space-nova.otf` | **Freeware, non-commercial: personal use only.** Under evaluation; commercial licence: https://maknastudio.com/product/space-nova/ |

Space Nova source: https://www.fontspace.com/space-nova-font-f130563 (demo licence: see `before-shipping.md`).

## Libraries

| Library | Version | Use | Licence |
|---|---|---|---|
| three.js | 0.180.0 | 3D rendering | MIT, © 2010-2025 three.js authors |
| Electron | 44.7.0 | desktop app shell | MIT, © Electron contributors (bundles Chromium; electron-builder ships its licence files) |

Build tools (Vite, esbuild, electron-builder) are not shipped in the game.
