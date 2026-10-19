// Intro reel (view/reel.js): NEW GAME plays it over the title; the first press shows the skip hint, the second ends it and
// loads the first campaign scene (progress saved). The end of the reel waits on black with a prompt; a press there ends it.
// Shot table: six PA cards with their voice lines in order, then the voiceless SIGNAL card.
// Needs the dev server: `bun run dev`, then `node tests/reel.browser.mjs` (Playwright + Chromium).
import { chromium } from 'playwright';

const BASE = new URL(process.env.URL ?? 'http://localhost:5173/?debug&scene=arena');
const title = `${BASE.origin}/`; // no ?debug: the title, no level loaded
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errors.push(m.text()));
await p.addInitScript(() => {
  localStorage.clear();
  // no real pointer lock in headless runs
  Element.prototype.requestPointerLock = function () {
    setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
    return Promise.reject(new DOMException('refused by the test', 'NotAllowedError'));
  };
});
await p.goto(title);
await p.waitForSelector('#overlay [data-act="new"]');

const fail = [];
const expect = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`); if (!ok) fail.push(name); };
const state = () => p.evaluate(() => {
  const el = document.getElementById('reel');
  return { hidden: el.hidden, state: el.dataset.state, shot: el.dataset.shot, hint: el.querySelector('.hint').hidden ? '' : el.querySelector('.hint').textContent, card: el.querySelector('.text').textContent, overlay: document.getElementById('overlay').style.display };
});

// the shot table and the end of the reel, on a standalone instance (no audio, no handoff to the shell)
const table = await p.evaluate(async () => {
  const { SHOTS, TUNING, LENGTH, Reel } = await import('/src/game/view/reel.js');
  const r = new Reel({ audio: {} });
  let ended = null;
  r.start((pad) => (ended = { pad }));
  r.seek(LENGTH + TUNING.prompt + 0.5);
  r.update(null);
  const el = document.getElementById('reel');
  const wait = { state: el.dataset.state, shot: el.dataset.shot, hint: el.querySelector('.hint').textContent, card: el.querySelector('.text').textContent };
  dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }));
  return { voices: SHOTS.map((s) => s.voice), windows: SHOTS.map((s) => s.len - TUNING.cardAt - TUNING.cardOut), wait, ended, active: r.active, hidden: el.hidden };
});
expect('six PA lines in order, the last card has none', JSON.stringify(table.voices) === JSON.stringify(['reelPa1', 'reelPa2', 'reelPa3', 'reelPa4', 'reelPa5', 'reelPa6', null]), JSON.stringify(table.voices));
expect('card windows: 11.4 s orbit, 9.4 s feed, 13.4 s the others', JSON.stringify(table.windows.slice(0, 6).map((w) => +w.toFixed(1))) === '[11.4,13.4,13.4,9.4,13.4,13.4]', JSON.stringify(table.windows));
expect('the end waits on the signal card with a prompt', table.wait.state === 'wait' && table.wait.shot === 'signal' && table.wait.hint === 'PRESS ANY KEY' && table.wait.card === 'SIGNAL: UNREGIS', JSON.stringify(table.wait));
expect('a press in the wait ends it and hands the press back', table.ended?.pad === false && !table.active && table.hidden, JSON.stringify(table));

// NEW GAME from the title
await p.click('#overlay [data-act="new"]');
await p.waitForFunction(() => document.getElementById('reel').dataset.state === 'play'); // not a fixed wait: the page is slow under a parallel run
let s = await state();
expect('NEW GAME starts the reel over a hidden menu', !s.hidden && s.state === 'play' && s.shot === 'orbit' && s.overlay === 'none', JSON.stringify(s));
await p.waitForFunction(() => document.querySelector('#reel .text').textContent.length > 0); // past cardAt: the first card types
s = await state();
expect('the first card types in', s.card.length > 0 && 'IO. ONE MACHINE. ONE MIND.'.startsWith(s.card), JSON.stringify(s));
await p.keyboard.press('Space');
await p.waitForFunction(() => !document.querySelector('#reel .hint').hidden);
s = await state();
expect('a first press only shows the skip hint', !s.hidden && s.hint === 'PRESS AGAIN TO SKIP', JSON.stringify(s));
await p.keyboard.press('Space');
await p.waitForFunction(() => document.getElementById('reel').hidden);
s = await state();
expect('a second press ends the reel', s.hidden, JSON.stringify(s));
await p.waitForFunction(() => document.getElementById('loading').hidden && !document.body.classList.contains('title'), null, { timeout: 120000 });
const progress = await p.evaluate(() => JSON.parse(localStorage.getItem('cerberus.progress') ?? 'null'));
const { CAMPAIGN } = await p.evaluate(async () => ({ CAMPAIGN: (await import('/src/game/scenes.js')).CAMPAIGN }));
expect('the first campaign scene loads and is saved', progress?.scene === CAMPAIGN[0], JSON.stringify(progress));
expect('no page errors', errors.length === 0, errors.join(' | '));

await b.close();
if (fail.length) {
  console.log(`\n${fail.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
