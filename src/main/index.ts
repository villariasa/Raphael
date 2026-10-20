import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { IPC } from '../shared/ipc';
import type { PermissionDecision } from '../shared/ipc';
import { detectEnvironment } from './core/environment/detector';
import { OllamaProvider } from './core/ai/ollama';
import { OllamaManager } from './core/ai/ollamaManager';
import { Planner } from './core/planner/planner';
import { PermissionStore } from './core/permissions/permissionStore';
import { PermissionGate } from './core/permissions/permissionGate';
import { Executor } from './core/executor/executor';
import { TaskManager } from './core/executor/taskManager';
import { ActivityStore } from './storage/activityStore';
import { CursorOverlay } from './ui/cursorOverlay';

const DATA_DIR = path.join(app.getPath('userData'), 'raphael-data');
const OLLAMA_MODEL = process.env.RAPHAEL_MODEL ?? 'llama3.2';

const activity = new ActivityStore(DATA_DIR);
const permissionStore = new PermissionStore(DATA_DIR);
const permissionGate = new PermissionGate(permissionStore);
const ai = new OllamaProvider();
const ollamaManager = new OllamaManager(ai, OLLAMA_MODEL);
const planner = new Planner(ai, OLLAMA_MODEL);
const executor = new Executor(permissionGate, activity);
const taskManager = new TaskManager(executor, activity);
const cursorOverlay = new CursorOverlay();

let mainWindow: BrowserWindow | null = null;

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 520,
    backgroundColor: '#0f1115',
    title: 'Raphael',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer Console ${level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[Preload Error] ${preloadPath}:`, error);
  });
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[Load Error] ${errorCode}: ${errorDescription} (${validatedURL})`);
  });

  const devServerUrl = process.env.RAPHAEL_DEV_SERVER_URL;
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // §2: closing the window must not leave automation running.
  mainWindow.on('closed', () => {
    taskManager.stopAll();
    cursorOverlay.hide();
    mainWindow = null;
  });
}

permissionGate.onAsk((req) => {
  mainWindow?.webContents.send(IPC.permissionRequestEvent, req);
});

app.whenReady().then(() => {
  createMainWindow();
  activity.append('Raphael started.', 'info');

  ollamaManager.onProgress((progress) => {
    mainWindow?.webContents.send(IPC.aiSetupEvent, progress);
    if (progress.stage === 'ready') {
      activity.append(`AI runtime ready: ${progress.model}`, 'success');
    } else if (progress.stage === 'error') {
      activity.append(`AI runtime notice: ${progress.message}`, 'warn');
    }
  });

  // Automatically ensure Ollama is running and target model is ready
  ollamaManager.setup().catch((err) => {
    activity.append(`Ollama setup background notice: ${err.message}`, 'warn');
  });

  ipcMain.handle(IPC.getEnvironmentProfile, async () => {
    const profile = await detectEnvironment();
    return profile;
  });

  ipcMain.handle(IPC.getAiStatus, async () => {
    const reachable = await ai.isReachable();
    const models = reachable ? await ai.listModels() : [];
    return {
      provider: 'ollama' as const,
      reachable,
      baseUrl: ai.getBaseUrl(),
      models,
      setupProgress: ollamaManager.getProgress(),
      error: reachable ? undefined : 'Ollama is not reachable at the configured address.'
    };
  });

  ipcMain.handle(IPC.triggerAiSetup, async () => {
    ollamaManager.setup().catch((err) => {
      activity.append(`Manual AI setup error: ${err.message}`, 'error');
    });
  });

  ipcMain.handle(IPC.submitCommand, async (_evt, text: string) => {
    activity.append(`User command: "${text}"`, 'info');
    const plan = await planner.plan(text);
    const taskId = taskManager.start(plan, (update) => {
      mainWindow?.webContents.send(IPC.taskStatusEvent, update);
    });
    return { taskId, plan };
  });

  ipcMain.handle(IPC.respondToPermission, async (_evt, requestId: string, decision: PermissionDecision) => {
    permissionGate.resolve(requestId, decision);
  });

  ipcMain.handle(IPC.stopTask, async (_evt, taskId: string) => {
    taskManager.stop(taskId);
  });

  ipcMain.handle(IPC.pauseTask, async (_evt, taskId: string) => {
    taskManager.pause(taskId);
  });

  ipcMain.handle(IPC.resumeTask, async (_evt, taskId: string) => {
    taskManager.resume(taskId);
  });

  ipcMain.handle(IPC.getActivity, async () => activity.getAll());

  ipcMain.handle(IPC.clearActivity, async () => {
    activity.clear();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// §2: emergency stop — any path to quitting must abort active automation.
app.on('before-quit', () => {
  taskManager.stopAll();
  cursorOverlay.hide();
});

app.on('window-all-closed', () => {
  taskManager.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
