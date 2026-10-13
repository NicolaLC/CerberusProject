# SFX prompts (still synthesized or missing)

Prompts for ElevenLabs Sound Effects, written in the same style as the recorded weapon set. Each row also gives
the file name to drop in `src/assets/sfx/` and the length to generate, so it can be wired in with one `SAMPLES`
entry in `src/game/view/audio.js`. Every recorded sound has its pitch and volume varied a little on each play, so
generate one clean take, not variations. Keep every sound dry (no room reverb) unless the prompt asks for a tail,
because the arena mixes many sounds at once. Remove a row once its sound is recorded and listed in `credits.md`.

Everything listed here before has been generated (flow "Cerberus missing SFX" in the owner's ElevenLabs workspace),
saved to `src/assets/sfx/`, wired in `audio.js` (synth kept as fallback) and listed in `credits.md`. Generation settings
used: model `eleven_text_to_sound_v2`, prompt influence 0.3, the length given as `duration_seconds`, `loop` on for
the looping sounds. Add new rows here for the next missing sounds.

## Replaced or added after play-testing

| File | Why | Prompt / settings |
|---|---|---|
| `burst-shot.mp3` | the old take held a whole burst; now one round, played per `weapon:shot` (3 per burst) | One single gunshot of a compact sci-fi assault rifle, a tight punchy crack with a short metallic mechanical snap, one round only, no echo, close, dry (0.5 s, influence 0.6) |
| `boss-mortar.mp3` | the old launch sounded off (whistle) | Heavy mortar shell fired from a war machine's back-mounted launcher, a deep hollow punchy thump with a short burst of pressurized gas, no whistle, close, dry (0.8 s, influence 0.5) |
| `ambient-loop.mp3` | level ambience, always on, ducks under the music | Seamless loop of a vast cold industrial military facility, low droning ventilation rumble, distant metal creaks and faint machinery hum, ominous and empty, no music, no voices (30 s, loop) |
| `combat-music.mp3` | combat music (`Audio.mood`, `MUSIC` / `COMBAT_ON` / `COMBAT_OFF` in `audio.js`) | ElevenLabs Music v2.5, 60 s, instrumental: Energetic dark sci-fi drum and bass at 174 BPM, driving rolling breakbeats, heavy distorted reese bass, cold industrial synth stabs and metallic percussion hits, aggressive and relentless, constant high energy from start to end with no intro and no outro so it loops cleanly. It still fades out over its last ~5 s, so the game loops it at 39 bars (`MUSIC.loopEnd`). |
| `reload-rifle.mp3` | old reloads were not punchy enough | Heavy sci-fi assault rifle reload: a sharp magnetic release clack as the empty magazine drops, a solid metallic slam of a fresh magazine locking in, then a hard charging handle pull and snap forward, punchy and tactile, close, dry (1.8 s, influence 0.5) |
| `reload-mg.mp3` | same | Heavy sci-fi machine gun reload: a feed cover thrown open with a loud metal clank, a heavy ammo belt box swapped and rattling, the belt laid in, the cover slammed shut, then a hard bolt rack, weighty and mechanical, close, dry (3.0 s, influence 0.5) |
| `reload-good.mp3` | same | Fast clean weapon reload finish: a firm metallic magazine slam followed immediately by a crisp bolt release snap, tight and punchy, close, dry (0.5 s, influence 0.5) |
| `reload-perfect.mp3` | same | Perfect weapon reload confirm: an instant hard metallic magazine slam and bolt snap, layered with a bright rising electric charge-up ping, very satisfying and punchy, sci-fi, close, dry (0.6 s, influence 0.5) |
| `reload-jam.mp3` | same | Weapon reload jamming: a magazine grinding and catching in the receiver with a harsh scraping metal crunch and a dull failed clunk, frustrating, close, dry (0.6 s, influence 0.5) |
| `boss-music.mp3` | boss fight music, boss:wake to boss:dead (crossfades from the combat track) | ElevenLabs Music v2.5, 75 s, instrumental: Intense dark sci-fi boss battle drum and bass at 174 BPM, pounding breakbeats with huge industrial impacts, a menacing growling distorted bass, ominous low synth brass stabs and urgent pulsing arpeggios, heavier and more threatening than regular combat, relentless full energy from start to end with no intro and no outro so it loops cleanly. Looped at 54 bars. |

## Footstep levels

ElevenLabs takes of the same prompt can come out 15-25 dB apart, and a quiet take in a random-pick list drops steps
(walk take 4, metal 2 and 4, robot 2 were near silent). Every `step-*.mp3` is now trimmed to 5 ms before its onset and
peak-normalised to -3 dBFS; do the same to any new take before adding it (the gain per list stays in `SAMPLES`).

## Recorded and wired after the first pass

- `drone-loop.mp3`: done. One looped voice (`Audio.mood` -> `#beds`), gain by the nearest alive drone (silent beyond
  `DRONE_RANGE`, 25 m), silent on pause. One shared voice, not one per drone.

## Recorded, not wired yet

| File | Event | Notes |
|---|---|---|
| `arm-retract.mp3` | maintenance arm folds up (`prop.arm` `retractOn`) | the prop does not exist on main yet (it is on `feat/prologue-calibration`) |
| `bay-hum-loop.mp3` | calibration bay ambience, inside `bay-zone` | the zone does not exist on main yet (same branch) |
| `console-loop.mp3` | `prop.console`, positional | the prop does not exist on main yet (same branch) |

The Prologue wake-up cues (`wake-surge`, `wake-core`, `wake-rise`) play off the boot intro today (`Audio.wake`, `WAKE` in
`audio.js`: surge 2.4 s after `intro:start`, core 1 s later, rise timed to end with the intro; cut on a skip). Move them
to the `intro.cinematic` timeline (`wake.at`, `wake.rise`) once it exists.
