// Synchronous publish/subscribe bus. Gameplay emits facts ("puppet:down"), presentation and other
// systems react. Emitters never know who listens, so systems stay decoupled and individually testable.
// A throwing listener is isolated: it is logged and the remaining listeners still run.
export class Events {
  #map = new Map();

  on(type, fn) {
    let list = this.#map.get(type);
    if (!list) this.#map.set(type, (list = []));
    list.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const list = this.#map.get(type);
    const i = list ? list.indexOf(fn) : -1;
    if (i >= 0) list.splice(i, 1);
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
