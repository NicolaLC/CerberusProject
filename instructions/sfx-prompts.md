# SFX prompts (still synthesized or missing)

Prompts for ElevenLabs Sound Effects, written in the same style as the recorded weapon set. Each row also gives
the file name to drop in `src/assets/sfx/` and the length to generate, so it can be wired in with one `SAMPLES`
entry in `src/game/view/audio.js`. Every recorded sound has its pitch and volume varied a little on each play, so
generate one clean take, not variations. Keep every sound dry (no room reverb) unless the prompt asks for a tail,
because the arena mixes many sounds at once. Remove a row once its sound is recorded and listed in `credits.md`.

## Footsteps (none today, not even synth)

Footsteps repeat constantly, so these are the one exception to "one take": generate 4 short takes of each
(`-1` … `-4`); the game picks one at random per step, on top of the pitch/volume variation. Each take is a single
step, trimmed tight (sound starts at 0 s). Hooking them up needs a foot-plant event from the animator
(`rig.js`, the stance phase of each leg): added when the files arrive.

| Files | Event | Length | Prompt |
|---|---|---|---|
| `step-walk-1..4.mp3` | player walking | 0.5 s | Single footstep of a soldier in heavy armored combat boots walking on concrete, firm heel-toe thud with a faint rattle of armor plates, close, dry, no reverb |
| `step-run-1..4.mp3` | player sprinting | 0.5 s | Single fast running footstep of a heavily armored soldier on concrete, hard impact with a sharp scuff and armor plates clanking, close, dry |
| `step-metal-1..4.mp3` | player on the metal platform / stairs (optional) | 0.5 s | Single heavy armored boot footstep on a metal grating platform, hollow metallic clang, dry |
| `step-robot-1..4.mp3` | troopers and puppets walking | 0.5 s | Single footstep of a humanoid combat robot on concrete, heavy metallic foot with a small servo whir, slightly distant, dry |

## Hit feedback (UI-like, must cut through gunfire)

| File | Event | Length | Prompt |
|---|---|---|---|
| `hit-body.mp3` | bullet hits an enemy body | 0.5 s | Short dry metallic tick of a bullet hitting a robot's armor plate, tight and clicky, sci-fi hit-confirm, no reverb |
| `hit-head.mp3` | headshot | 0.5 s | Bright high-pitched double metallic ping, a bullet striking a robot helmet, crisp and satisfying sci-fi headshot confirm, short ring-out |
| `hit-weak.mp3` | weak spot hit | 0.5 s | Sparkling electric crystal ping with a crackle of energy, hitting a glowing power core, bright rising shimmer, short |
| `kill.mp3` | enemy destroyed (confirm) | 0.7 s | Deep heavy thunk followed by a bright two-note digital chime, sci-fi shooter kill confirm, punchy and clean |
| `low-mag.mp3` | each of the last rounds in the magazine | 0.5 s | Tiny high mechanical tick of an almost empty magazine spring, light metallic click, very short |
| `reload-good.mp3` | good (not perfect) active reload | 0.5 s | Quick solid metallic clack of a magazine seating firmly, single clean click, sci-fi rifle |

## Player

| File | Event | Length | Prompt |
|---|---|---|---|
| `jet.mp3` | jetpack burst | 0.8 s | Short powerful jetpack thruster burst, hissing rocket whoosh that sweeps down in pitch with a low thump at the start, sci-fi armor |
| `land.mp3` | landing after a jump or vault | 0.5 s | Heavy armored boots landing on concrete, soft low thud with a light metal rattle of armor plates |
| `hurt.mp3` | player takes damage | 0.6 s | Energy shield absorbing a hit, low electric buzz-crack with a muffled impact thud, sci-fi personal shield |
| `pickup.mp3` | ammo collected | 0.6 s | Ammunition case picked up, quick metallic rattle of rounds plus a short rising digital confirmation blip |
| `pickup-full.mp3` | walked over ammo while full (no sound today) | 0.5 s | Soft low two-tone digital denial beep, sci-fi HUD, short and unobtrusive |

## Enemies

| File | Event | Length | Prompt |
|---|---|---|---|
| `enemy-shot.mp3` | trooper / drone fires an energy bolt | 0.6 s | Robot soldier firing a plasma bolt, sharp electric zap that drops in pitch, buzzy sci-fi energy weapon, slightly distant |
| `bolt-impact.mp3` | enemy bolt hits a wall (no sound today) | 0.5 s | Plasma bolt hitting concrete, short sizzling electric splash with a small crackle |
| `robot-down.mp3` | puppet / trooper / drone destroyed | 1.0 s | Combat robot destroyed, metal parts breaking apart and clattering on the ground with a short electrical spark |
| `explosion.mp3` | blasts (drone, mortar); pitched by size | 1.5 s | Mid-sized explosion in an open arena, punchy blast with debris and a short rumbling tail, no music |
| `drone-loop.mp3` | drone hover, looping (new, optional) | 2.0 s | Seamless loop of a small hovering combat drone, steady whirring of four ducted rotors with a faint electric hum |

## Spider mech miniboss (SX-6 Tarantula)

| File | Event | Length | Prompt |
|---|---|---|---|
| `boss-wake.mp3` | wakes up | 2.0 s | Giant spider mech powering on, deep hydraulic groan, servos whining up and a heavy mechanical clunk as it rises |
| `boss-charge.mp3` | twin cannons charging before a burst | 1.0 s | Heavy energy cannons charging up, rising electric whine that builds tension, sci-fi |
| `boss-stomp.mp3` | rears up before a stomp | 0.8 s | Huge mech rearing up, strained hydraulics hissing and servos whining upward |
| `boss-step.mp3` | each foot planted | 0.5 s | Heavy metal mech leg stepping onto concrete, dull deep thud with a short hydraulic hiss, no reverb |
| `boss-slam.mp3` | stomp lands (shockwave) | 1.2 s | Massive mech leg slamming the ground, huge low impact boom with cracking concrete and a shockwave rumble |
| `boss-mortar.mp3` | mortar launched | 0.7 s | Mortar tube launch from a mech's back, hollow deep thoomp with a short whistle as the shell leaves |
| `boss-leg.mp3` | a leg is shot off | 1.2 s | Mechanical leg blown off a giant robot, sharp explosion with metal tearing and parts clanging away |
| `boss-death.mp3` | destroyed | 3.0 s | Giant spider mech destroyed, big explosion followed by collapsing heavy metal, groaning steel and electrical sparks fading out |
| `boss-loop.mp3` | idle engine while awake (new, optional) | 3.0 s | Seamless loop of a giant walking mech's engine, low steady rumble with soft rhythmic hydraulic pulses |
