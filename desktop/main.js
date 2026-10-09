import { app, BrowserWindow, Menu, net, protocol, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Desktop shell (Electron). Serves the Vite build (dist/) from app://game/ — a fixed origin, so settings
// in localStorage persist across launches — in a fullscreen window that never throttles the game loop.
// `--debug` (after `--` on npm scripts) loads ?debug and opens DevTools.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const debug = process.argv.includes('--debug');

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
