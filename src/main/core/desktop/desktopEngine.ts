import path from 'path';
import { controlWindow, getActiveWindow } from './windowManager';
import { DesktopPerception, PerceptionStatus, ScreenState } from './perception/desktopPerception';
import type { WindowOp } from './types';

export interface DesktopStatus {
  platform: string;
  windowManager: boolean; // Win32 available (Windows)
  perception: PerceptionStatus;
}

/**
 * DesktopEngine (§1) — the facade over desktop perception + control. Window
 * management is Win32 (always available on Windows, no setup); perception is
 * the optional screen-use Python sidecar. Everything acts on the REAL desktop
 * and verifies (§8/§18/§19).
 */
export class DesktopEngine {
  readonly perception: DesktopPerception;

  constructor(dirname: string, onPerceptionStatus?: (s: PerceptionStatus) => void) {
    const scriptPath = path.join(dirname, 'core/desktop/perception/screen_use_server.py');
    this.perception = new DesktopPerception(scriptPath, onPerceptionStatus);
  }

  getStatus(): DesktopStatus {
    return {
      platform: process.platform,
      windowManager: process.platform === 'win32',
      perception: this.perception.getStatus()
    };
  }

  /** Warm the perception sidecar (optional; window control needs no setup). */
  setupPerception(): Promise<boolean> {
    return this.perception.setup();
  }

  // --- window control (Win32) ---
  controlWindow(name: string, op: WindowOp, opts?: { width?: number; height?: number; monitor?: number }) {
    return controlWindow(name, op, opts);
  }
  getActiveWindow() {
    return getActiveWindow();
  }

  // --- perception + UI interaction (screen-use sidecar) ---
  observe(): Promise<ScreenState | null> {
    return this.perception.observe();
  }
  findElement(query: string) {
    return this.perception.findElement(query);
  }
  click(opts: { query?: string; x?: number; y?: number }) {
    return this.perception.click(opts);
  }
  type(text: string) {
    return this.perception.type(text);
  }
  scroll(amount: number) {
    return this.perception.scroll(amount);
  }
  cursor() {
    return this.perception.cursor();
  }

  dispose(): void {
    this.perception.dispose();
  }
}
