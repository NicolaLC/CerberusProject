// Workshop level file I/O (#72). Contract shared by the editor (#70): the edited level is a plain level object
// (instructions/level.md format); these functions turn it into a file and back. Stubs until #72 lands.

// Level object -> diff-friendly JSON text (top-level keys one per line, one piece per line).
export function serializeLevel(level) {
  return `${JSON.stringify(level, null, 2)}\n`;
}

// JSON text -> level object, validated with registry.check (throws a readable error on a bad file).
export function parseLevel(text, registry) {
  const level = JSON.parse(text);
  return registry ? registry.check(level) : level;
}

// Save: Electron writes src/levels/<name>.json directly; the web build downloads the file. Resolves to where it went.
export async function saveLevel(level) {
  throw new Error('saveLevel: not implemented yet (#72)');
}

// Load: asks the user for a level file (file picker on the web, dialog on the desktop). Resolves to a level object.
export async function openLevel(registry) {
  throw new Error('openLevel: not implemented yet (#72)');
}
