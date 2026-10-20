import { BrowserWindow, screen } from 'electron';
import path from 'path';

/**
 * The Raphael cursor overlay (§8). A transparent, always-on-top,
 * click-through window used to visibly mark where Raphael is acting.
 *
 * MVP STATUS: this window exists and can be shown/hidden, but nothing in
 * this build drives it with real mouse automation yet — that lands in
 * Phase 3 alongside actual OS-level mouse/keyboard control. Per §8/§21 it
 * is deliberately NOT wired to fake movement in the meantime.
 */
export class CursorOverlay {
  private window: BrowserWindow | null = null;

  show(): void {
    if (this.window) return;
    const { width, height } = screen.getPrimaryDisplay().bounds;
    this.window = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: { contextIsolation: true }
    });
    this.window.setIgnoreMouseEvents(true);
    this.window.loadFile(path.join(__dirname, 'overlay.html')).catch(() => {
      // overlay is cosmetic; failure to load must never block real execution
    });
  }

  hide(): void {
    this.window?.close();
    this.window = null;
  }

  isVisible(): boolean {
    return this.window !== null;
  }
}
