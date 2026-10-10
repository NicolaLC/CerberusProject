// Key bar (top centre, under the zone label): every debug / tool shortcut that works right now, so none has to be remembered.
// Shown with ?debug (global debug keys + the room's) and in any scene with a Gym tool (the room's keys);
// the tool's static KEYS list is the source, so a key added there shows up here.
const DEBUG_KEYS = [
  ['H', 'skeletons'],
  ['F3 / `', 'stats'],
];

export class KeyHints {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'keyhints';
    document.body.appendChild(this.el);
  }

  // tool: the scene's Gym tool instance or null.
  set({ debug, tool }) {
    const keys = [...(debug ? DEBUG_KEYS : []), ...(tool?.constructor.KEYS ?? [])];
    this.el.hidden = keys.length === 0;
    this.el.replaceChildren(
      ...keys.map(([k, what]) => {
        const span = document.createElement('span');
        const b = document.createElement('b');
        b.textContent = k;
        span.append(b, ` ${what}`);
        return span;
      }),
    );
  }
}
