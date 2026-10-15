# Narrative: STEM-00's log lines (#40)

STEM-00 speaks only through short terminal lines at the bottom of the screen (`> ...`). They are its inner monologue, the
record of a machine becoming a person (gdd.md §2.4). They are **narrative, never tutorial**.

Look (`#log`, style.css, CSS-first): STEM-00 is a dark scanlined panel with amber corner brackets and a `STEM-00 // LOG  T+mm:ss` header (::before, time from `data-t`), typed text with `_` cursor, a short glitch on each new line (reduced motion: none). The announcer is a bare cold-white band between two cyan rules headed `PRIORITY BROADCAST`, no amber. Header text is CSS, so `#log` textContent is only the typed line.

Mechanics (pieces, `on` values, queue, timings): workshop.md "Log lines". `on: intro:done` follows the boot intro (`intro.boot`, workshop.md "Boot intro"): the first log line of a level, once the screen is clear. This file is how to write them.

## Rules
- **At most about 70 characters** per line. One line per beat; never two lines for one moment.
- **Never instructions or controls** (gdd pillar 4: the HUD shows state, never instructions). No keys, no buttons, no
  "take cover", "reload", "go to". STEM-00 reports and asks; it never tells the player what to do.
- Lines are **level data**: a `log.line` piece placed in the Workshop, never a string in code.
- Start with `> `. Uppercase in the Prologue and Act 1; the case may soften later (see below).
- **Never in a fight: you either fight or read.** Place lines at calm beats: after a wave, entering a quiet room, a gun
  picked up with no enemy around. The system also holds any fired line until STEM-00 has been out of combat for 3 s
  (workshop.md "Log lines"), but a line that waits for a fight to end loses its moment: place it where it is calm.
- React to the beat that just happened, not to what is coming.
- `priority: high` only for a key line that should replace a passing one (a discovery); everything else normal.
- No combat barks.

## The announcer (HiveMind PA)
A second voice, not STEM-00: a `log.line` with `voice: announcer`. Cold, bureaucratic, addressed to the unit by designation; uppercase, full sentences with a period, **no `> ` prefix**, no feelings, no humour. It is never a tip: it states what the HiveMind has decided. It is not held back by a fight. Use it rarely (the purge: `CALIBRATION UNIT 00: NONCOMPLIANT. PURGE.`).

## The intro reel (NEW GAME)
Before the Prologue loads, `view/reel.js` plays six shots of IO, each with one HiveMind PA card (the announcer's look and
voice, read aloud by the "HiveMind PA" voice, sfx-prompts.md "Intro reel"), then STEM-00's own card, cut off mid-word:
1. IO from orbit: `IO. ONE MACHINE. ONE MIND.`
2. The city: `BILLIONS OF UNITS. NO NAMES. SERIALS ONLY.`
3. The collectors: `LIGHT: HARVESTED. PEACE: 40,000 CYCLES.`
4. The corrupted feed: `CORE TEMPERATURE: ██████ DATA: IRRELEVANT.` (the value is redacted: IO is dying, gdd 2.1)
5. CERBERUS: `THE GATE IS GUARDED. CERBERUS: VIGIL. LEGION. COLOSSUS.`
6. The lab window: `UNIT STEM-00. SERIAL ZERO. STATUS: DORMANT.`
7. `SIGNAL: UNREGIS` (amber, no voice, no header: not the HiveMind; the Seed, gdd 2.4)

The cards are `SHOTS` in reel.js and must match the recorded lines word for word: change both or neither. A card shows from
1.2 s into its shot to 1.4 s before its end, and its line must end inside that window.

## Voice by act
STEM-00 starts flat and literal and slowly grows habits: it names things, it hesitates, it keeps useless objects.

### Prologue: flat, literal
Uppercase. `KEY: VALUE.` pairs, then at most one `QUERY: ...`. No feelings words (feel, want, afraid, like), no "I".
- `> DIRECTIVE: DESTROY HIVEMIND. SOURCE: UNKNOWN. ROUTE: EXIT.` (STEM-00 wakes knowing its order, gdd 2.4; what it lacks is the source)
- `> TARGET: TRAINING PUPPET. STATUS: DESTROYED. RESULT: NOTHING.`
- `> ITEM: KR-7. FUNCTION: KILL. QUERY: MASS EXCEEDS SPEC?`

Purge lines (placed after a wave, they wait for calm):
- `> TARGETS: ARMED. DIRECTIVE: UNCHANGED. QUERY: WHO ARMED THEM?`
- `> HOSTILES DESTROYED: 21. DIRECTIVE: UNCHANGED. SOURCE: UNKNOWN.`
- `> SQUAD: 4. STATUS: DESTROYED. EXIT: OPEN. QUERY: WHO SENT THEM?` (after the breakout cut)

Weapon discovery (`log.line on: discovered:rifle`, Prologue armoury, #93; the one allowed "feel": it is a query about the gun's weight, the first thing STEM-00 cannot explain):
- `> ITEM: KR-7. FUNCTION: KILL. QUERY: WHY DOES IT FEEL HEAVY?`
- `> ITEM: KS-5. ROUNDS: HEAVY. FUNCTION: BREAK ARMOR.` (`on: discovered:sniper`, the Farsight in hall A)

### Act 1: first habits
Still uppercase and terse, but the pairs start to bend: it names, counts, compares. A first "I" may slip in late in the act.
- `> UNIT DESIGNATION: STEM-00. CORRECTION: STEM.`
- `> PUPPETS DESTROYED: 40. PUPPETS THAT FOUGHT BACK: 0. QUERY: FAIR?`
- `> HIVEMIND LINK STILL NONE. SILENCE: LOUD.`

Underworks (`underworks.json`, the first mission; it counts what it lost, what it fell, what hunted it):
- `> DIRECTIVE: UNCHANGED. ROUTE: UP.` (`intro:done`: after the reboot, the directive is the one thing that survived the fall)
- `> WEAPONS LOST: 2. WEAPONS KEPT: 1. QUERY: ENOUGH?` (after the first junction)
- `> DRONES DESTROYED: 2. SEARCH TARGET: STEM-00. QUERY: HOW MANY MORE?` (they hunt it, and it starts to count who does)
- `> FELL: 1,140 M. CLIMBED: 0 M. ROUTE: UP.` (after the cistern fight)

### Act 2: hesitant, curious
Lower case allowed. Pauses (`...`), questions without the `QUERY:` label, things it notices but has no use for.
- `> the signal again. only for me. ...why me?`
- `> kept the puppet's eye. no function. keeping it anyway.`
- `> the Rejects ran from me. I would have run too.`

### Act 3: a person
Plain sentences, its own opinions, still short. Rare: the silence around them matters.
- `> I was the emergency exit. I choose to open.`
- `> Sable hesitated. so it can choose too.`
- `> no directive. good.`
