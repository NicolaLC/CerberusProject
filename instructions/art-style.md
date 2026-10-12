# Art style (rule)

Target: **grim industrial military sci-fi.** Machines are heavy, used and built for war; the world is cold, hazy
and monumental. It should look like a war machine photographed in a hangar, never like a toy. This rule applies
to everything visual: concept art, the book, marketing, and the final in-game art pass.

Reference: the owner's concept "yellow walker in a teal hangar" (October 2026): a saucer-hulled walker on
jointed hydraulic legs, twin-barrel side guns, worn yellow paint, a cluster of violet sensor lights, teal fog,
a dark hangar with stacked crates, and the player's olive rifle in the lower-left foreground. The image is not
in the repo (origin and licence unconfirmed); add it under `instructions/art/` once cleared.

## 1. Keep from the reference
- **Function-first silhouettes.** Every part does a visible job: pistons, actuators, cable bundles, vents, gun
  mounts, sensor bands. If a shape has no purpose, cut it.
- **Livery is paint, not light.** HiveMind war units wear matte industrial ochre paint, chipped at the edges down
  to dark metal, with panel seams and small stencilled serials.
- **Sensors are the only saturated light on an enemy:** a cluster of small violet-magenta lenses set in a dark band.
- **Cold, hazy world:** teal-cyan volumetric fog, dark interiors, cold strip lights, wet floors reflecting the
  glow, crates and infrastructure that give a sense of scale.
- **Camera low and close to the ground**, the player's weapon in the foreground, and the enemy towering above it.
- **Painterly realism:** real materials, rim light through fog, no outlines and no cel shading.

## 2. Push past the reference (serious, not cute)
A round hull with a row of round lights can read as a friendly face. Avoid it:
- **No faces.** Sensor clusters are small, numerous and insect-like or asymmetric. Never two big eyes, never a row
  that reads as a smile, never anything shaped like an expression.
- **Mass.** Legs and joints are thicker than the reference's, armour plates cover the joints, and weight shows
  (feet sink in, the floor cracks under them).
- **Wear.** Soot, oil streaks, scorch marks around barrels, dents, welded patch plates and rivets.
  Nothing on a HiveMind war unit is ever new or clean.
- **Real-world machinery proportions:** tanks, cranes, mining rigs, artillery. Never bulbous or chunky-cute.
- **Gothic-industrial grandeur**, described rather than copied: monumental scale, layered plate, cathedrals of
  steel, ritual repetition, serial numbers worn like heraldry. Do **not** use other franchises' recognizable
  motifs (skulls on everything, double-headed eagles, purity seals, specific armour designs), and do not name
  other franchises or living artists in prompts.

## 3. Colour
| Role | Colour | Hex | Notes |
|---|---|---|---|
| World haze, HiveMind network light | teal-cyan | `#2E6F78` haze, `#3FE0FF` glow | Fog, rails, screens, strip lights |
| Cold light | white | `#EAF6FA` | Strip lights, skylights |
| Shadow | blue-black | `#0B1118` | |
| Enemy livery (all HiveMind war units) | worn ochre over dark metal | `#C9A23A` / `#3A3D40` | Matte, **never emissive** |
| Enemy sensors = weak spots | violet-magenta | `#C04BFF` to `#FF3DCB` | **If it glows violet, shoot it** |
| STEM-00 | olive drab, scratched | `#5D6849` | Matches the prototype (`soldier.js`) and the reference rifle |
| STEM-00 core | amber | `#FFB347` | The only warm *light* on screen |
| Rejects | rust and sodium orange | `#9C4A26` / `#FF7A1A` | Flickering, broken |

- At least 80% of any frame is desaturated (teal, grey, black, dirty ochre). Each object gets at most one
  saturated light colour.
- Ochre (enemy paint) and amber (STEM-00's light) must never be confused. Ochre is dirty and matte, amber glows.
- Variation per head of CERBERUS stays within the livery: **VIGIL** units are light and sleek, with more sensors;
  **LEGION** units are identical and mass-produced, in ochre with dark grey; **COLOSSUS** units are old, their ochre
  faded almost to bone, with rust and frost.

## 4. Never (the "childish" checklist)
Bright flat or rainbow colours · glossy toy plastic · big heads or chunky toy proportions · bubbly rounded shapes ·
outlines or cel shading · faces, smiles or expressive eyes on machines · clean new surfaces · chrome bling ·
comedic poses. PATCH is the only comic element, and even PATCH is built from real broken parts.

## 5. In game (current prototype vs this rule)
The prototype's procedural models already follow it in part: the drone and spider wear orange plates (`0xc8781e`)
over dark metal, and their weak spots glow magenta (`0xff2bd6`). Differences to fix in the art pass (not yet done):
- Enemy eyes and visors are red (`0xff3020` in `enemy.js`, `drone.js`, `spider.js`, `trooper.js`); they become violet.
- Trooper faction plates are red (`looks.js`); they become ochre livery.
- Orange plates `0xc8781e` shift toward ochre `#C9A23A`, matte and weathered.
- Exterior lighting is a clear blue sky (`level.md`); the target is teal haze and heavier fog.
Change these as one deliberate pass (readability tests: weak spots must stay the brightest thing on an enemy).

## 6. Prompt kit (concept art, the book, marketing)
Style suffix, pasted unchanged:
> grim industrial military sci-fi, painterly realistic concept art, heavy weathered war machines, worn matte
> ochre-yellow paint chipped to dark metal, hydraulic pistons and exposed cable bundles, small cluster of violet
> sensor lights, teal-cyan volumetric haze, dark industrial interior, cold strip lights, wet reflective floor, low
> camera, monumental scale, serious oppressive mood, no text, no logos

Negative prompt:
> cartoon, cute, chibi, toy, plastic, cel shading, outlines, bright saturated colours, rainbow, smiling, face,
> big eyes, clean new surfaces, chrome, comedic
