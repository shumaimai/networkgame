// デスクトップアプリとして起動する(ビルド済みの dist/ を読み込む)
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// テストから起動するときは、セーブの置き場所を別のフォルダにする(遊んでいるセーブを上書きしないため)
if (process.env.NETSHOP_USER_DATA) app.setPath('userData', process.env.NETSHOP_USER_DATA);

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 576,
    backgroundColor: '#05080f', title: 'ネットワーク屋さん', autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
