// Workshop level file I/O (#72). Contract shared by the editor (#70): the edited level is a plain level object
// (instructions/level.md format); these functions turn it into a file and back. Format and rules: level.md, Save and load.
import { SCENES } from '../scenes.js';

const NAME_RE = /^[a-z0-9-]+$/; // a level name is a file name: nothing that can climb out of src/levels
const TOP_FIRST = ['name', 'title', 'tool', 'demo', 'spawn', 'interiorZones']; // then any other keys, then pieces
const PIECE_KEYS = ['id', 'name', 'pos', 'yaw', 'params'];

// 4 decimals: float noise (1.2000000000000028) never reaches a file, and 0.0001 m is far below anything visible.
const round = (n) => {
  if (!Number.isFinite(n)) throw new Error(`level: cannot save the number ${n}`);
  return Math.round(n * 1e4) / 1e4 || 0; // `|| 0` turns -0 into 0
};
const compact = (v) => JSON.stringify(v, (_, x) => (typeof x === 'number' ? round(x) : x));

// Level object -> diff-friendly JSON text: top-level keys one per line, one piece per line, a trailing newline.
// Key order is fixed, so saving an unchanged level gives an unchanged file.
export function serializeLevel(level) {
  const { pieces = [], ...rest } = level;
  const keys = [...TOP_FIRST.filter((k) => k in rest), ...Object.keys(rest).filter((k) => !TOP_FIRST.includes(k))];
  const lines = keys.filter((k) => rest[k] !== undefined).map((k) => `  ${JSON.stringify(k)}: ${compact(rest[k])}`);
  const rows = pieces.map((p) => {
    const ordered = {};
    for (const k of [...PIECE_KEYS, ...Object.keys(p).filter((k) => !PIECE_KEYS.includes(k))]) {
      if (p[k] !== undefined) ordered[k] = p[k];
    }
    return `    ${compact(ordered)}`;
  });
  lines.push(`  "pieces": [${rows.length ? `\n${rows.join(',\n')}\n  ` : ''}]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}

// Line of a JSON syntax error. Node words it three ways: "at position N", "(line N ...)", or (Unexpected token) with a
// quoted window of the text, ten characters either side of the error. Returns 0 when it can't tell.
function jsonErrorLine(message, text) {
  const pos = /position (\d+)/.exec(message)?.[1];
  if (pos !== undefined) return text.slice(0, Number(pos)).split('\n').length;
  const line = /\(line (\d+)/.exec(message)?.[1];
  if (line) return Number(line);
  const m = /^Unexpected token '(.)', (\.\.\.)?"([\s\S]*)"(?:\.\.\.)? is not valid JSON$/.exec(message);
  if (!m) return 0;
  const at = text.indexOf(m[3]);
  return at < 0 ? 0 : text.slice(0, at + (m[2] ? 10 : Math.max(0, m[3].indexOf(m[1])))).split('\n').length;
}

// JSON text -> level object, validated with registry.check. Throws errors that name the problem (JSON errors: the line).
export function parseLevel(text, registry) {
  let level;
  try {
    level = JSON.parse(text);
  } catch (e) {
    const line = jsonErrorLine(e.message, text);
    throw new Error(`level file is not valid JSON${line ? ` (line ${line})` : ''}: ${e.message}`);
  }
  if (level === null || typeof level !== 'object' || Array.isArray(level)) throw new Error('level: the file must hold a JSON object');
  if (Array.isArray(level.pieces)) {
    const bad = level.pieces.findIndex((p) => p === null || typeof p !== 'object' || Array.isArray(p));
    if (bad >= 0) throw new Error(`level: piece #${bad} must be an object`);
  }
  return registry ? registry.check(level) : level;
}

const abort = (what) => Object.assign(new Error(`${what} canceled`), { name: 'AbortError' });

// Save: Electron writes src/levels/<name>.json (save dialog in a packaged app); the web build downloads the file.
// Resolves to { where: 'repo' | 'dialog' | 'download', path? }. Rejects with an AbortError when the dialog is canceled.
export async function saveLevel(level) {
  const name = level?.name;
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error(`level name "${name}" is not a file name (use a-z, 0-9 and -)`);
  const text = serializeLevel(level);
  const desktop = globalThis.window?.cerberusDesktop;
  if (desktop?.saveLevel) {
    const res = await desktop.saveLevel(name, text);
    if (res?.canceled) throw abort('save');
    return { where: res.where, path: res.path };
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { where: 'download' };
}

// Load: asks the user for a level file (file picker on the web, dialog on the desktop). Resolves to the parsed, checked
// level; rejects with a readable error (AbortError when the user cancels).
export async function openLevel(registry) {
  const desktop = globalThis.window?.cerberusDesktop;
  if (desktop?.openLevel) {
    const file = await desktop.openLevel();
    if (!file) throw abort('open');
    return parseLevel(file.text, registry);
  }
  const text = await new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.hidden = true;
    input.addEventListener('change', () => {
      const f = input.files[0];
      input.remove();
      if (!f) return reject(abort('open'));
      f.text().then(resolve, () => reject(new Error(`could not read "${f.name}"`)));
    });
    input.addEventListener('cancel', () => {
      input.remove();
      reject(abort('open'));
    });
    document.body.append(input);
    input.click();
  });
  return parseLevel(text, registry);
}

// Names of the bundled scenes (scenes.js), so the editor can open any of them (the arena too) for editing.
export function levelNames() {
  return Object.keys(SCENES);
}
