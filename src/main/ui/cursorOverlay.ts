import { BrowserWindow, screen } from 'electron';
import path from 'path';
import type { CursorState } from '../../shared/ipc';

/**
 * The visible Raphael cursor (§3). A transparent, always-on-top, click-through
 * window that renders a Raphael marker tracking the REAL cursor position
 * (polled from the OS via screen.getCursorScreenPoint) and colored by state.
 * It never replaces the system cursor and never blocks the user's mouse —
 * closing/hiding releases nothing. The marker is driven by actual action
 * events (the executor), not faked (§3/§4/§19).
 */
export class CursorOverlay {
  private window: BrowserWindow | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private state: CursorState = 'idle';
  private origin = { x: 0, y: 0 };

  /** Show the overlay and begin following the real cursor in the given state. */
  show(state: CursorState = 'executing'): void {
    this.state = state;
    if (this.window) {
      this.setState(state);
      return;
    }
    const display = screen.getPrimaryDisplay();
    this.origin = { x: display.bounds.x, y: display.bounds.y };
    this.window = new BrowserWindow({
      width: display.bounds.width,
      height: display.bounds.height,
      x: display.bounds.x,
      y: display.bounds.y,
      transparent: true,
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'overlayPreload.js') }
    });
    this.window.setIgnoreMouseEvents(true);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window
      .loadFile(path.join(__dirname, 'overlay.html'))
      .then(() => this.startPolling())
      .catch(() => {
        // overlay is cosmetic; failure to load must never block real execution
      });
  }

  setState(state: CursorState): void {
    this.state = state;
    this.send();
  }

  private startPolling(): void {
    if (this.poll) return;
    // ~60fps follow of the real cursor. Cheap: just reads the OS cursor point.
    this.poll = setInterval(() => this.send(), 16);
  }

  private send(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    this.window.webContents.send('raphael-cursor', {
      x: p.x - this.origin.x,
      y: p.y - this.origin.y,
      state: this.state
    });
  }

  hide(): void {
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    this.window?.close();
    this.window = null;
    this.state = 'idle';
  }

  isVisible(): boolean {
    return this.window !== null;
  }
}
