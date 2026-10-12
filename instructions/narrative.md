# Narrative: STEM-00's log lines (#40)

STEM-00 speaks only through short terminal lines at the bottom of the screen (`> ...`). They are its inner monologue, the
record of a machine becoming a person (gdd.md §2.4). They are **narrative, never tutorial**.

Mechanics (pieces, `on` values, queue, timings): workshop.md "Log lines". This file is how to write them.

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

## Voice by act
STEM-00 starts flat and literal and slowly grows habits: it names things, it hesitates, it keeps useless objects.

### Prologue: flat, literal
Uppercase. `KEY: VALUE.` pairs, then at most one `QUERY: ...`. No feelings words (feel, want, afraid, like), no "I".
- `> LINK: NONE. DIRECTIVE: NONE. QUERY: WHY?`
- `> TARGET: TRAINING PUPPET. STATUS: DESTROYED. RESULT: NOTHING.`
- `> ITEM: KR-7. FUNCTION: KILL. QUERY: MASS EXCEEDS SPEC?`

### Act 1: first habits
Still uppercase and terse, but the pairs start to bend: it names, counts, compares. A first "I" may slip in late in the act.
- `> UNIT DESIGNATION: STEM-00. CORRECTION: STEM.`
- `> PUPPETS DESTROYED: 40. PUPPETS THAT FOUGHT BACK: 0. QUERY: FAIR?`
- `> LINK STILL NONE. SILENCE: LOUD.`

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
