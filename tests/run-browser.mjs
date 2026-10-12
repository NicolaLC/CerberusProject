// Runs the browser suites (tests/*.browser.mjs) against a vite dev server started here.
// Usage: node tests/run-browser.mjs [--all] [name ...]   (--all adds gym-stress and bench; names filter, e.g. `scenes render`)
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';

const SLOW = ['gym-stress', 'bench'];
const args = process.argv.slice(2);
const all = args.includes('--all');
const names = args.filter((a) => !a.startsWith('--'));
const dir = new URL('.', import.meta.url);
const suites = readdirSync(dir)
  .filter((f) => f.endsWith('.browser.mjs'))
  .map((f) => f.replace('.browser.mjs', ''))
  .filter((n) => (names.length ? names.includes(n) : all || !SLOW.includes(n)));
if (!suites.length) { console.error('no suite matches', names); process.exit(1); }

const server = await createServer({ server: { port: 5173 }, logLevel: 'warn' }); // busy port: vite picks the next free one
await server.listen();
const port = server.httpServer.address().port;
const env = { ...process.env, URL: `http://localhost:${port}/?debug`, BASE: `http://localhost:${port}` };

const run = (name) => new Promise((resolve) => {
  console.log(`\n=== ${name} ===`);
  const c = spawn(process.execPath, [new URL(`${name}.browser.mjs`, dir).pathname], { env, stdio: ['ignore', 'pipe', 'inherit'] });
  let failed = false, buf = '';
  c.stdout.on('data', (d) => {
    process.stdout.write(d);
    const lines = (buf + d).split('\n');
    buf = lines.pop();
    if (lines.some((l) => l.startsWith('FAIL'))) failed = true;
  });
  c.on('close', (code) => resolve(failed || buf.startsWith('FAIL') || code !== 0));
});

const bad = [];
for (const n of suites) if (await run(n)) bad.push(n);
await server.close();
console.log(bad.length ? `\nFAILED: ${bad.join(', ')}` : `\nall ${suites.length} suites passed`);
process.exit(bad.length ? 1 : 0);
