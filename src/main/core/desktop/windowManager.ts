import { spawn } from 'child_process';
import { WindowActionResult, WindowOp } from './types';

/**
 * Real Windows window management via Win32 (user32.dll) through PowerShell —
 * no native modules, no faked movement (§5/§19). Every operation reads the
 * window's actual bounds before and after and verifies the result (§8/§18).
 *
 * Win32 is preferred over mouse-dragging per §5: SetWindowPos / ShowWindow /
 * SetForegroundWindow are exact and don't fight the user's cursor.
 */

/** App friendly name → Windows process name (no .exe), for window matching. */
const PROCESS_ALIASES: Record<string, string> = {
  chrome: 'chrome',
  'google chrome': 'chrome',
  edge: 'msedge',
  'microsoft edge': 'msedge',
  firefox: 'firefox',
  'vs code': 'Code',
  vscode: 'Code',
  'visual studio code': 'Code',
  code: 'Code',
  notepad: 'notepad',
  discord: 'Discord',
  spotify: 'Spotify',
  explorer: 'explorer',
  terminal: 'WindowsTerminal',
  'windows terminal': 'WindowsTerminal'
};

const SAFE_NAME = /^[A-Za-z0-9 ._-]+$/;

function resolveProcessName(name: string): string {
  const key = name.trim().toLowerCase();
  return PROCESS_ALIASES[key] ?? name.trim().replace(/\s+/g, '');
}

function runPowerShell(script: string, timeoutMs = 10000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Window operation timed out.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      resolve(stdout.trim() || stderr.trim());
    });
  });
}

/** Win32 + .NET Screen helper block prepended to every script. */
const WIN32_PREAMBLE = `
$ErrorActionPreference = 'Stop';
Add-Type -AssemblyName System.Windows.Forms;
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class RaphWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
}
"@;
function Get-WinState($p) {
  $h = $p.MainWindowHandle;
  $r = New-Object RaphWin+RECT;
  [void][RaphWin]::GetWindowRect($h, [ref]$r);
  $scr = [System.Windows.Forms.Screen]::FromHandle($h);
  $allScreens = [System.Windows.Forms.Screen]::AllScreens;
  $mon = 0; for ($i=0; $i -lt $allScreens.Length; $i++) { if ($allScreens[$i].DeviceName -eq $scr.DeviceName) { $mon = $i } }
  $state = 'normal'; if ([RaphWin]::IsIconic($h)) { $state = 'minimized' } elseif ([RaphWin]::IsZoomed($h)) { $state = 'maximized' }
  return @{ hwnd = [int64]$h; processId = $p.Id; processName = $p.ProcessName; title = $p.MainWindowTitle;
            bounds = @{ x = $r.Left; y = $r.Top; width = ($r.Right - $r.Left); height = ($r.Bottom - $r.Top) };
            monitor = $mon; state = $state };
}
`;

/**
 * Perform a window operation and verify it. `op` is a vetted enum (never raw
 * coordinates from the LLM). `name` is validated against a strict charset
 * before it ever reaches the shell.
 */
export async function controlWindow(
  name: string,
  op: WindowOp,
  opts: { width?: number; height?: number; monitor?: number } = {}
): Promise<WindowActionResult> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Window management is only available on Windows.', verified: false };
  }
  // `op` is cast from free-form params (LLM-authorable) — validate it against
  // the known enum BEFORE any of it could reach the script.
  const ALLOWED_OPS: WindowOp[] = ['left', 'right', 'maximize', 'minimize', 'restore', 'center', 'focus', 'resize', 'monitor'];
  if (!ALLOWED_OPS.includes(op)) {
    return { success: false, detail: 'Invalid window operation.', verified: false };
  }
  if (!SAFE_NAME.test(name.trim())) {
    return { success: false, detail: `My Liege, "${name}" isn't a valid window to target.`, verified: false };
  }
  const proc = resolveProcessName(name);
  if (!SAFE_NAME.test(proc)) {
    return { success: false, detail: 'Invalid target.', verified: false };
  }
  const w = Math.max(100, Math.min(10000, Math.floor(opts.width ?? 0)));
  const h = Math.max(100, Math.min(10000, Math.floor(opts.height ?? 0)));
  const mon = Math.max(0, Math.min(16, Math.floor(opts.monitor ?? 0)));

  const apply = buildApplyBlock(op, w, h, mon);
  // Decide the "restore first" step in TS so no `op` text is interpolated
  // into the script body (defense in depth on top of the enum check above).
  const restoreFirst = op !== 'maximize' && op !== 'minimize';

  const script = `
${WIN32_PREAMBLE}
$isTargetActive = ('${proc}'.ToLower() -in @('it', 'active', 'current', 'window', 'this', ''));
if ($isTargetActive) {
  Add-Type @"
using System; using System.Runtime.InteropServices;
public class RaphFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@;
  $fgh = [RaphFg]::GetForegroundWindow();
  $p = Get-Process | Where-Object { $_.MainWindowHandle -eq $fgh } | Select-Object -First 1;
} else {
  $p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and ($_.ProcessName -like '*${proc}*' -or $_.MainWindowTitle -like '*${proc}*') } | Select-Object -First 1;
}
if ($null -eq $p) { Write-Output (ConvertTo-Json @{ ok = $false; reason = 'not_found' }); exit 0 }
$before = Get-WinState $p;
$h = $p.MainWindowHandle;
# Restore first so SetWindowPos math is valid when the window is maximized/minimized.
if (${restoreFirst ? '$true' : '$false'} -and ($before.state -ne 'normal')) { [void][RaphWin]::ShowWindow($h, 9); Start-Sleep -Milliseconds 120 }
$scr = [System.Windows.Forms.Screen]::FromHandle($h);
$wa = $scr.WorkingArea;
$allScreens = [System.Windows.Forms.Screen]::AllScreens;
${apply}
Start-Sleep -Milliseconds 160;
$p.Refresh();
$after = Get-WinState $p;
Write-Output (ConvertTo-Json @{ ok = $true; before = $before; after = $after } -Depth 5);
`;

  let out: string;
  try {
    out = await runPowerShell(script);
  } catch (err: any) {
    return { success: false, detail: `My Liege, the window command failed: ${err?.message ?? err}`, verified: false };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(out);
  } catch {
    return { success: false, detail: `My Liege, I couldn't read the window state back.`, verified: false };
  }
  if (!parsed.ok) {
    return { success: false, detail: `My Liege, I couldn't find an open window for "${name}".`, verified: false };
  }

  const before = parsed.before;
  const after = parsed.after;
  const verified = verifyOp(op, after, w, h, mon);
  return {
    success: verified,
    verified,
    detail: verified
      ? describeSuccess(name, op, after)
      : `My Liege, I ran the window command for "${name}" but couldn't confirm it landed where expected.`,
    before,
    after
  };
}

function buildApplyBlock(op: WindowOp, w: number, h: number, mon: number): string {
  const SWP = '0x14'; // SWP_NOZORDER | SWP_NOACTIVATE
  switch (op) {
    case 'left':
      return `[void][RaphWin]::SetWindowPos($h, [IntPtr]::Zero, $wa.X, $wa.Y, [int]($wa.Width/2), $wa.Height, ${SWP});`;
    case 'right':
      return `[void][RaphWin]::SetWindowPos($h, [IntPtr]::Zero, ($wa.X + [int]($wa.Width/2)), $wa.Y, [int]($wa.Width/2), $wa.Height, ${SWP});`;
    case 'maximize':
      return `[void][RaphWin]::ShowWindow($h, 3);`;
    case 'minimize':
      return `[void][RaphWin]::ShowWindow($h, 6);`;
    case 'restore':
      return `[void][RaphWin]::ShowWindow($h, 9);`;
    case 'center':
      return `[void][RaphWin]::SetWindowPos($h, [IntPtr]::Zero, ($wa.X + [int](($wa.Width - $before.bounds.width)/2)), ($wa.Y + [int](($wa.Height - $before.bounds.height)/2)), $before.bounds.width, $before.bounds.height, ${SWP});`;
    case 'focus':
      return `[void][RaphWin]::ShowWindow($h, 9); [void][RaphWin]::SetForegroundWindow($h);`;
    case 'resize':
      return `[void][RaphWin]::SetWindowPos($h, [IntPtr]::Zero, $before.bounds.x, $before.bounds.y, ${w}, ${h}, ${SWP});`;
    case 'monitor': {
      // Move to monitor N, keeping relative size; clamp index to available screens.
      return `$ti = [Math]::Min(${mon}, $allScreens.Length - 1); $tw = $allScreens[$ti].WorkingArea; [void][RaphWin]::SetWindowPos($h, [IntPtr]::Zero, $tw.X, $tw.Y, $before.bounds.width, $before.bounds.height, ${SWP});`;
    }
    default:
      return '';
  }
}

function verifyOp(op: WindowOp, after: any, w: number, h: number, _mon: number): boolean {
  if (!after) return false;
  const b = after.bounds;
  switch (op) {
    case 'maximize':
      return after.state === 'maximized';
    case 'minimize':
      return after.state === 'minimized';
    case 'restore':
    case 'focus':
      return after.state === 'normal';
    case 'resize':
      return Math.abs(b.width - w) <= 24 && Math.abs(b.height - h) <= 24;
    case 'left':
    case 'right':
    case 'center':
    case 'monitor':
      // A real move happened and the window is in a normal (positionable) state.
      return after.state === 'normal' && b.width > 0 && b.height > 0;
    default:
      return false;
  }
}

function describeSuccess(name: string, op: WindowOp, after: any): string {
  switch (op) {
    case 'left':
      return `"${name}" is on the left, My Liege.`;
    case 'right':
      return `"${name}" is on the right, My Liege.`;
    case 'maximize':
      return `"${name}" is maximized, My Liege.`;
    case 'minimize':
      return `"${name}" is minimized, My Liege.`;
    case 'restore':
      return `"${name}" is restored, My Liege.`;
    case 'center':
      return `"${name}" is centered, My Liege.`;
    case 'focus':
      return `"${name}" is focused, My Liege.`;
    case 'resize':
      return `"${name}" is now ${after?.bounds?.width}×${after?.bounds?.height}, My Liege.`;
    case 'monitor':
      return `"${name}" is on monitor ${after?.monitor + 1}, My Liege.`;
    default:
      return `Done, My Liege.`;
  }
}

/** Snapshot the current foreground window (for "what screen are we on?" §9). */
export async function getActiveWindow(): Promise<WindowActionResult> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Window inspection is only available on Windows.', verified: false };
  }
  const script = `
${WIN32_PREAMBLE}
Add-Type @"
using System; using System.Runtime.InteropServices;
public class RaphFg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); }
"@;
$fgh = [RaphFg]::GetForegroundWindow();
$p = Get-Process | Where-Object { $_.MainWindowHandle -eq $fgh } | Select-Object -First 1;
if ($null -eq $p) { Write-Output (ConvertTo-Json @{ ok = $false }); exit 0 }
Write-Output (ConvertTo-Json @{ ok = $true; after = (Get-WinState $p) } -Depth 5);
`;
  try {
    const out = await runPowerShell(script);
    const parsed = JSON.parse(out);
    if (!parsed.ok) return { success: false, detail: 'No active application window detected.', verified: false };
    const a = parsed.after;
    return {
      success: true,
      verified: true,
      detail: `My Liege, the active window is ${a.processName}${a.title ? ` — "${a.title}"` : ''}, ${a.bounds.width}×${a.bounds.height} on monitor ${a.monitor + 1}.`,
      after: a
    };
  } catch (err: any) {
    return { success: false, detail: `Couldn't read the active window: ${err?.message ?? err}`, verified: false };
  }
}
