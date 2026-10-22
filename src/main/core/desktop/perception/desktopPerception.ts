import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { ScreenUseSidecar } from './screenUseSidecar';
import { getActiveWindow } from '../windowManager';

const execFileAsync = promisify(execFile);
const PY = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];

export interface UiElement {
  element: string;
  type: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  value?: string;
}

export interface ScreenState {
  activeApplication: string;
  windowTitle: string;
  windowBounds: { x: number; y: number; width: number; height: number } | null;
  monitor: number;
  visibleElements: UiElement[];
  screenChanged: boolean;
  capturedAt: string;
}

export interface PerceptionStatus {
  available: boolean;
  runtime: 'python' | 'none';
  stage: 'idle' | 'checking' | 'installing' | 'starting' | 'ready' | 'error';
  message: string;
}

/**
 * DesktopPerception — the SEE half of the Desktop Engine (§2/§9). Owns the
 * screen-use Python sidecar, caches a ScreenState, and only re-observes on
 * demand (never a continuous screenshot flood — §16). Real UIA/screenshot
 * data, never mocked (§19). Optional, like voice input: if the runtime is
 * missing the rest of Raphael keeps working.
 */
export class DesktopPerception {
  private sidecar: ScreenUseSidecar | null = null;
  private pythonExe: string | null = null;
  private status: PerceptionStatus = { available: false, runtime: 'none', stage: 'idle', message: 'Perception not started.' };
  private lastState: ScreenState | null = null;
  private setupPromise: Promise<boolean> | null = null;

  constructor(private readonly scriptPath: string, private readonly onStatus?: (s: PerceptionStatus) => void) {}

  getStatus(): PerceptionStatus {
    return this.status;
  }

  private set(stage: PerceptionStatus['stage'], message: string): void {
    this.status = { ...this.status, stage, message, available: stage === 'ready', runtime: this.pythonExe ? 'python' : 'none' };
    this.onStatus?.(this.status);
  }

  setup(): Promise<boolean> {
    if (this.sidecar?.isReady()) return Promise.resolve(true);
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = this.doSetup().finally(() => (this.setupPromise = null));
    return this.setupPromise;
  }

  private async doSetup(): Promise<boolean> {
    if (process.platform !== 'win32') {
      this.set('error', 'Desktop perception is Windows-only.');
      return false;
    }
    this.set('checking', 'Looking for Python…');
    const py = await this.findPython();
    if (!py) {
      this.set('error', 'Python not found — desktop vision needs Python 3. The rest of Raphael still works.');
      return false;
    }
    this.pythonExe = py;
    // Ensure the minimal fallback deps; screen-use itself is best-effort.
    this.set('installing', 'Ensuring perception dependencies (one-time)…');
    await this.pipInstall(py, ['pyautogui', 'pywinauto', 'pillow']);
    return this.startSidecar();
  }

  private startSidecar(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.pythonExe) return resolve(false);
      const sidecar = new ScreenUseSidecar(this.pythonExe, this.scriptPath);
      let settled = false;
      sidecar.onReady(() => {
        if (settled) return;
        settled = true;
        this.sidecar = sidecar;
        this.set('ready', 'Desktop perception ready.');
        resolve(true);
      });
      sidecar.onError((reason) => {
        if (settled) return;
        settled = true;
        this.set('error', `Perception error: ${reason}. The rest of Raphael still works.`);
        resolve(false);
      });
      this.set('starting', 'Starting the perception engine…');
      sidecar.start();
    });
  }

  /** OBSERVE (§8): read the real desktop state. Combines UIA elements + the active window. */
  async observe(): Promise<ScreenState | null> {
    if (!this.sidecar?.isReady()) return null;
    try {
      const res = await this.sidecar.request('observe');
      const win = await getActiveWindow();
      const w = win.after;
      const next: ScreenState = {
        activeApplication: w?.processName ?? 'unknown',
        windowTitle: w?.title ?? '',
        windowBounds: w ? w.bounds : null,
        monitor: w?.monitor ?? 0,
        visibleElements: (res.elements ?? []) as UiElement[],
        screenChanged: this.didChange(w?.title ?? '', res.elements?.length ?? 0),
        capturedAt: new Date().toISOString()
      };
      this.lastState = next;
      return next;
    } catch {
      return null;
    }
  }

  private didChange(title: string, elementCount: number): boolean {
    if (!this.lastState) return true;
    return this.lastState.windowTitle !== title || Math.abs(this.lastState.visibleElements.length - elementCount) > 3;
  }

  async findElement(query: string): Promise<UiElement | null> {
    if (!this.sidecar?.isReady()) return null;
    const res = await this.sidecar.request('find', { query });
    return res.ok ? (res.element as UiElement) : null;
  }

  async click(opts: { query?: string; x?: number; y?: number }): Promise<{ ok: boolean; x?: number; y?: number; reason?: string }> {
    if (!this.sidecar?.isReady()) return { ok: false, reason: 'Perception not ready.' };
    return this.sidecar.request('click', opts, 20000);
  }

  async type(text: string): Promise<{ ok: boolean; reason?: string }> {
    if (!this.sidecar?.isReady()) return { ok: false, reason: 'Perception not ready.' };
    return this.sidecar.request('type', { text }, 20000);
  }

  async scroll(amount: number): Promise<{ ok: boolean; reason?: string }> {
    if (!this.sidecar?.isReady()) return { ok: false, reason: 'Perception not ready.' };
    return this.sidecar.request('scroll', { amount });
  }

  async cursor(): Promise<{ x: number; y: number } | null> {
    if (!this.sidecar?.isReady()) return null;
    const res = await this.sidecar.request('cursor', {}, 3000).catch(() => null);
    return res?.cursor ?? null;
  }

  dispose(): void {
    this.sidecar?.stop();
    this.sidecar = null;
  }

  // --- helpers ---
  private async findPython(): Promise<string | null> {
    for (const c of PY) {
      try {
        const { stdout } = await execFileAsync(c, ['--version'], { timeout: 5000 });
        if (/python 3/i.test(stdout)) return c;
      } catch {
        continue;
      }
    }
    return null;
  }

  private pipInstall(py: string, pkgs: string[]): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(py, ['-m', 'pip', 'install', ...pkgs], { stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }
}
