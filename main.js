'use strict';

// Electron shell for the Ticket Scoring System.
//
// Instead of launching a console window (start.bat) and opening the web UI in
// the system browser, this hosts the existing local server in-process and
// shows it inside a native desktop window. The web UI in ./public and the API
// in server.js are unchanged.

const { app, BrowserWindow, shell, Menu } = require('electron');
const server = require('./server');

let mainWindow = null;

// Only one instance should run, so we don't start two servers on the same port.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(start).catch((err) => {
    console.error('Failed to start the Ticket Scoring System:', err);
    app.quit();
  });
}

async function start() {
  // Host the local server in this process; the window loads from it.
  const url = await server.start({ openExternalBrowser: false });
  createWindow(url);

  app.on('activate', () => {
    // macOS: re-open a window when the dock icon is clicked.
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 800,
    minHeight: 600,
    title: 'Ticket Scoring System',
    backgroundColor: '#181613',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Hide the default application menu (File/Edit/View…); it's a web app.
  Menu.setApplicationMenu(null);

  // Open any external links (target=_blank / window.open) in the real browser
  // rather than a bare Electron window.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);

  // The menu is hidden, so wire reload (F5 / Ctrl+R) manually — handy while
  // editing the UI. Ctrl+Shift+I opens DevTools.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = (input.key || '').toLowerCase();
    if (key === 'f5' || (input.control && key === 'r')) {
      mainWindow.webContents.reloadIgnoringCache();
      event.preventDefault();
    } else if (input.control && input.shift && key === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('window-all-closed', () => {
  // Quit when all windows are closed (standard on Windows/Linux).
  app.quit();
});
