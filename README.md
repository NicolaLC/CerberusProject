# Cerberus

Sci-fi third-person cover shooter prototype for the browser (Three.js + Vite).
A training arena with prototype grid textures, a bright sunlit yard, a dark interior
and puppet enemies to shoot.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static build in dist/
```

Click **Deploy** to lock the mouse. Add `?debug` to the URL to run without pointer lock
(exposes `window.game` for testing).

## Controls

| Input | Action |
| --- | --- |
| WASD / Shift | move / sprint |
| Mouse | look |
| RMB | aim (pops up from low cover, peeks from high cover edges) |
| LMB | fire |
| R | reload |
| Space | take / leave cover — with W behind low cover: vault |
| Q | swap shoulder |
| H | show skeletons |

## What's in

- Over-the-shoulder camera with collision, aim zoom and shoulder swap
- Hitscan rifle with spread, bloom, recoil, tracers, impacts and headshots
- Cover system: snap to cover, slide along it, low cover crouch / pop-up, high cover edge peek, vault
- Shields + health with regen, directional damage indicator
- Shared humanoid bone rig with placeholder dummy parts and procedural animation (arm IK on weapon grips)
- Puppet enemies on posts: static, rail movers and pop-up shooters; they break apart and respawn
- Sunlit yard with shadows, dark interior with skylight, flickering lights and eye adaptation

Project docs for contributors and agents live in [`instructions/`](instructions/), indexed by [`CLAUDE.md`](CLAUDE.md).

## License

Proprietary — all rights reserved. See [LICENSE](LICENSE).
