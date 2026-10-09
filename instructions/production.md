# Production approach

Decided: build **foundations first**, then compose missions from them. Three core scenes:

| Scene | Purpose |
| --- | --- |
| **Gym** | Each mechanic tested on its own on bare grid geometry. Measures the **metrics** every level must respect, then freezes them. Gym rooms double as browser-test fixtures. |
| **Library** | Catalog of every piece (enemies, guns, cover/environment kit, props, pickups, light presets), each spawned by id. Shows what exists; a test spawns every id. |
| **Workshop** | In-game editor (behind `?debug`): place Library pieces, play in place, save a level file. Levels and missions are Workshop output, not code. |

## Order
1. Backbone: piece registry (spawn by id) + level file format + scene switcher.
2. Gym, with the metrics written down and frozen.
3. Library with the pieces that exist today.
4. Minimal Workshop: place, play, save, load.
5. Grow the Library (new enemies, guns, region kits), each tuned in a Gym room first.
6. Compose the Prologue in the Workshop, then the acts.

## Rules
- A piece is done only when it is in the Library **and** tested in a Gym room.
- Kits are built on the frozen metrics; changing a metric means listing the kits to update.
- Exit of the foundations phase: the Prologue is built in the Workshop from Library pieces only. Anything
  that can't be built that way goes back into the foundations, not hard-coded into the mission.

## GitHub
Epics carry the `epic` label plus `phase: foundations` or `phase: composition`; work items are their sub-issues.
Foundations: Backbone #57, Gym #58, Library #59 (with Enemy roster #4 and Arsenal #6), Workshop #60, HiveMind AI #3.
Composition: Prologue #2, Bosses #5, Progression #7, Narrative #8, World #9, Art and audio #10, Game shell #11.
Story and world reference: the GDD (Google Docs, "GDD – Project: Cerberus (expanded draft)").
