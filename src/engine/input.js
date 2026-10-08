// Raw device state: keyboard, mouse buttons (as codes 'Mouse0' / 'Mouse1' / 'Mouse2'), mouse motion,
// wheel and pointer lock. Knows nothing about the game: actions.js maps codes to named actions.
// Edge-triggered presses and per-frame deltas are cleared by endFrame().
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

    const active = () => this.locked || this.free;
    const press = (code) => {
      if (!this.keys.has(code)) this.pressed.add(code);
      this.keys.add(code);
    };

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      press(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.releaseAll());
    addEventListener('mousemove', (e) => {
      if (!active()) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
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
