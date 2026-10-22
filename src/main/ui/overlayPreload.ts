import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload for the cursor-overlay window. Exposes the real-cursor position +
 * state stream (sent from main's screen.getCursorScreenPoint poll) to the
 * overlay's own script, under contextIsolation.
 */
contextBridge.exposeInMainWorld('raphaelCursor', {
  on: (cb: (data: { x: number; y: number; state: string }) => void) =>
    ipcRenderer.on('raphael-cursor', (_e, data) => cb(data))
});
