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

## Missing (synth fallback until recorded)

| File | Event | Length | Prompt |
| --- | --- | --- | --- |
| `shield-break.mp3` (`SAMPLES.shieldBreak`) | `player:shieldBreak` (synth: `zap`) | 0.8 s | An energy shield collapsing on a combat robot: a sharp glassy electric crack, a falling whine as the field drains, a brief crackle of static, alarming, sci-fi, close, dry (influence 0.5) |
| `plate-off.mp3` (`SAMPLES.plateOff`) | `enemy:plate` (now: `bossLeg` quieter, synth `boom`) | 0.6 s | A heavy armor plate blown off a combat robot by a high-calibre round: a hard metallic clang, a bolt shearing with a short screech, the plate clattering away, close, dry (influence 0.5) |

## Replaced or added after play-testing

| File | Why | Prompt / settings |
|---|---|---|
| `burst-shot.mp3` | the old take held a whole burst; now one round, played per `weapon:shot` (3 per burst) | One single gunshot of a compact sci-fi assault rifle, a tight punchy crack with a short metallic mechanical snap, one round only, no echo, close, dry (0.5 s, influence 0.6) |
| `boss-mortar.mp3` | the old launch sounded off (whistle) | Heavy mortar shell fired from a war machine's back-mounted launcher, a deep hollow punchy thump with a short burst of pressurized gas, no whistle, close, dry (0.8 s, influence 0.5) |
| `ambient-loop.mp3` | level ambience, always on, ducks under the music | Seamless loop of a vast cold industrial military facility, low droning ventilation rumble, distant metal creaks and faint machinery hum, ominous and empty, no music, no voices (30 s, loop) |
| `combat-music.mp3` | combat music (`Audio.mood`, `MUSIC` / `COMBAT_ON` / `COMBAT_OFF` in `audio.js`). Replaced the drum and bass take: the owner wants a Halo 3 like orchestral sound | ElevenLabs Music v2.5, 60 s, instrumental: Epic heroic military sci-fi combat score for a robot war video game, 140 BPM, full orchestra with driving staccato string ostinatos, bold french horn and trombone melodies, a deep wordless male choir chanting long sustained notes, thundering taiko and orchestral war drums with a steady rock drum kit beat, gritty distorted electric guitar riffs doubling the low strings, urgent, triumphant and determined, cinematic action with constant high energy from start to end, no intro and no outro so it loops seamlessly, instrumental with wordless choir only, no lyrics. Tempo measured at 140.0 BPM; baked loop: bars 1-34 of the take (bar 0 = its start), the last one crossfaded with bar 0, 58.3 s. -14.3 LUFS, so its gain is 0.5 (the old track was -11.3 LUFS at 0.35). Do not name a game or composer in the prompt. |
| `reload-rifle.mp3` | old reloads were not punchy enough | Heavy sci-fi assault rifle reload: a sharp magnetic release clack as the empty magazine drops, a solid metallic slam of a fresh magazine locking in, then a hard charging handle pull and snap forward, punchy and tactile, close, dry (1.8 s, influence 0.5) |
| `reload-mg.mp3` | same | Heavy sci-fi machine gun reload: a feed cover thrown open with a loud metal clank, a heavy ammo belt box swapped and rattling, the belt laid in, the cover slammed shut, then a hard bolt rack, weighty and mechanical, close, dry (3.0 s, influence 0.5) |
| `reload-good.mp3` | same | Fast clean weapon reload finish: a firm metallic magazine slam followed immediately by a crisp bolt release snap, tight and punchy, close, dry (0.5 s, influence 0.5) |
| `reload-perfect.mp3` | same | Perfect weapon reload confirm: an instant hard metallic magazine slam and bolt snap, layered with a bright rising electric charge-up ping, very satisfying and punchy, sci-fi, close, dry (0.6 s, influence 0.5) |
| `reload-jam.mp3` | same | Weapon reload jamming: a magazine grinding and catching in the receiver with a harsh scraping metal crunch and a dull failed clunk, frustrating, close, dry (0.6 s, influence 0.5) |
| `boss-music.mp3` | boss fight music, boss:wake to boss:dead (crossfades from the combat track). Replaced the drum and bass take with the same orchestral style | ElevenLabs Music v2.5, 75 s, instrumental: Massive dark epic boss battle score for a military sci-fi robot war video game, a colossal three-headed war machine, 150 BPM, full orchestra with relentless low string ostinatos, menacing brass stabs and huge horn melodies, a powerful wordless male choir chanting in dark minor key, pounding taiko and orchestral war drums with a heavy rock drum kit, crushing distorted electric guitar riffs locked to the low strings, ominous and heroic, heavier and more threatening than regular combat, constant full intensity from start to end, no intro and no outro so it loops seamlessly, instrumental with wordless choir only, no lyrics. Tempo measured at 150.0 BPM; baked loop: bars 1-45 of the take, the last one crossfaded with bar 0, 72 s. -11.8 LUFS, gain 0.38. |
| `alarm-siren.mp3` | the old take (a continuous high wail, ~2.7 kHz, no gaps) was too annoying across the long Prologue purge | Seamless loop of a distant low industrial facility alarm: a deep muffled two-tone horn blast, low pitched and soft, followed by a long pause of silence, repeating slowly, heard from far away through thick metal walls, ominous not shrill, no high frequencies, no fast wail, no voices (8 s, influence 0.5, loop; flow `LetqmDVTuXh60AaojYa8`, take 1 of 4) |
| `menu-music.mp3` | title / pause menu music: its own loop on the title (`Audio.title(on)`, from `Shell`, the game audio silent under it), and while the engine is paused (pause panel, `mood()`), crossfaded with the combat and boss tracks | ElevenLabs Music v2.5, 75 s, instrumental: Slow, vast and ominous dark sci-fi ambient score for the title screen of a grim industrial robot war game, 70 BPM, a lone mechanical soldier watching a ruined machine city at dusk under a colossal three-headed war machine. Deep sustained analog synth drones and sub-bass swells, distant metallic resonances like wind through steel girders, a slow mournful low cello-like synth melody of a few notes, sparse heavy industrial percussion hits far away, faint radio static and servo textures, melancholic and lonely but powerful, restrained, no drums groove, no vocals, constant intensity with no intro and no outro so it loops seamlessly. The take still faded in and out, so the file is baked into a seamless loop: bars 3-19 (70 BPM, bar = 240/70 s), with its last bar crossfaded (equal power) into bar 2, 58.3 s; it loops whole, no `loopEnd`. |

## Intro reel (NEW GAME)

Recorded and in `audio.js`, but not called yet: the reel view (`view/reel.js`) is not in the repo. When it lands:
`Shell #intro` calls `audio.reel(true)` (the title music fades out, `reel-drone` fades in), each shot calls
`audio.reelLine(n)` when its card starts typing (`TUNING.cardAt`; card 7, `SIGNAL: UNREGIS`, has no line), and the
reel's end or cancel calls `audio.reel(false)` (bed and line fade out). `reelLine` cuts the line before it.

| File | Use | Settings |
|---|---|---|
| `reel-drone.mp3` (`SAMPLES.reelDrone`) | the bed under the whole reel, looped | Sound Effects v2, 30 s, loop, influence 0.4: Seamless loop of a vast dark machine planet heard from orbit: a very low sustained sub-bass drone, a slow cold analog synth pad breathing in and out, faint distant data chatter and radio static, a deep electrical hum like a city-sized server, ominous, empty and mechanical, no melody, no percussion, no voices. Take 1 of 2 (flow "Cerberus intro reel audio"). The file is -5.7 LUFS, so its gain is 0.05. |
| `reel-pa-1.mp3` .. `reel-pa-6.mp3` (`SAMPLES.reelPa1` .. `reelPa6`) | the HiveMind PA reading cards 1-6 | Text to Speech, `eleven_multilingual_v2`, voice "HiveMind PA" (saved in the owner's workspace, id `G5m7VFF81fNvCraZiphw`), voice defaults (the flow tool cannot set stability / similarity / style). Take 1 of each. Gain 0.5. |

PA text (sentence case, pauses as `<break>` tags; must match the cards):

1. `IO. <break time="0.6s"/> One machine. <break time="0.4s"/> One mind.`
2. `Billions of units. <break time="0.5s"/> No names. <break time="0.4s"/> Serials only.`
3. `Light: harvested. <break time="0.6s"/> Peace: forty thousand cycles.`
4. `Core temperature: <break time="1.0s"/> Data: irrelevant.`
5. `The Gate is guarded. <break time="0.6s"/> Cerberus: <break time="0.3s"/> Vigil. <break time="0.3s"/> Legion. <break time="0.3s"/> Colossus.`
6. `Unit S T E M zero zero. <break time="0.4s"/> Serial zero. <break time="0.6s"/> Status: dormant.`

Voice Design prompt (model `eleven_ttv_v3`, guidance 8; the first, lighter prompt was too high and clean): A deep,
emotionless machine voice for a synthetic intelligence that rules a planet of robots, heard over city-wide public
address speakers. Very low pitch, heavy and resonant, genderless, slow and perfectly even pace, crisp consonants, no
breath, no warmth, no emphasis, bureaucratic and calm like an automated station announcement. Clearly mechanical with
digital vocoder processing, and a large metallic reverb tail as if echoing across a vast industrial city.

Post (ffmpeg, the same on every line; the owner asked for little noise and reverb):
`rubberband=pitch=0.8409:formant=preserved,highpass=f=100,lowpass=f=7000,acrusher=bits=12:mix=0.08:mode=log,aecho=0.8:0.4:70|140|280:0.25|0.15|0.08,apad=pad_dur=0.8,loudnorm=I=-16:TP=-1.5:LRA=7`
(3 semitones down, PA band, light crush, short metallic slap, -16 LUFS). Line 4 is cut before that chain: the 1 s
redaction gap (0.86-1.87 s of the dry take) is replaced by a burst of band-passed white noise (`tremolo` 23 Hz, crushed
to 6 bits), and "irrelevant" (from 2.44 s) is preceded by two 0.12 s repeats of its first syllable. Processed lengths:
3.8, 4.6, 4.7, 4.5, 6.3, 7.2 s, each inside its card window (1.2 s into the shot to 1.4 s before its end).

## Recorded, wired outside the event table

- `drone-loop.mp3`, `console-loop.mp3`: one looped voice each (`Audio.mood` -> `#beds`), gain by the nearest alive drone (silent beyond 25 m) / `prop.console` (`world.consoles`, silent beyond 6 m). No per-drone voices.
- `bay-hum-loop.mp3`: bed that fades in while the camera is inside an interior zone (`world.isInterior`, the Prologue's `bay-zone`).
- `arm-retract.mp3`: `prop:retract` { pos } (a `prop.arm` `retractOn` fires), positional (fades out by 20 m).
- Wake-up cues (`wake-surge`, `wake-core`, `wake-rise`): on the intro cinematic. Surge on `cinematic:wake`, core 1 s later, rise stretched to `wake.rise`; a skip (`cinematic:done` { skipped }) cuts them. A level with an `intro.boot` and no cinematic keeps the old schedule off `intro:start` (`Audio.wake`, `WAKE`: surge 2.4 s, core 1 s later, rise ending with the intro); it is ignored once a cinematic ran this run.

## Footstep levels

ElevenLabs takes of the same prompt can come out 15-25 dB apart, and a quiet take in a random-pick list drops steps
(walk take 4, metal 2 and 4, robot 2 were near silent). Every `step-*.mp3` is now trimmed to 5 ms before its onset and
peak-normalised to -3 dBFS; do the same to any new take before adding it (the gain per list stays in `SAMPLES`).

## Menu UI

Wired: `Audio.ui(kind)` / event `ui:sfx` { kind } (title, pause menu, sub-pages, confirm dialog). The files are picked up on their own (globbed `ui-*.mp3`,
id `ui-<kind>`, gain 0.6, on the UI bus) with the synth as fallback. Same style as the rest: grim industrial military
hardware, no arcade bleeps, dry. `move` plays at most every 40 ms, `slider` every 30 ms.

The model's shortest take is about 0.5 s, so every file was cut to the length below. `move` and `slider` start 5 ms
before their loudest click (it came late in the take), the others at their first sound above -40 dB, then a short fade
out. All are peak-normalised to -3 dBFS, except `move` and `slider` at -6 dBFS.

| File | Kind | Length | Prompt | Status |
|---|---|---|---|---|
| `ui-move.mp3` | focus moves / hover | 0.1 s | A single very short soft metallic tick of a small relay contact on a military console, tight and quiet, close, dry, no reverb (influence 0.6) | recorded |
| `ui-select.mp3` | confirm an item | 0.4 s | A heavy mechanical clunk of a toggle switch locking on an armored military control panel, followed by a very short servo whir, solid and tactile, close, dry | recorded |
| `ui-back.mp3` | leave a sub-page / cancel | 0.4 s | A short servo whir winding down followed by a soft lower metallic clunk as a console switch disengages, heavy industrial, close, dry | recorded |
| `ui-open.mp3` | sub-page / pause menu opens | 0.5 s | A short hydraulic hiss as a heavy metal panel slides open on an industrial military console, ending in a small latch click, close, dry | recorded |
| `ui-deny.mp3` | disabled / not allowed | 0.3 s | A dull low electrical buzz of a rejected input on an old military terminal, short and flat, no beep, close, dry | recorded |
| `ui-slider.mp3` | slider / dropdown step | 0.08 s | A tiny crisp detent click of a heavy rotary dial turning one notch on a military control panel, close, dry, no reverb (influence 0.6) | recorded |
| `ui-start.mp3` | NEW GAME / CONTINUE / scene launch | 1.2 s | A deep powerful power-up thrum of a combat machine's reactor spinning up, rising low hum and air rush, ending in a heavy metal latch clamping shut, ominous industrial sci-fi, close, dry | recorded |
| `ui-warn.mp3` | overwrite-progress confirm | 0.5 s | Military console caution alert: two short separate low electronic warning pulses with a brief silence between them, each pulse a soft muffled synthetic tone with a metallic relay click at its start, dark, serious and restrained, like a cockpit caution signal, not a game show buzzer, no horn, no brass, close, dry (0.6 s, influence 0.7). The model gives one hit, not two: the file is the first 0.2 s of the lowest take (energy at 75-80 Hz), played twice 220 ms apart, peak -3 dBFS. Replaced the first take (a high-low buzzy klaxon), which sounded like a clown trumpet. | recorded |



## Terminal typing (boot intro, STEM-00 log)

Synthesized (`Audio.type`, event `ui:type`). Wire as `SAMPLES` entries (`typeKey`, `typeEnd`), keep the synth as fallback. Played at most every 25 ms, pitch and volume varied.

| File | Event | Length | Prompt |
|---|---|---|---|
| `type-key.mp3` | each typed character | 0.08 s | Single key press on an old mechanical computer terminal keyboard, short dry electronic tick with a faint plastic clack, close, no reverb |
| `type-end.mp3` | end of a typed line | 0.2 s | Old computer terminal carriage return, softer low mechanical thunk followed by a tiny electronic blip, dry, no reverb |

## Music loops

Every music file is baked into a seamless loop, so `audio.js` just loops it whole (no `loopEnd`). Measure the real tempo
(the onset autocorrelation at 16-64 beats lands within 0.1 BPM), keep a whole number of bars, and crossfade (equal
power, `acrossfade` qsin) its last bar with the bar just before it: output = bars [first+1, end) with bar `end-1`
overlapped by bar `first`, so the end runs into the start. Skip bars that fade in or out. Match a new track's integrated loudness (ffmpeg
`ebur128`) to the one it replaces through its `SAMPLES` gain.
