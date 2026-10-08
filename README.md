# Cerberus

Sci-fi third-person cover shooter prototype for the browser (Three.js + Vite).
A training arena with prototype grid textures, a bright sunlit yard, a dark interior
and puppet enemies to shoot.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
npm run build:artifact  # single-file page for hosting (dist/artifact/)
```

Click **Deploy** to lock the mouse. Add `?debug` to the URL to skip the start panel, show the
performance readout and expose `window.game` for testing.

## Controls

| Input | Action |
| --- | --- |
| WASD | move |
| Mouse | look |
| Shift | sprint |
| RMB | hold to aim (pops up from low cover, peeks from high cover edges); trackpad mode: E toggles |
| LMB / F | fire |
| R | reload |
| Space | take / leave cover — with W behind low cover: vault |
| Q | swap shoulder |
| 1 / 2 / 3, wheel | switch gun (assault rifle / machine gun / sniper rifle) |

Controllers work too (standard layout): sticks move/look, LT aim, RT fire, X reload, A cover, LB shoulder,
Y/RB next gun, d-pad picks a gun, L3 sprint, Menu pause.
| H | show skeletons |
| F3 | performance stats |

## What's in

- Over-the-shoulder camera with collision, aim zoom and shoulder swap
- Hitscan rifle with spread, bloom, recoil, tracers, impacts and headshots
- Cover system: snap to cover, slide along it, low cover crouch / pop-up, high cover edge peek, vault
- Shields + health with regen, directional damage indicator
- Shared humanoid bone rig with placeholder dummy parts and procedural animation (arm IK on weapon grips)
- Puppet enemies on posts: static, rail movers and pop-up shooters (engage within 30 m); they break apart and stay down until reload
- Sniper rifle: semi-auto, scoped zoom, pin-point when aimed
- Spider mech miniboss: armored hull, break its legs at the glowing knees to bring it down, then shoot the exposed core
- Drones: hovering quad-rotors that circle you and fire short bursts; shoot the glowing core underneath
- Wall cover: building and arena walls work as high cover with peeking at their ends
- Troopers: armed soldiers that spot you, run to cover that blocks your line of fire, pop up or peek to shoot, and relocate when flanked
- Sunlit yard with shadows, dark interior with skylight, flickering lights and eye adaptation
- Post-processing: bloom, color grade, vignette, chromatic aberration, film grain
- Game feel: trauma camera shake, smoothed follow, FOV punch, recoil recovery, hitstop on kills, shell casings, shockwaves

## Architecture

`src/engine/` is a game-agnostic runtime: phased system scheduler with substepped simulation, per-system
fault isolation, event bus, action-mapped input, object pools and dynamic resolution to hold 60 fps.
`src/game/` is the shooter built on it; `src/game/game.js` wires every system and declares the frame order.

Project docs for contributors and agents live in [`instructions/`](instructions/), indexed by [`CLAUDE.md`](CLAUDE.md).

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE).
