import { BrowserWindow, screen } from 'electron';
import path from 'path';
import type { CursorState } from '../../shared/ipc';
import type { CursorController } from '../core/desktop/types';

/**
 * The visible Raphael cursor (§3). A transparent, always-on-top, click-through
 * window that renders Raphael's unique celestial arrow pointer and aura.
 * Supports both tracking the user's cursor and executing human-like autonomous
 * motions (smooth gliding, targeting, clicking, and window organizing).
 */
export class CursorOverlay implements CursorController {
  private window: BrowserWindow | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private state: CursorState = 'idle';
  private origin = { x: 0, y: 0 };
  private currentPos = { x: 400, y: 300 };
  private customLabel: string | null = null;
  private isSimulating = false;

  /** Show the overlay and begin following the real cursor or display initial position. */
  show(state: CursorState = 'executing', label?: string): void {
    this.state = state;
    if (label !== undefined) this.customLabel = label;

    if (this.window && !this.window.isDestroyed()) {
      this.setState(state, label);
      return;
    }

    const display = screen.getPrimaryDisplay();
    this.origin = { x: display.bounds.x, y: display.bounds.y };
    this.currentPos = { x: display.bounds.width / 2, y: display.bounds.height / 2 };

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
      webPreferences: {
        contextIsolation: true,
        preload: path.join(__dirname, 'overlayPreload.js')
      }
    });

    this.window.setIgnoreMouseEvents(true);
    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window
      .loadFile(path.join(__dirname, 'overlay.html'))
      .then(() => {
        const p = screen.getCursorScreenPoint();
        this.currentPos = { x: p.x - this.origin.x, y: p.y - this.origin.y };
        this.send();
        this.startPolling();
      })
      .catch(() => {
        // overlay is cosmetic; failure to load must never block real execution
      });
  }

  setState(state: CursorState, label?: string): void {
    this.state = state;
    if (label !== undefined) this.customLabel = label;
    this.send();
  }

  /**
   * Smoothly animates the cursor to target screen coordinates over durationMs.
   */
  async animateTo(
    targetX: number,
    targetY: number,
    durationMs = 450,
    state?: CursorState,
    label?: string
  ): Promise<void> {
    if (state) this.state = state;
    if (label !== undefined) this.customLabel = label;

    this.show(this.state, this.customLabel ?? undefined);
    this.isSimulating = true;

    const startX = this.currentPos.x;
    const startY = this.currentPos.y;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const stepInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);

        // Ease-out cubic curve for natural human motion
        const ease = 1 - Math.pow(1 - progress, 3);
        const curX = Math.round(startX + (targetX - startX) * ease);
        const curY = Math.round(startY + (targetY - startY) * ease);

        this.currentPos = { x: curX, y: curY };
        this.send();

        if (progress >= 1) {
          clearInterval(stepInterval);
          this.isSimulating = false;
          resolve();
        }
      }, 16);
    });
  }

  /**
   * Performs an autonomous human-like execution sequence with the cursor.
   */
  async simulateHumanAction(
    type: 'search_and_open' | 'organize_window' | 'install',
    appName?: string,
    position?: string
  ): Promise<void> {
    const display = screen.getPrimaryDisplay();
    const width = display.bounds.width;
    const height = display.bounds.height;
    const name = appName || 'Application';

    if (type === 'search_and_open') {
      // 1. Appear in targeting mode near center/start button
      this.show('targeting', `RAPHAEL · SEARCHING "${name.toUpperCase()}"`);
      await new Promise((r) => setTimeout(r, 120));

      // 2. Glide down to the Windows Taskbar / Start menu
      await this.animateTo(
        Math.round(width * 0.1),
        height - 35,
        380,
        'targeting',
        `RAPHAEL · SEARCHING "${name.toUpperCase()}"`
      );

      // 3. Click search
      this.setState('clicking', `RAPHAEL · OPENING "${name.toUpperCase()}"`);
      await new Promise((r) => setTimeout(r, 220));

      // 4. Move to center screen in executing mode
      await this.animateTo(
        Math.round(width * 0.5),
        Math.round(height * 0.45),
        420,
        'executing',
        `RAPHAEL · LAUNCHING "${name.toUpperCase()}"`
      );
    } else if (type === 'organize_window') {
      const pos = (position || 'right').toLowerCase();

      // 1. Move to window title bar area
      this.show('moving', `RAPHAEL · GRABBING WINDOW`);
      await this.animateTo(Math.round(width * 0.5), 120, 350, 'moving', `RAPHAEL · TARGETING WINDOW`);
      this.setState('clicking', `RAPHAEL · GRABBING`);
      await new Promise((r) => setTimeout(r, 180));

      // 2. Drag/glide to target organization position
      if (pos === 'maximize' || pos === 'fullscreen') {
        // Move to top titlebar center / maximize button
        await this.animateTo(
          Math.round(width * 0.5),
          20,
          360,
          'moving',
          `RAPHAEL · MAXIMIZING FULLSCREEN`
        );
        this.setState('clicking', `RAPHAEL · MAXIMIZE`);
        await new Promise((r) => setTimeout(r, 200));
        this.setState('success', `RAPHAEL · FULLSCREEN`);
      } else if (pos === 'right' || pos.includes('right')) {
        // Glide to right edge
        await this.animateTo(
          width - 45,
          Math.round(height * 0.45),
          420,
          'moving',
          `RAPHAEL · SNAPPING TO RIGHT`
        );
        this.setState('clicking', `RAPHAEL · SNAP RIGHT`);
        await new Promise((r) => setTimeout(r, 200));
        this.setState('success', `RAPHAEL · RIGHT SCREEN`);
      } else if (pos === 'left' || pos.includes('left')) {
        // Glide to left edge
        await this.animateTo(
          45,
          Math.round(height * 0.45),
          420,
          'moving',
          `RAPHAEL · SNAPPING TO LEFT`
        );
        this.setState('clicking', `RAPHAEL · SNAP LEFT`);
        await new Promise((r) => setTimeout(r, 200));
        this.setState('success', `RAPHAEL · LEFT SCREEN`);
      }

      // Briefly hold success then fade
      setTimeout(() => {
        if (!this.isSimulating) this.hide();
      }, 1200);
    } else if (type === 'install') {
      this.show('targeting', `RAPHAEL · PREPARING INSTALLER`);
      await this.animateTo(
        Math.round(width * 0.5),
        Math.round(height * 0.4),
        360,
        'executing',
        `RAPHAEL · INSTALLING "${name.toUpperCase()}"`
      );
    }
  }

  private startPolling(): void {
    if (this.poll) return;
    this.poll = setInterval(() => {
      // Only poll physical OS cursor when not running an autonomous animation
      if (!this.isSimulating) {
        const p = screen.getCursorScreenPoint();
        this.currentPos = {
          x: p.x - this.origin.x,
          y: p.y - this.origin.y
        };
        this.send();
      }
    }, 16);
  }

  private send(): void {
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send('raphael-cursor', {
      x: this.currentPos.x,
      y: this.currentPos.y,
      state: this.state,
      label: this.customLabel
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
    this.customLabel = null;
    this.isSimulating = false;
  }

  isVisible(): boolean {
    return this.window !== null;
  }
}
