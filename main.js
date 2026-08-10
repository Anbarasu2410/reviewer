const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow;
let serverProcess;
let serverPort;

const SERVER_READY_TIMEOUT_MS = 15000;
const SERVER_POLL_INTERVAL_MS = 100;

// Find an available port
function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

// Resolve once the server answers its health probe
function waitForHealth(port, deadline) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const request = http.get(
        { host: '127.0.0.1', port, path: '/api/health', timeout: 1000 },
        (response) => {
          response.resume();
          if (response.statusCode === 200) {
            resolve();
          } else {
            retry();
          }
        }
      );
      request.on('error', retry);
      request.on('timeout', () => request.destroy());
    };

    const retry = () => {
      if (Date.now() > deadline) {
        reject(new Error(`Server did not become ready within ${SERVER_READY_TIMEOUT_MS}ms`));
        return;
      }
      setTimeout(attempt, SERVER_POLL_INTERVAL_MS);
    };

    attempt();
  });
}

// Start the Express server
async function startServer() {
  serverPort = await findAvailablePort();

  // A packaged app has no `node` on PATH. Electron's own binary runs as Node
  // when ELECTRON_RUN_AS_NODE is set, so use that instead.
  serverProcess = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: serverPort.toString(), ELECTRON_RUN_AS_NODE: '1' },
    cwd: __dirname
  });

  serverProcess.stdout.on('data', (data) => console.log(`Server: ${data}`));
  serverProcess.stderr.on('data', (data) => console.error(`Server Error: ${data}`));

  const exited = new Promise((resolve, reject) => {
    serverProcess.on('error', (error) => reject(error));
    serverProcess.on('exit', (code) => {
      reject(new Error(`Server exited before becoming ready (code ${code})`));
    });
  });

  // Whichever settles first: the health probe succeeding, or the child dying.
  await Promise.race([
    waitForHealth(serverPort, Date.now() + SERVER_READY_TIMEOUT_MS),
    exited
  ]);
}

// Create the main application window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      sandbox: false // Needed for file system access
    },
    title: 'Code Reviewer',
    backgroundColor: '#ffffff',
    show: false // Don't show until ready
  });

  // Load the app
  mainWindow.loadURL(`http://localhost:${serverPort}`);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open links in external browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create menu
  createMenu();
}

// Create application menu
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Repository...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
              title: 'Select Git Repository'
            });

            if (!result.canceled && result.filePaths.length > 0) {
              // Send the path to the renderer
              mainWindow.webContents.send('open-repository', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Submit Review',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('submit-review');
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/dheerajjha/reviewer');
          }
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/dheerajjha/reviewer/issues');
          }
        },
        { type: 'separator' },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Code Reviewer',
              message: 'Code Reviewer',
              detail: `Version: ${app.getVersion()}\n\nA desktop app for reviewing code changes in git repositories.`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// App ready event
app.whenReady().then(async () => {
  try {
    console.log('Starting server...');
    await startServer();
    console.log(`Server started on port ${serverPort}`);
    createWindow();
  } catch (error) {
    console.error('Failed to start application:', error);
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up server process on quit
app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});

// Handle app quit
app.on('will-quit', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
});
