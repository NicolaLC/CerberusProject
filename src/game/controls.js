import { Actions } from '../engine/actions.js';
import { settings } from './settings.js';

// Every binding in the game lives here. Gameplay reads intents from Controls, never device codes.
// Gamepad buttons use the W3C standard layout (Xbox names): Pad0 A, Pad1 B, Pad2 X, Pad3 Y, Pad4 LB, Pad5 RB,
// Pad6 LT, Pad7 RT, Pad8 View/Back, Pad9 Menu/Start, Pad10 L3, Pad11 R3, Pad12-15 d-pad up/down/left/right.
export const BINDINGS = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  run: ['ShiftLeft', 'ShiftRight'],
  padSprint: ['Pad10'], // L3 click: sprint until the stick is released
  aim: ['Mouse2', 'Pad6'], // hold (mouse, LT) / toggle (trackpad)
  aimToggle: ['KeyE'], // trackpad mode only
  fire: ['Mouse0', 'KeyF', 'Pad7'],
  reload: ['KeyR', 'Pad2'],
  cover: ['Space', 'Pad0'],
  shoulder: ['KeyQ', 'Pad4'],
  nextGun: ['Pad3', 'Pad5'],
  slot1: ['Digit1', 'Pad14'],
  slot2: ['Digit2', 'Pad12'],
  slot3: ['Digit3', 'Pad15'],
  pause: ['Pad9'],
  lookLeft: ['ArrowLeft'],
  lookRight: ['ArrowRight'],
  lookUp: ['ArrowUp'],
  lookDown: ['ArrowDown'],
  skeleton: ['KeyH'],
  stats: ['F3', 'Backquote', 'Pad8'],
};

const KEY_LOOK = { x: 900, y: 500 }; // px/s equivalent for arrow-key look
// Right stick look, in mouse px/s at full tilt: a curve for fine aim near the center, and a turn boost when the
// stick is held at the rim (quick 180s without making small corrections twitchy).
const PAD_LOOK = { x: 1150, y: 650, curve: 2.2, boostAfter: 0.25, boost: 1.7, boostIn: 0.3 };

export class Controls {
  constructor(input) {
    this.input = input;
    this.actions = new Actions(input, BINDINGS);
    this.aimLatched = false; // trackpad aim toggle
    this.sprintLatched = false; // gamepad: L3 starts a sprint that lasts while the stick is pushed
    this.rim = 0; // seconds the right stick has been at the rim
  }

  get pad() {
    return this.input.device === 'pad';
  }

  // Once per frame, before gameplay (pre phase).
  update() {
    const a = this.actions;
    if (!settings.trackpad || !(this.input.locked || this.input.free)) {
      this.aimLatched = false;
    } else if (a.pressed('aimToggle') || a.pressed('aim')) {
      this.aimLatched = !this.aimLatched; // E or two-finger click toggles: hard to hold a click while swiping
    }
    const p = this.input.pad;
    if (a.pressed('padSprint')) this.sprintLatched = !this.sprintLatched;
    if (Math.hypot(p.lx, p.ly) < 0.3 || p.ly > -0.2) this.sprintLatched = false;
  }

  // Move intent: keys, plus the left stick (analog: partial tilt walks slower). Length <= 1.
  move(out = { x: 0, y: 0 }) {
    const p = this.input.pad;
    out.x = this.actions.axis('left', 'right') + p.lx;
    out.y = this.actions.axis('back', 'forward') - p.ly;
    const m = Math.hypot(out.x, out.y);
    if (m > 1) {
      out.x /= m;
      out.y /= m;
    }
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
    const p = i.pad;
    const m = Math.hypot(p.rx, p.ry);
    if (m > 0) {
      this.rim = m > 0.95 ? this.rim + realDt : 0;
      const boost = 1 + (PAD_LOOK.boost - 1) * Math.min(1, Math.max(0, this.rim - PAD_LOOK.boostAfter) / PAD_LOOK.boostIn);
      const k = (Math.pow(m, PAD_LOOK.curve) / m) * boost * realDt;
      out.x += p.rx * PAD_LOOK.x * k;
      out.y += p.ry * PAD_LOOK.y * k * (settings.padInvertY ? -1 : 1);
    } else this.rim = 0;
    return out;
  }

  get aiming() {
    return settings.trackpad ? this.aimLatched : this.actions.held('aim');
  }

  get running() {
    return this.actions.held('run') || this.sprintLatched;
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
    if (this.actions.pressed('slot3')) return 2;
    return -1;
  }

  // Mouse wheel cycles weapons (+1 / -1) except in trackpad mode, where the wheel looks around; Y / RB: next.
  get cycle() {
    if (this.actions.pressed('nextGun')) return 1;
    if (settings.trackpad || !this.input.edges) return 0;
    return Math.sign(this.input.wheelSteps);
  }
}
