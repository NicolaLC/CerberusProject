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

## Signs (diegetic, `env.label`)
Facility signage only: floor stencils and wall panels of the calibration facility, never a HUD prompt. Stencil caps in monospace on a dark panel (`bg`), text in the palette below (cold white `#EAF6FA`, glow teal `#3FE0FF`, ochre `#C9A23A` for warnings), no emissive. Input tokens (`{jump}`) follow the active device.

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

## 5. In game (art pass #87 done: no open differences)
The procedural models, materials and lighting follow this rule. Open differences go in this section until fixed; it is
empty now. Decisions taken in the pass (keep them unless the rule changes):
- **Weathering is a texture, not geometry or extra materials.** Shared wear maps (`wornMaterial` / `wearTexture` in
  `world/textures.js`: paint chipped at plate edges, scratches, grime streaks; metal; fabric) multiply each material's
  colour, so draw calls stay the same. STEM-00 also carries welded patch plates and weld beads.
- **STEM-00:** olive drab `#5D6849`, scratched; the yellow hazard stripes became dark metal bands and stencilled
  `STEM-00` serial plates; the red antenna light is amber; one amber core on the chest (`Player.setCore(0..1)`,
  emissive 0.4 to 5) for #49 to drive by story progress. Small amber LEDs stay: they are STEM-00's own light.
- **Gun furniture: STEM-00 repaints the guns olive as it claims them** (the reference rifle is olive). The K-series
  bodies stay worn dark metal with scorched muzzles; player models and Library props are olive. In a trooper's hands the
  same rifle keeps the HiveMind's worn ochre and has no glows (sensors are the only saturated light on an enemy).
  Gun glows stay amber/orange (STEM-00's power), never violet. Every gun shows a receiver, a magazine and a heat shroud.
- **Enemies:** ochre livery `#C9A23A`, matte, over dark metal `#3A3D40`; sensors violet (`VISOR` `#8C3CFF`, bluer
  than the spec's `#C04BFF` end so it never reads as the magenta weak spots). Sensors are small uneven clusters (drone,
  spider turret, trooper and puppet visors): no eye slits, never two big eyes. At rest a sensor is dimmer than the weak
  spots; only the shot telegraph flares it brighter, for a moment, on purpose.
- **Spider miniboss (SX-6):** rebuilt after the owner's walker concept: saucer hull, sensor band with lens clusters
  (clusters of 2-3 small lenses at uneven spacing, not a row of round eyes), twin-barrel side pods, tall splayed legs.
  It keeps six legs (the leg-break and tripod-gait gameplay); a four-legged variant is a separate gameplay change.
- **Puppets:** calibration-frame ochre, matte and scuffed (shooters a darker ochre); the bullseye is bone white on
  black instead of red.
- **HiveMind projectiles** (bolts, drone bursts, mortar orbs and rings, their impacts) are violet-white: a near-white
  core in a violet haze, so they never read as STEM-00's amber. Explosion fire (a drone or the mech dying) stays orange.
- **World:** teal-cyan haze sky and heavy fog; cold sun and fill; interiors lit cold white and cyan, red only for story
  beats (a Rejects or alarm room) and the `env.alarm` lighting state (workshop.md "Alarm": the whole scene fades to amber (`#ff9a2a`, 0.4: never damage red, which made the purge read as low health) and pulses while the alarm runs; the HiveMind announcer line is cold white with a network-cyan glow, never red). The arena wears weathered metal (`skin: "weathered"`, level.md); the Gym rooms,
  Library and Workshop keep the grid textures because metrics read off them.
- **CERBERUS on the horizon** (main menu backdrop, `view/menu-scene.js`): a colossal quadruped war mech, standing three
  quarters toward the city: low wide hull under rounded armour shells (carapace, pauldrons, haunches) with dark seam bands, a launcher tube on its back, digitigrade legs (rounded
  thighs, joint discs, thin piston shins, splayed claws), three heads (VIGIL the forward sensor head with its gun, LEGION and
  COLOSSUS the shoulder gun pods). Never sharp: a tone darker than the sky, lighter on top, a backlit rim, its legs sunk
  in the haze; its only light the violet eyes that breathe. Sensed more than seen, but always readable as a mech dog.
- **Grade** (`post.js`): surfaces desaturated, shadows teal, HDR emissives keep their colour; bloom only above 1.0.
- **HUD:** the crosshair's weak-spot state stays magenta, the kill shockwave stays cyan. The enemy state and damage
  feedback **stay red, as UI-only colours**: red appears nowhere in the world, so it can't be confused with a sensor,
  and a violet enemy state would blur into the magenta weak-spot state.
- Screenshots: `node scripts/screenshots.mjs <dir>` (dev server running) saves the same 20 angles every time
  (book/screenshots angles plus close-ups of every unit and gun) for before/after comparisons.

## Props (`prop.*`, `world/props.js`)
Facility set dressing for the calibration bay and later interiors: consoles, crates, cables, pipes, puppet racks, cradles, workbenches, the
maintenance arm, hazard stripes, warning panels.
- Materials: dark worn metal `#3A3D40` (frames, pedestals, pipes), near-black `#202328` (joints, brackets, cable sheaths),
  calibration-frame ochre `#C9A640` (the puppets' shell, the arm, valve wheels, rack plates), dull grey-green crate paint
  `#4A5452`; all matte under the shared wear maps. Nothing clean or glossy.
- **Warnings are ochre on near-black**, never yellow / black: hazard stripes and the panels' stripe band use `#C9A23A`.
- **Gates (`kit.gate`) read as doors:** darker heavy metal slab (`mat` param overrides it), ochre chevron bands, dark vertical seams, a dark jamb + lintel frame, and an emissive status lamp over the opening (red while sealed, cyan once `gate:open`; basic material, no light).
  Panels are stencil caps in ochre on a dark plate, lit like any surface (no emissive, like signs).
- **Screens are the props' only light:** cold cyan `#3FE0FF` readouts, a few bars per row, scrolling a row at a time with an
  occasional dropout. Never amber (STEM-00's light) or violet (enemy sensors).
- Hanging puppets are inert: same ochre and black as the live ones, sensor band dark (no glow), limbs slack.
- Cradles and benches read as long service: dark worn frames, ochre clamps and livery (the calibration-frame colour), cable
  bundles, darker worn floor (`inFloor` patches) under them; the only light is a small cyan status readout.
- Budget: a level's props are one draw per material (about 7 plus one per panel text, per 64 m chunk) and no extra shadow draw;
  plain boxes for frames and brackets, rounded boxes only where the silhouette shows it.

## Architecture (`arch.*`, `world/arch.js`)
Interiors read as a military installation (layered, structural, serviced), never as a grid of boxes and never as a glowing temple:
- **Break the box:** 45 degree coves where walls meet the ceiling (a recessed cyan light line in the cove), chamfered vertical corners, ribs every 3-4 m,
  coffered ceilings (I-beams) between the light fixtures. Walls are layered: dark kick band, inset panels with dark seams, a metal trim rail at ~2.6 m,
  larger upper panels.
- **Doors are bulkheads:** heavy octagonal metal surround with ochre edges around the gate, a low sill; the gate's own lamp stays the status light.
- **Floors guide:** lit channels flank the walking line through each gate; grates and hatches break the floor plates.
- Materials are the level's own (skin wall / roof tones, worn dark metal, near-black, calibration ochre); light is cold cyan or white strips only, no
  extra point lights, no violet or amber. Ochre stays a paint (edges, warnings), never a glow.

## Interiors (`arch.corridor`, `world/interior.js`)
Dense serviced corridors (reference: an owner-supplied UE5 sci-fi corridor, not in the repo; the rules here win over it). Kept from it: wall bays
with recesses and vents, a rib frame every 3 m, a ceiling truss with twin ribbed pipes, fluorescent tube fixtures on 45 degree cornices, decked
floor with a centre grate, steps, hazard trims. Changed for the rule:
- **Marker lights are cyan, never amber** (amber is STEM-00's light): small dots on the bumper rail, the panel frames, the ribs and the step risers.
- **Hazard trims are ochre paint**, chipped to dark metal at the edges (`stripe`, 25 cm diagonals), on the bumper rail, the rib bands, the step
  nosings, the beam undersides and the door columns. Pipe collars are matte ochre, not gold.
- **Painted plate, not chrome:** plates are mostly dielectric paint (metalness ~0.35) with bare metal only in scratches and bolt heads; pipes are
  the only bright metal. Metals reflect a generated corridor environment (dark tube, two rows of tubes); the cold white tubes and the point
  lights are the only light; floors have wet, smoother patches that pick up the tubes.
- **Detail is texture first:** seams, bolts, vent slots, hatches, grime streaks, anti-slip treads, quilted padding and bar grating are painted
  normal / roughness maps (world UVs, 1 tile = 2 m); geometry carries the silhouette (frames proud of dark recesses, lattices, louvres, fan
  shrouds, the leaning upper panels).
- **Glow without bloom** (post effects are off): tubes are emissive and sit on additive halo cards; brighter fixtures are bigger, not hotter.
- **No visible tiling:** every bay rolls its panel kind and a one-off (turbine housing, maintenance arm, hoses, crates, console) from a seed;
  one-offs above the walkway stay over 2.2 m. Fans read as fans: pitched blades, hub, shroud ring and a guard grille, never a solid disc.
- **The far end reads:** a door end gets a lamp bar and a soft additive light pool on the door and the deck in front of it, plus a brighter
  point light, so a gate is legible from 24 m.
- **Rooms the player fights in** use the slim wall (`arch.wall`): the same language flattened into the panelling envelope, so cover, signs
  and props keep their places; the deep corridor profile is for walkways and set-piece rooms (the Prologue's transit node).

## 6. Prompt kit (concept art, the book, marketing)
Style suffix, pasted unchanged:
> grim industrial military sci-fi, painterly realistic concept art, heavy weathered war machines, worn matte
> ochre-yellow paint chipped to dark metal, hydraulic pistons and exposed cable bundles, small cluster of violet
> sensor lights, teal-cyan volumetric haze, dark industrial interior, cold strip lights, wet reflective floor, low
> camera, monumental scale, serious oppressive mood, no text, no logos

Negative prompt:
> cartoon, cute, chibi, toy, plastic, cel shading, outlines, bright saturated colours, rainbow, smiling, face,
> big eyes, clean new surfaces, chrome, comedic
