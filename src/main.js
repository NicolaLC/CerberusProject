import { Game } from './game/game.js';

// Entry point. `?debug` skips the start panel, shows the stats readout and exposes window.game.
// `?scene=<name>` opens a scene directly (src/game/scenes.js); no flag = the arena.
const params = new URLSearchParams(location.search);
const debug = params.has('debug');
const game = new Game({ canvas: document.getElementById('game'), debug, scene: params.get('scene') }).start();
if (debug) window.game = game;
