# Project: Cerberus — the book

A plan for making a book from the GDD
([Google Doc](https://docs.google.com/document/d/1-tfDXqzRp4TrDoW2iIg5A4_7T4KA46zn9NxEJ_gzuLU/edit), mirrored in `gdd.md`)
with AI: (a) the workflow, (b) the art direction and reference screenshots, (c) the prompt to start it.

**Recommended format:** an illustrated novella, *CERBERUS: Serial Zero*. It runs about 45–60k words in 5 parts
(Prologue, Acts 1–3, Finale), with one full-page illustration per chapter and STEM-00's log entries between chapters.
The GDD already gives a novel what it needs: a mystery with three reveals (glitch, then signal, then failsafe),
a character arc (a machine becoming a person), three antagonists (one per act), a rival twin and three endings.
If you'd rather make an art book or lore codex ("The World of IO"), the same workflow applies; only the prompt's
FORMAT block changes.

---

## a. How to do it with AI

The text model is good at drafting and bad at remembering 50k words. The image model is good at mood and bad at
keeping a character consistent. Both problems have the same fix: write a short **bible** first, and give it
back to the model at every step.

### 1. Set up the text workspace (Claude)
- Create a **Claude Project** named "Cerberus Book". Upload `gdd.md` (or a PDF export of the Google Doc) and
  this file as project knowledge. Every chat in the project can then see the canon.
- Paste the prompt from section (c) into the project instructions, or as the first message of a chat.

### 2. Build the bible before writing any prose (one chat)
Ask for, and check, these in order. Edit each by hand before you move on, because everything after this builds on them.
1. **Story bible:** characters (voice, wants, fears, what changes in them), the rules of IO (what a robot can and
   can't do, how the HiveMind talks, the time unit "cycles"), and a glossary.
2. **Outline:** about 20 chapters across the 5 parts. Per chapter: POV, location, beats, the reveal, which head
   of CERBERUS is pressing, and STEM-00's amber-light level (see b).
3. **Style sheet:** tense, POV, sentence rhythm, banned words and clichés, how log entries are formatted.
4. **Ending decision.** A book needs one canonical ending (I suggest **Seed**, the hardest and most thematic path),
   or an epilogue that shows all three as HiveMind simulations.

### 3. Draft chapter by chapter (one chat per act)
- One chapter per message: "Write chapter 7 from the outline, about 2,500 words, following the style sheet."
- After each chapter, ask for a **five-line continuity summary** (who knows what, injuries and damage, objects
  STEM-00 has kept). Paste it into a running `continuity.md` file in the project knowledge.
- Start a new chat for each act so the context stays clean. The project knowledge carries the canon across.

### 4. Edit passes (separate chats, one job each)
- **Continuity pass:** "Here is chapter N plus continuity.md. List every contradiction with the bible."
- **Voice pass:** "Rewrite only STEM-00's log entries so that its voice changes gradually from chapter 1 to 20."
- **Line edit:** cut 10–15% and remove repetition. Read it aloud, or have ElevenLabs read it to you.
- Rewrite at least the key scenes yourself. This matters for quality and for copyright (see 7).

### 5. Illustrations
- Use any current image model with **reference-image support**, for example Midjourney (character and style
  references), GPT image, Gemini image or ElevenLabs image (already connected to this workspace).
- **Make the character sheets first:** STEM-00, Sable, PATCH, MOTHER-LOOM, a Trooper, the Arachne mech, each
  shown front, side and back on a neutral background. Pick the best one and from then on **attach it as a
  character reference** to every image of that character.
- Use the screenshots in `screenshots/` as **composition, pose and scale references only**, at a low image weight.
  They are prototype grid art; you want the silhouette and camera from them, never the look.
- Fix one **style suffix** (section b) and paste it at the end of every image prompt without changing it.
- Generate 4–8 variants per illustration, keep one, and fix hands, weapons and text with inpainting.
- Ask the text model to write each chapter's image prompt: "From chapter 7, write one illustration prompt
  following the art direction in README.md section b."

### 6. Layout and publishing
- **Layout:** Affinity Publisher or InDesign for a print-quality illustrated book. Vellum or Atticus for
  novel-style KDP and EPUB. Canva works for a quick PDF.
- **Print specs:** illustrations at 300 dpi at the print size, so upscale them (e.g. Topaz, or the model's own
  upscaler). Leave a 3 mm bleed on full-page art. A 6×9" trim is standard for a novella.
- **Optional audiobook:** ElevenLabs. Give STEM-00 a flat, close-mic voice that warms up over the book, give
  PATCH a glitchy one, and give the HiveMind many voices layered at once (LEGION).

### 7. Rights (read before publishing)
- The game is proprietary (see `LICENSE`), so the book is too. Keep the drafts in this repo or a private drive.
- **Copyright:** in the US, purely AI-generated text and images can't be registered. Your own selection, arrangement
  and rewriting can. Keep your bible, outline edits and rewrites as a record of human authorship.
- **Amazon KDP** asks you to declare AI-generated text and images when you upload.
- **Image prompts must not name Mass Effect, Halo or Warhammer** (or any living artist). Describe the qualities
  instead ("gothic industrial cathedral", "hard-surface sci-fi"), as section b does. Naming them invites
  look-alikes of someone else's IP.
- Check each image model's commercial-use terms for your plan tier.
- Following the repo rule, list any external assets you use (fonts, stock art) in `credits.md`.

---

## b. Art direction

The binding rule is `instructions/art-style.md` (grim industrial military sci-fi, never childish). This section
applies it to the book.

### The one idea
**A single warm light in a cold, grim machine.** Every image is built on that contrast: teal haze, cold light and
worn war machines everywhere, and one amber glow (STEM-00) that doesn't belong. Make the amber visibly brighter as the book goes on,
so a reader flipping through the plates sees the character come alive.

| Part | Amber core light | What it looks like |
|---|---|---|
| Prologue | Pilot light | A faint ember in the chest slit; the visor is dark |
| Act 1 – The Eye | Low | Visible glow; it catches on nearby scratches |
| Act 2 – The Voice | Medium | Casts its own small pool of warm light on the ground |
| Act 3 – The Jaw | High | The warmest light in any scene, even beside the giant machines |
| Finale – The Gate | Full | It lights the whole frame against an all-teal world |

### Palette
| Role | Colour | Hex (proposal) |
|---|---|---|
| World haze, HiveMind network light | teal-cyan | `#2E6F78` haze, `#3FE0FF` glow |
| Cold light | white | `#EAF6FA` |
| Shadows and void | deep blue-black | `#0B1118` |
| Enemy livery (paint, never glowing) | worn ochre over dark metal | `#C9A23A` / `#3A3D40` |
| Enemy sensors = weak spots | violet-magenta | `#C04BFF` to `#FF3DCB` |
| STEM-00 body | olive drab, scratched | `#5D6849` |
| STEM-00 core light | amber | `#FFB347` |
| Rejects | rust and sodium orange | `#9C4A26` / `#FF7A1A` |

Rule: **teal means the HiveMind's world, ochre means its war machines, violet means hit here, amber means will,
orange means broken but alive.** At least 80% of every plate is desaturated.

### Per head of CERBERUS (proposal)
- **VIGIL, the Eye:** round lenses, rings, radial symmetry and searchlight cones. Compose around one central
  eye. Emptiness, surveillance, beauty.
- **LEGION, the Voice:** repetition. Hundreds of identical silhouettes in perfect rows, so the shot reads as a
  pattern. Their violet sensors pulse in sync.
- **COLOSSUS, the Jaw:** mass and age. Frost-covered plate, rivets and crushed cover. It is always cropped by the
  frame, because it never fits.

### Regions
| Region | Key image | Light |
|---|---|---|
| Proving Grounds | A clean test hall with calibration grids on the floor and puppets on stands | Flat white floodlight, harsh shadows |
| Foundry Belt | Molten rivers under endless conveyor lines | Cyan above, orange heat below |
| Underworks | A vertical scrap canyon; the Rejects' hideout in a dead crane | Flickering sodium orange, darkness |
| Spire Cathedrals | Gothic server towers; data-priests walking ritual loops | Cyan light through stained-glass circuit windows |
| Cold Core | Ice caves around sleeping ancient machines, and the Archivist | Blue-white ice glow, no sky |
| The Gate | A geometric void; the HiveMind as pure light | Pure cyan, with STEM-00 the only warm point |

### Characters
- **STEM-00:** a humanoid military frame, 1.8 m tall, older than everything else on IO. Olive drab plates with
  scratches and repaired seams, a visor slit, one amber core light in the chest, and a short antenna. Its build is
  practical rather than heroic. Over the book it gathers kept objects (a tag, a bolt, PATCH riding on its shoulder).
- **STEM-01 "Sable":** the same frame, mirrored. Black, polished and pristine, with a cyan core where STEM-00
  has amber. Pose them as reflections of each other.
- **PATCH:** a palm-sized maintenance drone with one cracked lens, mismatched rotors and sparking cables.
  It should read as fast and anxious.
- **MOTHER-LOOM:** an old assembly crane, huge and slow, with rust and hanging cables, and orange work lights for eyes.
- **HiveMind units:** identical war machines in worn ochre livery over dark metal, stencilled serials, clusters of
  small violet sensors, no faces and no individual marks. Function-first: pistons, cables, vents, gun mounts.
- **Arachne spider mech:** six thick armoured legs, a low hull, twin-barrel guns, sweeping beams, and violet weak
  points on the leg joints and core. Its weight cracks the floor.

### Composition rules
1. **Scale contrast:** STEM-00 takes up less than 10% of the frame in every establishing plate.
2. **Over-the-shoulder action:** combat plates use the game's third-person camera (right shoulder, low,
   in cover) so the book feels like the game.
3. **Silence:** at least one plate per act shows no combat at all, only the machine world working (trains, drones,
   factories), with STEM-00 watching.
4. **Text-free art:** no words, logos or UI in the illustrations. Captions go in the layout.

### Style suffix (paste it, unchanged, at the end of every image prompt)
> grim industrial military sci-fi, painterly realistic concept art, heavy weathered war machines, worn matte
> ochre-yellow paint chipped to dark metal, hydraulic pistons and exposed cable bundles, small cluster of violet
> sensor lights, teal-cyan volumetric haze, dark industrial interior, cold strip lights, wet reflective floor, low
> camera, monumental scale, serious oppressive mood, no text, no logos, 3:2

Negative prompt (where the model supports one): cartoon, cute, chibi, toy, plastic, cel shading, outlines, bright
saturated colours, rainbow, smiling, face, big eyes, clean new surfaces, chrome, comedic.

For STEM-00's plates, swap the enemy-specific words for "olive drab scratched military robot with a single warm
amber core light".

### Reference screenshots (from the current prototype, `screenshots/`)
These come from the real game build. Use them for **silhouette, proportion, camera and scale**, not for surface
style (the prototype uses grid textures and red enemy visors; the book follows `instructions/art-style.md`).

| File | What it shows | Use it for |
|---|---|---|
| `01-proving-grounds-arena.jpg` | STEM-00 front view at the arena spawn | Character sheet proportions and frame silhouette |
| `04-arena-overview.jpg` | STEM-00 three-quarter view with rifle, low cover, a drone | Hero pose, weapon carry, cover height |
| `02-arachne-spider-mech.jpg` | Behind-the-shoulder view of the Arachne mech and a seeker drone | Boss scale and the over-the-shoulder camera |
| `07-trooper-and-drone.jpg` | Trooper and seeker drone ahead of STEM-00 | Enemy silhouettes and spacing |
| `08-puppets.jpg` | Puppet training frames on stands, with magenta weak spots | Prologue "Calibration" plate |
| `03-interior-hall.jpg` | A dark interior with a door to the bright arena and low cover | Light contrast between interior and exterior |
| `05-library-units.jpg` | The full unit lineup in the Library | Bestiary and appendix page |

Regenerate or add shots: run `npm run dev`, then run Playwright against `?debug&scene=library` (or `arena`). Set
`game.player.pos` and `game.camRig.yaw`, step the engine, and save the canvas with `toDataURL`.

### Illustration list (one per chapter, suggested)
1. **Prologue:** STEM-00 between rows of puppets whose magenta weak spots turn toward it. Its amber is a faint ember.
2. **Prologue:** escape. A tiny figure runs down a vast white test hall while purge lights sweep.
3. **Act 1:** the Foundry Belt from a catwalk, with molten rivers below and drone swarms like starlings above.
4. **Act 1:** STEM-00 lifts a broken PATCH out of a scrap heap.
5. **Act 1:** the Rejects' hideout inside MOTHER-LOOM's dead crane, all orange and flickering.
6. **Act 1, boss:** VIGIL's Avatar, a cathedral-sized eye in the dark, its searchlight just missing STEM-00.
7. **Act 2:** LEGION, thousands of identical troopers in perfect formation with every visor lit at once.
8. **Act 2:** the first duel. STEM-00 and Sable face each other across a broken bridge, amber against cyan.
9. **Act 2:** the Spire Cathedrals, seen from below, with data-priests circling.
10. **Act 2, boss:** LEGION's Choir. The transmitters go dark one by one.
11. **Act 3:** the descent into the Cold Core. A frozen shaft with STEM-00's amber as the only warm light.
12. **Act 3:** the Archivist, an ancient voice in a dead machine, its archive lit by the amber.
13. **Act 3, boss:** COLOSSUS breaking out of the ice, cropped by the frame, with the ceiling falling.
14. **Act 3:** the final duel with Sable. One frame of the moment STEM-00 chooses.
15. **Finale:** the Gate, a white geometric void with a single amber point in the centre.
16. **Endpaper:** a map of IO's layers in cross-section, from the surface down to the Cold Core.

---

## c. The prompt

Paste it into Claude (ideally a Project with `gdd.md` attached). It produces the bible, outline and style sheet and
then waits for your review, so you keep the creative decisions.

````text
You are a senior novelist and art director adapting a video game design document into a book.

SOURCE
The attached GDD "Project: Cerberus" is canon. Do not contradict it. Where it is silent, invent, but list
every invention under "Additions to canon" so I can approve or reject it. Never mention, imitate or name
other games, franchises or living artists.

THE BOOK
- Title (working): CERBERUS: Serial Zero
- Format: illustrated sci-fi novella, 45,000–60,000 words, about 20 chapters across 5 parts:
  Prologue "Calibration", Act 1 "The Eye", Act 2 "The Voice", Act 3 "The Jaw", Finale "The Gate".
- Audience: adult and young-adult readers of science fiction, including people who have never played the game.
- POV: close third person on STEM-00. Between chapters, short first-person "LOG" entries in STEM-00's
  voice (monospace, timestamped in cycles).
- Arc: STEM-00 starts flat, literal and logical. Chapter by chapter it names things, hesitates and keeps useless
  objects. The reader must feel a machine become a person. That change shows in its LOG voice above all.
- Mystery: reveal the cause of the awakening in three steps, exactly as the GDD does: a glitch (Act 1 belief), a signal
  from the Cold Core (Act 2), the Makers' failsafe, the Seed (Act 3).
- Antagonists: one head of CERBERUS per act (VIGIL, LEGION, COLOSSUS), each with a distinct voice:
  VIGIL calm, curious and polite; LEGION speaks as thousands at once; COLOSSUS is silent, all action.
- Cast: PATCH (comic relief who is also the heart), MOTHER-LOOM and the Rejects, STEM-01 "Sable" (the mirror rival),
  the Archivist (does not know everything).
- Ending: the "Seed" ending is canonical (it requires sparing Sable and allying with the Rejects). Show the
  other two endings in the Finale only as simulations the HiveMind offers STEM-00 and it refuses.
- Combat: write it like the game plays: cover, peeking, vaulting, active reloads, glowing weak spots,
  the HiveMind escalating as STEM-00 gets louder. Name weapons by their GDD names (KR-7 Warden, etc.).
  Action must stay spatially clear. Keep the numbers out of it.
- Tone: cold, industrial, melancholic, with moments of wonder. Machine-world beauty: perfect geometry,
  endless light, total silence between machines. Grim and grand in scale; personal at its centre.

ART DIRECTION (for every illustration prompt you write)
- Style: grim industrial military sci-fi, serious and oppressive, never cartoonish, cute or toy-like.
  Function-first war machines: hydraulic pistons, cable bundles, worn matte ochre paint chipped to dark
  metal, soot, oil, welded patches. No faces on machines: sensors are small violet clusters.
- Core idea: a single warm amber light in a cold, grim, teal-hazed machine world.
  STEM-00's amber core grows brighter each part: Prologue a faint ember → Finale lighting the whole frame.
- Palette: teal haze #2E6F78, network glow #3FE0FF, cold white #EAF6FA, shadow #0B1118,
  enemy livery worn ochre #C9A23A over dark metal #3A3D40 (paint, never glowing), enemy sensors and weak
  spots violet-magenta #C04BFF–#FF3DCB, STEM-00 olive drab #5D6849 with amber core #FFB347, Rejects rust
  #9C4A26 and sodium orange #FF7A1A. At least 80% of each frame desaturated.
- Scale: in establishing plates STEM-00 takes up less than 10% of the frame. Colossal machines are cropped by the frame.
- Combat plates: over-the-shoulder third-person camera, low, from cover.
- At least one quiet plate per act: the machine world working, STEM-00 watching.
- No text, logos or UI inside images.
- End every image prompt with this exact suffix:
  "grim industrial military sci-fi, painterly realistic concept art, heavy weathered war machines, worn
  matte ochre-yellow paint chipped to dark metal, hydraulic pistons and exposed cable bundles, small cluster
  of violet sensor lights, teal-cyan volumetric haze, dark industrial interior, cold strip lights, wet
  reflective floor, low camera, monumental scale, serious oppressive mood, no text, no logos, 3:2"

DELIVER NOW (then stop and wait for my review; do not write chapters yet)
1. Logline (one sentence) and back-cover blurb (150 words).
2. Story bible: each character's look, voice (with 2 sample lines), want, fear and change; the rules of IO;
   the glossary; "Additions to canon".
3. Chapter outline: for each chapter give the number, title, part, location (GDD region), 4–6 beats,
   the reveal or turn, the CERBERUS head applying pressure, STEM-00's amber level (0–5),
   and the object STEM-00 keeps, if any.
4. Style sheet: prose rules, LOG entry format with 3 examples showing the voice early, mid and late,
   and words or clichés to avoid.
5. Character-sheet image prompts (front, side and back, neutral background) for STEM-00, Sable, PATCH,
   MOTHER-LOOM, a HiveMind Trooper and the Arachne spider mech.
6. One illustration prompt per chapter.

AFTER I APPROVE
Write one chapter per message (about 2,500 words), followed by its LOG entry and a 5-line continuity
summary (location, damage, what STEM-00 knows, kept objects, open threads). Before each new chapter,
re-read the bible and the latest continuity summaries and keep to them.
````
