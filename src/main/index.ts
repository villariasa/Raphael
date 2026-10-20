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
import { SettingsStore } from './storage/settingsStore';
import { ConversationStore } from './storage/conversationStore';
import { CursorOverlay } from './ui/cursorOverlay';
import { TtsManager } from './core/tts/ttsManager';

const DATA_DIR = path.join(app.getPath('userData'), 'raphael-data');
const OLLAMA_MODEL = process.env.RAPHAEL_MODEL ?? 'llama3.2';

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const activity = new ActivityStore(DATA_DIR);
const settingsStore = new SettingsStore(DATA_DIR);
const conversationStore = new ConversationStore(DATA_DIR);
const permissionStore = new PermissionStore(DATA_DIR);
const permissionGate = new PermissionGate(permissionStore);
const ai = new OllamaProvider();
const ollamaManager = new OllamaManager(ai, OLLAMA_MODEL);
const planner = new Planner(ai, OLLAMA_MODEL, permissionStore);
const executor = new Executor(permissionGate, activity);
const taskManager = new TaskManager(executor, activity);
const cursorOverlay = new CursorOverlay();
const ttsManager = new TtsManager();

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;

/** Broadcast an event to every live Raphael window (main + floating visualizer). */
function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

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
  // A blank white window (distinct from a JS error, which React would
  // still render around) means the renderer process itself died — almost
  // always a GPU-process crash on real hardware. Reload rather than
  // leaving the user staring at a dead window.
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Renderer Process Gone]', details);
    activity.append(`Visualizer window crashed (${details.reason}) — reloading.`, 'error');
    mainWindow?.reload();
  });

  // Let the renderer switch to the minimal (visualizer + chatbox only)
  // layout when the OS reports real fullscreen — whether triggered by our
  // button, F11, or the native title-bar control.
  mainWindow.on('enter-full-screen', () => mainWindow?.webContents.send(IPC.fullscreenEvent, true));
  mainWindow.on('leave-full-screen', () => mainWindow?.webContents.send(IPC.fullscreenEvent, false));

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
    floatingWindow?.close();
    mainWindow = null;
  });
}

/**
 * Floating visualizer (§9): a real, independently closeable window —
 * never a borderless permanent overlay. It belongs to Raphael, not the OS
 * desktop, and closing it only closes itself.
 */
function createFloatingWindow(): void {
  if (floatingWindow) {
    floatingWindow.focus();
    return;
  }
  floatingWindow = new BrowserWindow({
    width: 380,
    height: 540,
    minWidth: 260,
    minHeight: 340,
    backgroundColor: '#05070a',
    title: 'Raphael — Floating',
    frame: false,
    resizable: true,
    // Floats above other apps so My Liege can command Raphael while working
    // elsewhere (§14). Still a normal, closeable window — not a desktop
    // overlay; closing it releases nothing but itself.
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  // Keep it visible even over other apps' fullscreen spaces where the OS allows.
  floatingWindow.setAlwaysOnTop(true, 'floating');

  const devServerUrl = process.env.RAPHAEL_DEV_SERVER_URL;
  const query = '?mode=floating';
  if (devServerUrl) {
    floatingWindow.loadURL(devServerUrl + query);
  } else {
    floatingWindow.loadFile(path.join(__dirname, '../renderer/index.html'), { search: 'mode=floating' });
  }

  floatingWindow.on('closed', () => {
    floatingWindow = null;
  });
}

permissionGate.onAsk((req) => {
  broadcast(IPC.permissionRequestEvent, req);
});

app.whenReady().then(() => {
  createMainWindow();
  activity.append('Raphael started.', 'info');

  ollamaManager.onProgress((progress) => {
    broadcast(IPC.aiSetupEvent, progress);
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
    // Feed Raphael its own recent memory so My Liege isn't forced to
    // re-explain context already given (local-first, never transmitted).
    const history = conversationStore.getHistoryForContext();
    const plan = await planner.plan(text, history);
    // Record the turn (user ask + Raphael's reply/plan) to persistent memory
    // + the daily journal. Outcomes are recorded separately once verified.
    conversationStore.recordTurn(text, plan.summary, plan.steps.map((s) => s.action));
    const taskId = taskManager.start(plan, (update) => {
      broadcast(IPC.taskStatusEvent, update);
      if (update.done) {
        conversationStore.recordOutcome(update.status, !update.error);
      }
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

  ipcMain.handle(IPC.speak, async (_evt, text: string) => {
    const result = await ttsManager.synthesizeToWav(text, settingsStore.getVoice());
    if (!result.ok) {
      activity.append(`TTS unavailable: ${result.reason}`, 'warn');
      return { ok: false, reason: result.reason };
    }
    return { ok: true, audioBase64: result.buffer.toString('base64'), mime: result.mime };
  });

  ipcMain.handle(IPC.getVoice, async () => settingsStore.getVoice());

  ipcMain.handle(IPC.setVoice, async (_evt, voice) => {
    settingsStore.setVoice(voice);
    activity.append(`Voice changed to ${voice}.`, 'info');
  });

  ipcMain.handle(IPC.openFloatingVisualizer, async () => {
    createFloatingWindow();
  });

  ipcMain.handle(IPC.closeFloatingVisualizer, async () => {
    floatingWindow?.close();
  });

  ipcMain.handle(IPC.toggleFullscreen, async () => {
    if (!mainWindow) return;
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    // The enter/leave-full-screen listeners broadcast the new state back
    // to the renderer so the minimal layout follows the real OS state.
  });

  ipcMain.handle(IPC.getStats, async () => conversationStore.getStats());

  ipcMain.handle(IPC.getAlwaysAllowAll, async () => {
    return permissionStore.isAlwaysAllowAll();
  });

  ipcMain.handle(IPC.setAlwaysAllowAll, async (_evt, enabled: boolean) => {
    permissionStore.setAlwaysAllowAll(enabled);
    activity.append(
      enabled
        ? 'All permissions auto-approved (full access enabled).'
        : 'Permission prompts re-enabled.',
      'info'
    );
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// §2: emergency stop — any path to quitting must abort active automation.
app.on('before-quit', () => {
  taskManager.stopAll();
  cursorOverlay.hide();
  floatingWindow?.close();
});

app.on('window-all-closed', () => {
  taskManager.stopAll();
  if (process.platform !== 'darwin') app.quit();
});
