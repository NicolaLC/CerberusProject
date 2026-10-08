import { Actions } from '../engine/actions.js';
import { settings } from './settings.js';

// Every binding in the game lives here. Gameplay reads intents from Controls, never device codes.
export const BINDINGS = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  run: ['ShiftLeft', 'ShiftRight'],
  aim: ['Mouse2'], // hold (mouse) / toggle (trackpad)
  aimToggle: ['KeyE'], // trackpad mode only
  fire: ['Mouse0', 'KeyF'],
  reload: ['KeyR'],
  cover: ['Space'],
  shoulder: ['KeyQ'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  skeleton: ['KeyH'],
  stats: ['F3', 'Backquote'],
};

const KEY_LOOK = { x: 900, y: 500 }; // px/s equivalent for arrow-key look

export class Controls {
  constructor(input) {
    this.input = input;
    this.actions = new Actions(input, BINDINGS);
    this.aimLatched = false; // trackpad aim toggle
  }

  // Once per frame, before gameplay (pre phase).
  update() {
    const a = this.actions;
    if (!settings.trackpad || !(this.input.locked || this.input.free)) {
      this.aimLatched = false;
    } else if (a.pressed('aimToggle') || a.pressed('aim')) {
      this.aimLatched = !this.aimLatched; // E or two-finger click toggles: hard to hold a click while swiping
    }
  }

  move(out = { x: 0, y: 0 }) {
    out.x = this.actions.axis('left', 'right');
    out.y = this.actions.axis('back', 'forward');
    return out;
  }

  // Look delta in mouse pixels for this frame (mouse, trackpad swipe, arrow keys).
  look(realDt, out = { x: 0, y: 0 }) {
    const i = this.input;
    out.x = i.dx + this.actions.axis('lookLeft', 'lookRight') * KEY_LOOK.x * realDt;
    out.y = i.dy + this.actions.axis('lookUp', 'lookDown') * KEY_LOOK.y * realDt;
    if (settings.trackpad) {
      out.x += i.wheelX;
      out.y += i.wheelY;
    }
    return out;
  }

  get aiming() {
    return settings.trackpad ? this.aimLatched : this.actions.held('aim');
  }

  get running() {
    return this.actions.held('run');
  }

  get firing() {
    return this.actions.held('fire');
  }

  get firePressed() {
    return this.actions.pressed('fire');
  }

  get reloadPressed() {
    return this.actions.pressed('reload');
  }

  get coverPressed() {
    return this.actions.pressed('cover');
  }

  pressed(action) {
    return this.actions.pressed(action);
  }

  // Weapon slot index pressed this frame (0-based) or -1.
  get slotPressed() {
    if (this.actions.pressed('slot1')) return 0;
    if (this.actions.pressed('slot2')) return 1;
    return -1;
  }

  // Mouse wheel cycles weapons (+1 / -1) except in trackpad mode, where the wheel looks around.
  get cycle() {
    if (settings.trackpad || !this.input.edges) return 0;
    return Math.sign(this.input.wheelSteps);
  }

  // Short label of the aim input for prompts.
  get aimLabel() {
    return settings.trackpad ? 'E' : 'RMB';
  }
}
