import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { SttSetupProgress, SttStatus, TranscribeResult } from '../../../shared/ipc';
import { SenseVoiceSidecar } from './senseVoiceSidecar';

const execFileAsync = promisify(execFile);

const PYTHON_CANDIDATES = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python'];

/**
 * Owns the local SenseVoice speech-to-text runtime: detect Python, ensure
 * funasr, spawn+warm the sidecar, and transcribe utterances. Voice input is
 * OPTIONAL — every failure here degrades gracefully to "unavailable" and the
 * app keeps working on typed input. Local-first: audio never leaves the box.
 */
export class SttManager {
  private progress: SttSetupProgress = { stage: 'idle', message: 'Voice input not started.' };
  private listeners: ((p: SttSetupProgress) => void)[] = [];
  private sidecar: SenseVoiceSidecar | null = null;
  private pythonExe: string | null = null;
  private micEnabled = false;
  private setupPromise: Promise<boolean> | null = null;

  constructor(private readonly scriptPath: string) {}

  onProgress(cb: (p: SttSetupProgress) => void): () => void {
    this.listeners.push(cb);
    cb(this.progress);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  setMicEnabled(enabled: boolean): void {
    this.micEnabled = enabled;
  }

  getStatus(): SttStatus {
    return {
      available: !!this.sidecar?.isReady(),
      runtime: this.pythonExe ? 'python' : 'none',
      micEnabled: this.micEnabled,
      setupProgress: this.progress,
      error: this.progress.stage === 'error' ? this.progress.error : undefined
    };
  }

  private set(stage: SttSetupProgress['stage'], message: string, extra: Partial<SttSetupProgress> = {}): void {
    this.progress = { stage, message, ...extra };
    for (const l of this.listeners) {
      try {
        l(this.progress);
      } catch {
        /* ignore */
      }
    }
  }

  /** Idempotent: detect runtime, ensure funasr, warm the model. Safe to call repeatedly. */
  setup(): Promise<boolean> {
    if (this.sidecar?.isReady()) return Promise.resolve(true);
    if (this.setupPromise) return this.setupPromise;
    this.setupPromise = this.doSetup().finally(() => {
      this.setupPromise = null;
    });
    return this.setupPromise;
  }

  private async doSetup(): Promise<boolean> {
    this.set('checking', 'Looking for a Python runtime…');
    const py = await this.findPython();
    if (!py) {
      this.set('error', 'Python not found — voice input needs Python 3. Typing still works.', {
        error: 'python-missing'
      });
      return false;
    }
    this.pythonExe = py;

    this.set('checking', 'Checking the speech engine (funasr & torch)…');
    const hasTorch = await this.hasModule(py, 'torch');
    if (!hasTorch) {
      this.set('installing_runtime', 'Installing PyTorch for speech engine (one-time)…');
      const ok = await this.pipInstall(py, 'torch torchaudio --index-url https://download.pytorch.org/whl/cpu');
      if (!ok) {
        this.set('error', 'Couldn\'t install PyTorch for the speech engine. Typing still works.', { error: 'torch-install-failed' });
        return false;
      }
    }

    const hasFunasr = await this.hasModule(py, 'funasr');
    if (!hasFunasr) {
      this.set('installing_runtime', 'Installing the speech engine (one-time, may take a while)…');
      const ok = await this.pipInstall(py, 'funasr>=1.3.26');
      if (!ok) {
        this.set('error', 'Couldn\'t install the speech engine. Typing still works.', { error: 'funasr-install-failed' });
        return false;
      }
    }

    this.set('loading_model', 'Loading SenseVoice (first run downloads the model)…');
    return this.startSidecar();
  }

  private startSidecar(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.pythonExe) {
        resolve(false);
        return;
      }
      const sidecar = new SenseVoiceSidecar(this.pythonExe, this.scriptPath);
      let settled = false;
      sidecar.onReady(() => {
        if (settled) return;
        settled = true;
        this.sidecar = sidecar;
        this.set('ready', 'Voice input ready.');
        resolve(true);
      });
      sidecar.onError((reason) => {
        if (settled) return;
        settled = true;
        this.set('error', `Voice engine error: ${reason}. Typing still works.`, { error: reason });
        resolve(false);
      });
      sidecar.start();
    });
  }

  /** Transcribe a WAV (base64). Writes a transient temp file the sidecar reads, then deletes it. */
  async transcribe(wavBase64: string, language = 'auto'): Promise<TranscribeResult> {
    if (!this.sidecar?.isReady()) {
      return { ok: false, reason: 'Voice input isn\'t ready yet.' };
    }
    const tmp = path.join(os.tmpdir(), `raphael-stt-${crypto.randomUUID()}.wav`);
    try {
      await fs.writeFile(tmp, Buffer.from(wavBase64, 'base64'));
      const { text, language: lang } = await this.sidecar.transcribe(tmp, language);
      const clean = text.trim();
      if (!clean) return { ok: false, reason: 'I didn\'t catch that, My Liege.' };
      return { ok: true, text: clean, language: lang };
    } catch (err: any) {
      return { ok: false, reason: err?.message ?? 'Transcription failed.' };
    } finally {
      fs.unlink(tmp).catch(() => {});
    }
  }

  dispose(): void {
    this.sidecar?.stop();
    this.sidecar = null;
  }

  // --- helpers --------------------------------------------------------

  private async findPython(): Promise<string | null> {
    for (const candidate of PYTHON_CANDIDATES) {
      try {
        const { stdout } = await execFileAsync(candidate, ['--version'], { timeout: 5000 });
        if (/python 3/i.test(stdout) || /python 3/i.test(String(stdout))) return candidate;
      } catch {
        // also check stderr-only version prints (older python)
        try {
          await execFileAsync(candidate, ['-c', 'import sys; assert sys.version_info[0]==3'], { timeout: 5000 });
          return candidate;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  private async hasModule(py: string, mod: string): Promise<boolean> {
    try {
      await execFileAsync(py, ['-c', `import ${mod}`], { timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  }

  private pipInstall(py: string, pkg: string): Promise<boolean> {
    return new Promise((resolve) => {
      const child = spawn(py, ['-m', 'pip', 'install', pkg], { stdio: ['ignore', 'pipe', 'pipe'] });
      let lastPct = 0;
      const onData = (d: Buffer) => {
        const s = d.toString();
        const m = s.match(/(\d{1,3})%/);
        if (m) {
          const pct = Math.min(100, parseInt(m[1], 10));
          if (pct > lastPct) {
            lastPct = pct;
            this.set('installing_runtime', 'Installing the speech engine…', { percent: pct });
          }
        }
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
    });
  }
}
