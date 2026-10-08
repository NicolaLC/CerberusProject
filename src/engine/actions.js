// Action map: named actions bound to one or more device codes (see Input for code names).
// Game code asks "is `fire` held?", never "is Mouse0 down?", so rebinding is a data change.
export class Actions {
  constructor(input, bindings) {
    this.input = input;
    this.bindings = bindings;
  }

  held(action) {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) if (this.input.down(codes[i])) return true;
    return false;
  }

  pressed(action) {
    const codes = this.bindings[action];
    for (let i = 0; i < codes.length; i++) if (this.input.wasPressed(codes[i])) return true;
    return false;
  }

  // -1..1 from two opposing actions
  axis(neg, pos) {
    return (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
  }
}
