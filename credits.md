# Credits

Third-party assets and code shipped with Cerberus. Everything else (geometry, textures, audio, code) is
original and procedural. Keep this file in sync whenever an external asset or library is added, replaced or removed.

## Fonts

| Font | Use | Designer | Files | Licence |
|---|---|---|---|---|
| Chakra Petch | main UI font (HUD labels, menus) | Cadson Demak (Chakra Petch Project Authors) — https://github.com/m4rc1e/Chakra-Petch | `src/fonts/chakra-petch-500.woff2`, `chakra-petch-700.woff2` (latin subset, via Fontsource) | SIL Open Font License 1.1, text in `public/licenses/chakra-petch-OFL.txt` (copied into every build). Free for commercial use; the licence must ship with the font. |
| Space Nova | numbers (ammo, damage numbers, counters) | Maknastudio — https://maknastudio.com | `src/fonts/space-nova.otf` | **Freeware, non-commercial: personal use only.** Under evaluation; commercial licence: https://maknastudio.com/product/space-nova/ |

Space Nova source: https://www.fontspace.com/space-nova-font-f130563 (demo licence: see `before-shipping.md`).

## Sounds

Most sounds are synthesized at runtime (`src/game/view/audio.js`). Recorded samples:

| Sound | File | Source | Licence |
|---|---|---|---|
| Assault rifle (KR-7 Warden) single shot | `src/assets/sfx/ar-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Machine gun (KM-90 Bulwark) shot | `src/assets/sfx/mg-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Machine gun barrel spin (loop) | `src/assets/sfx/mg-spin.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Sniper (KS-5 Farsight) shot | `src/assets/sfx/sniper-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Sniper bolt cycle | `src/assets/sfx/sniper-bolt.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Burst rifle (KB-3 Tribune) shot | `src/assets/sfx/burst-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Railgun (KX-9 Halberd) charge | `src/assets/sfx/rail-charge.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Railgun shot | `src/assets/sfx/rail-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Pistol (KP-12 Ember) shot | `src/assets/sfx/pistol-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Reload (all guns but the MG) | `src/assets/sfx/reload-rifle.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Machine gun reload | `src/assets/sfx/reload-mg.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Perfect reload | `src/assets/sfx/reload-perfect.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Reload jam | `src/assets/sfx/reload-jam.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Dry fire | `src/assets/sfx/dry-fire.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Weapon switch | `src/assets/sfx/switch.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |

## Libraries

| Library | Version | Use | Licence |
|---|---|---|---|
| three.js | 0.180.0 | 3D rendering | MIT, © 2010-2025 three.js authors |
| Electron | 44.7.0 | desktop app shell | MIT, © Electron contributors (bundles Chromium; electron-builder ships its licence files) |

Build tools (Vite, esbuild, electron-builder) are not shipped in the game.
