import { app, BrowserWindow, Menu, net, protocol, ipcMain, dialog } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Desktop shell (Electron). Serves the Vite build (dist/) from app://game/ — a fixed origin, so settings
// in localStorage persist across launches — in a fullscreen window that never throttles the game loop.
// `--debug` (after `--` on npm scripts) loads ?debug and opens DevTools.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const LEVELS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'levels'); // the repo's level files
const debug =process.argv.includes('--debug');

// the game is the foreground app: full frame rate when unfocused or covered, discrete GPU on dual-GPU Macs
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('force_high_performance_gpu');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const primary = app.requestSingleInstanceLock();
if (!primary) app.quit(); // already running: the 'second-instance' handler focuses that window

let win = null;

function serve() {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(ROOT + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  win = new BrowserWindow({
    title: 'Cerberus',
    width: 1600,
    height: 900,
    fullscreen: !debug,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // F11 / Alt+Enter toggle fullscreen
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.code === 'F11' || (input.code === 'Enter' && input.alt)) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    }
  });
  // a game, not a browser: no navigation away, no popups
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL(`app://game/index.html${debug ? '?debug' : ''}`);
  if (debug) win.webContents.openDevTools({ mode: 'detach' });
}

ipcMain.on('desktop:quit', () => app.quit());
ipcMain.on('desktop:fullscreen', () => win?.setFullScreen(!win.isFullScreen()));

// Workshop level files (#72). The renderer sends a name and text, never a path: the name must match [a-z0-9-]+ and
// the file lands in src/levels. A packaged app has no repo folder, so it asks with a save dialog instead.
const LEVEL_NAME = /^[a-z0-9-]+$/;
const LEVEL_MAX = 8 * 1024 * 1024;
const JSON_FILTER = [{ name: 'Level', extensions: ['json'] }];

ipcMain.handle('desktop:saveLevel', async (_e, name, text) => {
  if (typeof name !== 'string' || !LEVEL_NAME.test(name)) throw new Error(`level name "${name}" is not a file name (a-z, 0-9, -)`);
  if (typeof text !== 'string' || text.length > LEVEL_MAX) throw new Error('level text is missing or too large');
  const repo = !app.isPackaged && (await fs.stat(LEVELS).then((s) => s.isDirectory(), () => false));
  if (repo) {
    const file = path.join(LEVELS, `${name}.json`);
    if (path.dirname(file) !== LEVELS) throw new Error('refused: outside src/levels');
    await fs.writeFile(file, text);
    return { where: 'repo', path: path.join('src', 'levels', `${name}.json`) };
  }
  const res = await dialog.showSaveDialog(win, { defaultPath: `${name}.json`, filters: JSON_FILTER });
  if (res.canceled || !res.filePath) return { canceled: true };
  await fs.writeFile(res.filePath, text);
  return { where: 'dialog', path: res.filePath };
});

ipcMain.handle('desktop:openLevel', async () => {
  const res = await dialog.showOpenDialog(win, { defaultPath: app.isPackaged ? undefined : LEVELS, filters: JSON_FILTER, properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  if ((await fs.stat(file)).size > LEVEL_MAX) throw new Error('level file is too large');
  return { name: path.basename(file), text: await fs.readFile(file, 'utf8') };
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  if (!primary) return;
  // macOS keeps an app menu for Cmd+Q / Cmd+H; elsewhere there is no menu bar
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }]) : null);
  serve();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
