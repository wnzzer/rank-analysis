import { app, shell, BrowserWindow,  session } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

function createWindow(): void {
  session.defaultSession.clearCache().then(() => {
    console.log('Cache cleared on app startup!');
  });
  // Create the browser window.
  const mainWindow = new BrowserWindow({

    width: 900,
    height: 670,
    show: false,
  autoHideMenuBar: true,
  titleBarStyle: 'hidden',  // 隐藏原生标题栏
  titleBarOverlay: {
    color: 'rgba(0, 0, 0, 0)', // 透明标题栏
    height: 35,                 // 设置标题栏高度
    symbolColor: 'white',       // 标题栏按钮颜色
  },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.webContents.openDevTools()

}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.

const path = require('path');
const { spawn } = require('child_process');

let backendProcess;

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron');

  const isDevelopment = !app.isPackaged;
  const backendPath = isDevelopment
    ? path.join(__dirname, '../../backend/lol-record-analysis.exe') // 开发环境
    :  path.join(process.resourcesPath, 'backend/lol-record-analysis.exe') // 打包后路径


  console.log('Backend executable path:', backendPath);

  // 启动后端服务
  backendProcess = spawn(backendPath, [], {
    cwd: path.dirname(backendPath), // 确保工作目录正确
  });

  backendProcess.on('error', (err) => {
    console.error('Failed to start backend:', err);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend exited with code ${code}`);
  });

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 退出应用时关闭后端服务
app.on('window-all-closed', () => {
  if (backendProcess) {
    backendProcess.kill(); // 确保杀死后端进程
    console.log('Backend process killed');
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
