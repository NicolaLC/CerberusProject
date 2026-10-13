// Runs the browser suites (tests/*.browser.mjs) against a vite dev server started here.
// Usage: node tests/run-browser.mjs [--all] [-j N] [name ...]   (--all adds gym-stress and bench; names filter, e.g. `scenes render`)
// Suites run in parallel, each in its own browser: -j N (or BROWSER_JOBS) sets how many at once, default cores - 1.
// Output is buffered per suite and printed whole when it ends. The slow suites (gym-stress, bench) always run alone, after the rest.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';

const SLOW = ['gym-stress', 'bench'];
const LONG = ['scenes', 'workshop', 'render', 'gym-ai', 'prologue']; // started first so the pool doesn't end on one long suite
const args = process.argv.slice(2);
const all = args.includes('--all');
const jAt = args.indexOf('-j');
const jobs = Math.max(1, Number(jAt >= 0 ? args[jAt + 1] : process.env.BROWSER_JOBS) || availableParallelism() - 1);
const names = args.filter((a, i) => !a.startsWith('-') && (jAt < 0 || i !== jAt + 1));
const dir = new URL('.', import.meta.url);
const suites = readdirSync(dir)
  .filter((f) => f.endsWith('.browser.mjs'))
  .map((f) => f.replace('.browser.mjs', ''))
  .filter((n) => (names.length ? names.includes(n) : all || !SLOW.includes(n)));
if (!suites.length) { console.error('no suite matches', names); process.exit(1); }

const server = await createServer({ server: { port: 5173 }, logLevel: 'warn' }); // busy port: vite picks the next free one
await server.listen();
const port = server.httpServer.address().port;
const env = { ...process.env, URL: `http://localhost:${port}/?debug&scene=arena`, BASE: `http://localhost:${port}` };

const run = (name) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, [new URL(`${name}.browser.mjs`, dir).pathname], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  c.on('close', (code) => {
    const failed = code !== 0 || out.split('\n').some((l) => l.startsWith('FAIL'));
    process.stdout.write(`\n=== ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s) ===\n${out}`);
    resolve(failed);
  });
});

const bad = [];
const pool = async (list, n) => {
  const queue = [...list];
  const worker = async () => { while (queue.length) { const s = queue.shift(); if (await run(s)) bad.push(s); } };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
};
const rank = (s) => (LONG.includes(s) ? LONG.indexOf(s) : LONG.length);
await pool(suites.filter((s) => !SLOW.includes(s)).sort((a, b) => rank(a) - rank(b)), jobs);
await pool(suites.filter((s) => SLOW.includes(s)), 1); // timing-sensitive: alone
await server.close();
console.log(bad.length ? `\nFAILED: ${bad.join(', ')}` : `\nall ${suites.length} suites passed`);
process.exit(bad.length ? 1 : 0);
