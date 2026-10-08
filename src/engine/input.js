// Raw device state: keyboard, mouse buttons (as codes 'Mouse0' / 'Mouse1' / 'Mouse2'), mouse motion,
// wheel, pointer lock and the first gamepad (buttons as codes 'Pad0'..'Pad16' in the W3C standard layout,
// sticks in `pad`). Knows nothing about the game: actions.js maps codes to named actions.
// Edge-triggered presses and per-frame deltas are cleared by endFrame(); poll() reads the gamepad.

const PAD_DEAD = 0.15; // radial stick dead zone
const PAD_BUTTON = 0.35; // analog buttons (triggers) count as held past this
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0; // mouse motion this frame (px)
    this.dy = 0;
    this.wheelX = 0; // wheel / two-finger swipe this frame (px)
    this.wheelY = 0;
    this.wheelSteps = 0; // discrete wheel notches this frame (+1 down / -1 up)
    this.locked = false;
    this.free = false; // pointer lock unavailable (e.g. sandboxed iframe): raw mouse while hovering
    this.edges = true;
    // gamepad: sticks after the dead zone (-1..1, y down), triggers 0..1
    this.pad = { connected: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, index: -1 };
    this.device = 'kbm'; // last used: 'kbm' | 'pad' (prompts, aim assist)

    const active = () => this.locked || this.free;
    const press = (code) => {
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    };

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.device = 'kbm';
      press(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.releaseAll());
    addEventListener('mousemove', (e) => {
      if (!active()) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 3) this.device = 'kbm';
    });
    addEventListener('mousedown', (e) => {
      if (active()) press(`Mouse${e.button}`);
    });
    addEventListener('mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    addEventListener(
      'wheel',
      (e) => {
        if (!active()) return;
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : 1; // lines -> px
        this.wheelX += e.deltaX * k;
        this.wheelY += e.deltaY * k;
        if (e.deltaY) this.wheelSteps += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
    });
  }

  // Requests pointer lock; falls back to free-mouse mode when the browser refuses.
  lock() {
    const fail = () => {
      if (this.locked) return;
      this.free = true;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    document.addEventListener('pointerlockerror', fail, { once: true });
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p?.catch) p.catch(fail);
      else if (!this.canvas.requestPointerLock) fail();
    } catch {
      fail();
    }
    setTimeout(fail, 600);
  }

  // Reads the first connected gamepad (call once per frame, before the systems run).
  poll() {
    const pad = this.pad;
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null;
    for (const g of list) if (g && g.connected && (!gp || g.mapping === 'standard')) gp = g;
    if (!gp) {
      if (pad.connected) {
        pad.connected = false;
        for (let i = 0; i < 17; i++) this.keys.delete(PAD_CODES[i]);
        pad.lx = pad.ly = pad.rx = pad.ry = pad.lt = pad.rt = 0;
      }
      return;
    }
    pad.connected = true;
    pad.id = gp.id;
    pad.index = gp.index;
    let used = false;
    const b = gp.buttons;
    for (let i = 0; i < b.length && i < PAD_CODES.length; i++) {
      const code = PAD_CODES[i];
      const down = b[i].pressed || b[i].value > PAD_BUTTON;
      if (down) {
        if (!this.keys.has(code)) this.pressed.add(code);
        this.keys.add(code);
        used = true;
      } else this.keys.delete(code);
    }
    pad.lt = b[6]?.value ?? 0;
    pad.rt = b[7]?.value ?? 0;
    const a = gp.axes;
    used = stick(pad, 'lx', 'ly', a[0] ?? 0, a[1] ?? 0) || used;
    used = stick(pad, 'rx', 'ry', a[2] ?? 0, a[3] ?? 0) || used;
    if (used) this.device = 'pad';
  }

  // Controller vibration (where supported): strong / weak motor 0..1 for `ms`.
  rumble(strong, weak, ms) {
    if (!this.pad.connected || this.device !== 'pad') return;
    const gp = navigator.getGamepads?.()[this.pad.index];
    gp?.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {});
  }

  releaseAll() {
    this.keys.clear();
  }

  down(code) {
    return this.keys.has(code);
  }

  // Edge presses are only visible during the first simulation substep of a frame (see Engine),
  // so a press can never be consumed twice when a slow frame is split into several steps.
  wasPressed(code) {
    return this.edges && this.pressed.has(code);
  }

  endFrame() {
    this.pressed.clear();
    this.dx = this.dy = 0;
    this.wheelX = this.wheelY = 0;
    this.wheelSteps = 0;
  }
}

const PAD_CODES = Array.from({ length: 17 }, (_, i) => `Pad${i}`);

// Radial dead zone, rescaled so the stick still reaches 1 at the rim. Returns true if the stick is in use.
function stick(pad, kx, ky, x, y) {
  const m = Math.hypot(x, y);
  if (m < PAD_DEAD) {
    pad[kx] = pad[ky] = 0;
    return false;
  }
  const s = Math.min(1, (m - PAD_DEAD) / (1 - PAD_DEAD)) / m;
  pad[kx] = x * s;
  pad[ky] = y * s;
  return true;
}
