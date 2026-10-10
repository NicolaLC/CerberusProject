import { Actions } from '../engine/actions.js';
import { settings } from './settings.js';
import { getCurrentBindings, initBindings } from './accessibility.js';

// Gamepad buttons use the W3C standard layout (Xbox names): Pad0 A, Pad1 B, Pad2 X, Pad3 Y, Pad4 LB, Pad5 RB,
// Pad6 LT, Pad7 RT, Pad8 View/Back, Pad9 Menu/Start, Pad10 L3, Pad11 R3, Pad12-15 d-pad up/down/left/right.

const KEY_LOOK = { x: 900, y: 500 }; // px/s equivalent for arrow-key look
// Right stick look, in mouse px/s at full tilt: a curve for fine aim near the center, and a turn boost when the
// stick is held at the rim (quick 180s without making small corrections twitchy).
const PAD_LOOK = { x: 1150, y: 650, curve: 2.2, boostAfter: 0.25, boost: 1.7, boostIn: 0.3 };

export class Controls {
  constructor(input) {
    this.input = input;
    // Get current bindings (user + defaults)
    this.bindings = getCurrentBindings();
    this.actions = new Actions(input, this.bindings);
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
    } else if (a.pressed('aim')) {
      this.aimLatched = false; // a held aim takes over
    } else if (a.pressed('aimToggle')) {
      this.aimLatched = !this.aimLatched; // E toggles: hard to hold a click while swiping
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
}

// Re-export for backward compatibility
export { initBindings, getCurrentBindings } from './accessibility.js';
