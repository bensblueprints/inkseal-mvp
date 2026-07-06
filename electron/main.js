// Thin Electron wrapper: boots the same Express server on a free local port
// with data stored in Electron's userData dir, then opens a window on it.
// The web app is completely unchanged — desktop mode just runs it locally,
// auto-logged-in (DESKTOP_MODE=1 makes the server trust the local user).
import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.DESKTOP_MODE = '1';
process.env.NO_LISTEN = '1';
process.env.DATA_DIR = path.join(app.getPath('userData'), 'data');

async function createWindow() {
  const { default: server } = await import(new URL('../server/index.js', import.meta.url).href);

  const listener = server.listen(0, '127.0.0.1', () => {
    const { port } = listener.address();

    const win = new BrowserWindow({
      width: 1400,
      height: 900,
      backgroundColor: '#0a0a0f',
      autoHideMenuBar: true,
      title: 'Inkseal',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    });

    // open external links (e.g. public signing URLs shared to a signer) in the system browser
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });

    win.loadURL(`http://127.0.0.1:${port}/`);
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
