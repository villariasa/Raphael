import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import readline from 'readline';

interface Pending {
  resolve: (obj: any) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Persistent JSON-over-stdio channel to the screen-use Python perception
 * sidecar (mirrors the SenseVoice sidecar). Keeps the UIA/screen session warm;
 * each request/response is a single JSON line. All desktop operations are
 * real — this just transports them.
 */
export class ScreenUseSidecar {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, Pending>();
  private ready = false;
  private readyCb: (() => void) | null = null;
  private errorCb: ((reason: string) => void) | null = null;

  constructor(private readonly pythonExe: string, private readonly scriptPath: string) {}

  onReady(cb: () => void): void {
    this.readyCb = cb;
  }
  onError(cb: (reason: string) => void): void {
    this.errorCb = cb;
  }
  isReady(): boolean {
    return this.ready;
  }

  start(): void {
    if (this.child) return;
    this.ready = false;
    const child = spawn(this.pythonExe, ['-u', this.scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;

    readline.createInterface({ input: child.stdout! }).on('line', (line) => this.handleLine(line));
    child.stderr?.on('data', (d) => console.log(`[screen-use] ${d.toString().trim()}`));
    child.on('error', (err) => {
      this.ready = false;
      this.errorCb?.(`sidecar spawn error: ${err.message}`);
    });
    child.on('close', (code) => {
      this.ready = false;
      this.child = null;
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error('screen-use sidecar exited.'));
      }
      this.pending.clear();
      if (code !== 0) this.errorCb?.(`sidecar exited with code ${code}`);
    });
  }

  private handleLine(line: string): void {
    const t = line.trim();
    if (!t) return;
    let msg: any;
    try {
      msg = JSON.parse(t);
    } catch {
      return;
    }
    if (msg.event === 'ready') {
      this.ready = true;
      this.readyCb?.();
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
    p.resolve(msg);
  }

  /** Send a command, resolve with the full response object. */
  request(cmd: string, payload: Record<string, unknown> = {}, timeoutMs = 15000): Promise<any> {
    if (!this.child || !this.ready) return Promise.reject(new Error('screen-use sidecar not ready.'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${cmd} timed out.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin!.write(JSON.stringify({ id, cmd, ...payload }) + '\n');
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
    setTimeout(() => {
      try {
        if (!child.killed) child.kill();
      } catch {
        /* ignore */
      }
    }, 500);
  }
}
