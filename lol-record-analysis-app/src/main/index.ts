import { app, shell, BrowserWindow, ipcMain, session } from 'electron';
import path, { join } from 'path';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import icon from '../../resources/icon.png?asset';
import { spawn } from 'child_process';

function createWindow(): void {
  session.defaultSession.clearCache().then(() => {
    console.log('Cache cleared on app startup!');
  });

  const iconPath = path.resolve(__dirname, '../../public/assets/logo.png');


  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    icon: iconPath,

    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',  // Hide native title bar
    titleBarOverlay: {
      color: 'rgba(0, 0, 0, 0)', // Transparent title bar
      height: 35,                 // Title bar height
      symbolColor: 'white',       // Title bar button color
    },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Load URL or local file based on environment
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron');

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test
  ipcMain.on('ping', () => console.log('pong'));

  // Start backend service (lol-record-analysis.exe)
  const isDevelopment = !app.isPackaged;
  const backendPath = isDevelopment
    ? join(__dirname, '../../backend/lol-record-analysis.exe') // Development path
    : join(process.resourcesPath, 'backend/lol-record-analysis.exe'); // Production path

  console.log('Backend executable path:', backendPath);

  let backendProcess;

  // Launch backend service
  backendProcess = spawn(backendPath, [], {
    cwd: path.dirname(backendPath), // Ensure correct working directory
  });

  // Capture stdout and stderr for debugging
  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend stdout: ${data}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend stderr: ${data}`);
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  backendProcess.on('close', (code, signal) => {
    console.log(`Backend process exited with code ${code}, signal ${signal}`);

    // Optionally, restart the process if it exits unexpectedly
    if (code !== 0) {
      console.error('Backend process exited with an error. Restarting...');
      // You can implement a retry mechanism here, if necessary
      backendProcess = spawn(backendPath, [], {
        cwd: path.dirname(backendPath),
      });
    }
  });

  createWindow();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
