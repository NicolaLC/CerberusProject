import { Game } from './game/game.js';

// Entry point. `?debug` skips the start panel, shows the stats readout and exposes window.game.
const debug = new URLSearchParams(location.search).has('debug');
new Game({ canvas: document.getElementById('game'), debug }).init().then((game) => {
  game.start();
  if (debug) window.game = game;
});
