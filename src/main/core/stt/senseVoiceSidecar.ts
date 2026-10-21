import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import readline from 'readline';

interface Pending {
  resolve: (text: { text: string; language?: string }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ReadyCb = (info: { device?: string }) => void;
type ErrorCb = (reason: string) => void;

/**
 * Owns the persistent Python SenseVoice process and the newline-JSON protocol
 * to it. The model is loaded once inside the child and kept warm; each
 * transcribe() is just inference. Nothing here touches the network.
 */
export class SenseVoiceSidecar {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, Pending>();
  private ready = false;
  private readyCb: ReadyCb | null = null;
  private errorCb: ErrorCb | null = null;

  constructor(private readonly pythonExe: string, private readonly scriptPath: string) {}

  onReady(cb: ReadyCb): void {
    this.readyCb = cb;
  }
  onError(cb: ErrorCb): void {
    this.errorCb = cb;
  }
  isReady(): boolean {
    return this.ready;
  }
  isAlive(): boolean {
    return this.child !== null && !this.child.killed;
  }

  start(): void {
    if (this.child) return;
    this.ready = false;
    const child = spawn(this.pythonExe, ['-u', this.scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;

    const rl = readline.createInterface({ input: child.stdout! });
    rl.on('line', (line) => this.handleLine(line));

    child.stderr?.on('data', (d) => {
      // Diagnostic only; the model prints load progress here.
      console.log(`[SenseVoice] ${d.toString().trim()}`);
    });

    child.on('error', (err) => {
      this.ready = false;
      this.errorCb?.(`sidecar spawn error: ${err.message}`);
    });

    child.on('close', (code) => {
      this.ready = false;
      this.child = null;
      // Fail any in-flight requests so callers don't hang.
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('SenseVoice sidecar exited.'));
      }
      this.pending.clear();
      if (code !== 0) this.errorCb?.(`sidecar exited with code ${code}`);
    });
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return; // ignore non-JSON noise
    }

    if (msg.event === 'ready') {
      this.ready = true;
      this.readyCb?.({ device: msg.device });
      return;
    }
    if (msg.event === 'error') {
      this.ready = false;
      this.errorCb?.(msg.reason ?? 'unknown sidecar error');
      return;
    }

    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.ok) p.resolve({ text: msg.text ?? '', language: msg.language });
    else p.reject(new Error(msg.reason ?? 'transcription failed'));
  }

  /** Transcribe a WAV file already written to disk. Resolves to the text. */
  transcribe(wavPath: string, language = 'auto', timeoutMs = 30000): Promise<{ text: string; language?: string }> {
    if (!this.child || !this.ready) {
      return Promise.reject(new Error('SenseVoice sidecar not ready.'));
    }
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Transcription timed out.'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify({ id, cmd: 'transcribe', wavPath, language }) + '\n');
    });
  }

  stop(): void {
    if (!this.child) return;
    try {
      this.child.stdin?.write(JSON.stringify({ id: 'x', cmd: 'shutdown' }) + '\n');
    } catch {
      /* ignore */
    }
    const child = this.child;
    this.child = null;
    this.ready = false;
    // Give it a moment to exit cleanly, then force kill.
    setTimeout(() => {
      try {
        if (!child.killed) child.kill();
      } catch {
        /* ignore */
      }
    }, 500);
  }
}
