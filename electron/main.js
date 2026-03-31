const { app, BrowserWindow, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const path = require("path");

const BACKEND_PORT = 4000;
let backendProcess = null;
let mainWindow = null;

function backendRootDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "rental-backend");
  }
  return path.join(__dirname, "..", "rental-backend");
}

function copyTemplateDbIfNeeded(backendRoot) {
  const userDataDir = app.getPath("userData");
  const dbDir = path.join(userDataDir, "db");
  const dbPath = path.join(dbDir, "rentel.db");
  const templateDb = path.join(backendRoot, "prisma", "dev.db");

  fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(dbPath) && fs.existsSync(templateDb)) {
    fs.copyFileSync(templateDb, dbPath);
  }

  return dbPath;
}

function isBackendHealthy(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: BACKEND_PORT,
        path: "/health",
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );

    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function waitForBackend(maxWaitMs = 30000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const healthy = await isBackendHealthy();
    if (healthy) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function startBackendProcess() {
  if (backendProcess) return;

  const backendRoot = backendRootDir();
  const backendEntry = path.join(backendRoot, "dist", "server.js");
  if (!fs.existsSync(backendEntry)) {
    throw new Error(`Backend build not found: ${backendEntry}`);
  }

  const dbPath = copyTemplateDbIfNeeded(backendRoot).replace(/\\/g, "/");
  const env = {
    ...process.env,
    PORT: String(BACKEND_PORT),
    DATABASE_URL: `file:${dbPath}`,
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
  };

  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: backendRoot,
    env,
    stdio: "ignore",
    windowsHide: true,
  });

  backendProcess.once("exit", () => {
    backendProcess = null;
  });
}

function stopBackendProcess() {
  if (!backendProcess || backendProcess.killed) return;
  try {
    backendProcess.kill();
  } catch {
    // Ignore.
  }
}

function createMainWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    title: "Rentel",
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.loadURL(`http://localhost:${BACKEND_PORT}/dashboard`);
  return win;
}

function setupAutoUpdates(win) {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err || "");
    if (!message) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(
        `console.warn(${JSON.stringify(`[Rentel Updater] ${message}`)});`,
      ).catch(() => {
        // Ignore log bridge errors.
      });
    }
  });

  autoUpdater.on("update-downloaded", async () => {
    if (!win || win.isDestroyed()) return;
    const result = await dialog.showMessageBox(win, {
      type: "info",
      buttons: ["Restart Now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update Ready",
      message: "A new Rentel update has been downloaded.",
      detail: "Restart now to apply the update.",
    });
    if (result.response === 0) {
      setImmediate(() => {
        autoUpdater.quitAndInstall();
      });
    }
  });

  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {
      // Silent fallback: app continues normally without update check.
    });
  }, 4000);
}

async function bootApp() {
  const alreadyRunning = await isBackendHealthy();
  if (!alreadyRunning) {
    startBackendProcess();
    const ready = await waitForBackend();
    if (!ready) {
      throw new Error("Rentel backend did not become ready in time.");
    }
  }
  mainWindow = createMainWindow();
  setupAutoUpdates(mainWindow);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  stopBackendProcess();
});

app.whenReady().then(async () => {
  try {
    await bootApp();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "Rentel Startup Error",
      `The app could not start.\n\n${message}\n\nTry reinstalling, then launch again.`,
    );
    app.quit();
  }
});
