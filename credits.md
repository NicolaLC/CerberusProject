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
| Player footstep, walking | `src/assets/sfx/step-walk-1.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Player footstep on raised surfaces | `src/assets/sfx/step-metal-1.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Robot footstep (troopers, puppets) | `src/assets/sfx/step-robot-1.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Player footstep, walking (takes 2-4) | `src/assets/sfx/step-walk-2.mp3`, `src/assets/sfx/step-walk-3.mp3`, `src/assets/sfx/step-walk-4.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Player footstep on raised surfaces (takes 2-4) | `src/assets/sfx/step-metal-2.mp3`, `src/assets/sfx/step-metal-3.mp3`, `src/assets/sfx/step-metal-4.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Robot footstep (takes 2-4) | `src/assets/sfx/step-robot-2.mp3`, `src/assets/sfx/step-robot-3.mp3`, `src/assets/sfx/step-robot-4.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Hit confirm, body | `src/assets/sfx/hit-body.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Hit confirm, headshot | `src/assets/sfx/hit-head.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Hit confirm, weak spot | `src/assets/sfx/hit-weak.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Kill confirm | `src/assets/sfx/kill.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Low magazine tick | `src/assets/sfx/low-mag.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Good active reload | `src/assets/sfx/reload-good.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Jetpack burst | `src/assets/sfx/jet.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Landing | `src/assets/sfx/land.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Player hurt (shield hit) | `src/assets/sfx/hurt.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Ammo pickup | `src/assets/sfx/pickup.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Ammo pickup while full | `src/assets/sfx/pickup-full.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Enemy plasma bolt shot | `src/assets/sfx/enemy-shot.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Enemy bolt impact | `src/assets/sfx/bolt-impact.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Robot destroyed | `src/assets/sfx/robot-down.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Explosion (drone, mortar) | `src/assets/sfx/explosion.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Drone hover (loop) | `src/assets/sfx/drone-loop.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Alarm siren (loop) | `src/assets/sfx/alarm-siren.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech wake | `src/assets/sfx/boss-wake.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech cannon charge | `src/assets/sfx/boss-charge.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech rear-up | `src/assets/sfx/boss-stomp.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech step | `src/assets/sfx/boss-step.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech stomp slam | `src/assets/sfx/boss-slam.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech mortar launch | `src/assets/sfx/boss-mortar.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech leg shot off | `src/assets/sfx/boss-leg.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech destroyed | `src/assets/sfx/boss-death.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Spider mech engine (loop) | `src/assets/sfx/boss-loop.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Prologue power surge | `src/assets/sfx/wake-surge.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| STEM-00 core ignites | `src/assets/sfx/wake-core.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| STEM-00 rises | `src/assets/sfx/wake-rise.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Maintenance arm folds (not wired yet) | `src/assets/sfx/arm-retract.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Blast door opens | `src/assets/sfx/gate-open.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Objective done | `src/assets/sfx/objective-done.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| New objective | `src/assets/sfx/objective-new.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Weapon discovered | `src/assets/sfx/gun-discovered.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Mission complete | `src/assets/sfx/mission-complete.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Calibration bay hum (loop, not wired yet) | `src/assets/sfx/bay-hum-loop.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Diagnostic console (loop, not wired yet) | `src/assets/sfx/console-loop.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Facility ambience (loop) | `src/assets/sfx/ambient-loop.mp3` | generated with ElevenLabs Sound Effects by the project owner | per the ElevenLabs plan used (commercial use needs a paid plan: see `before-shipping.md`) |
| Combat music (sci-fi drum and bass, loop) | `src/assets/sfx/combat-music.mp3` | generated with ElevenLabs Music (eleven_music_v2_5) by the project owner | per the ElevenLabs plan used (commercial use of generated music needs a paid plan: see `before-shipping.md`) |
| Boss music (SX-6 Tarantula fight, drum and bass, loop) | `src/assets/sfx/boss-music.mp3` | generated with ElevenLabs Music (eleven_music_v2_5) by the project owner | per the ElevenLabs plan used (commercial use of generated music needs a paid plan: see `before-shipping.md`) |

## Libraries

| Library | Version | Use | Licence |
|---|---|---|---|
| three.js | 0.180.0 | 3D rendering | MIT, © 2010-2025 three.js authors |
| Electron | 44.7.0 | desktop app shell | MIT, © Electron contributors (bundles Chromium; electron-builder ships its licence files) |

Build tools (Vite, esbuild, electron-builder) are not shipped in the game.
