/**
 * Desktop Engine contracts (§20). These describe REAL OS state — every value
 * comes from the actual Windows desktop (Win32 / UIA), never mocked (§19).
 */

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WindowVisualState = 'normal' | 'minimized' | 'maximized';

export interface WindowState {
  hwnd: number;
  processId: number;
  processName: string;
  title: string;
  bounds: WindowBounds;
  monitor: number;
  state: WindowVisualState;
}

/** Window operations the Window Manager can perform (§5). */
export type WindowOp =
  | 'left'
  | 'right'
  | 'maximize'
  | 'minimize'
  | 'restore'
  | 'center'
  | 'focus'
  | 'resize'
  | 'monitor';

export interface WindowActionResult {
  success: boolean;
  detail: string;
  /** whether the post-action re-read confirmed the expected state (§8/§18) */
  verified: boolean;
  before?: WindowState;
  after?: WindowState;
}

/** Drives the visible Raphael cursor overlay (§3). Implemented by CursorOverlay. */
export interface CursorController {
  show(state: import('../../../shared/ipc').CursorState): void;
  setState(state: import('../../../shared/ipc').CursorState): void;
  hide(): void;
}
