// Synchronous publish/subscribe bus. Gameplay emits facts ("puppet:down"), presentation and other
// systems react. Emitters never know who listens, so systems stay decoupled and individually testable.
// A throwing listener is isolated: it is logged and the remaining listeners still run.
export class Events {
  #map = new Map();

  on(type, fn) {
    let list = this.#map.get(type);
    if (!list) list = [];
    this.#map.set(type, list.concat(fn)); // copy-on-write (see off)
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.#map.get(type);
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) this.#map.set(type, list.toSpliced(i, 1)); // copy-on-write: an emit in progress keeps its array
  }

  emit(type, data) {
    const list = this.#map.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](data);
      } catch (err) {
        console.error(`[events] listener for "${type}" failed`, err);
      }
    }
  }
}
