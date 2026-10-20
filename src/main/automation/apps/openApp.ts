import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

const KNOWN_APPS: Record<string, string[]> = {
  'vs code': ['code.cmd', 'code', 'Code.exe'],
  'vscode': ['code.cmd', 'code', 'Code.exe'],
  'visual studio code': ['code.cmd', 'code', 'Code.exe'],
  'notepad': ['notepad.exe'],
  'chrome': ['chrome.exe'],
  'google chrome': ['chrome.exe'],
  'edge': ['msedge.exe'],
  'ms edge': ['msedge.exe'],
  'microsoft edge': ['msedge.exe'],
  'calc': ['calc.exe'],
  'calculator': ['calc.exe'],
  'explorer': ['explorer.exe'],
  'file explorer': ['explorer.exe'],
  'cmd': ['cmd.exe'],
  'command prompt': ['cmd.exe'],
  'powershell': ['powershell.exe'],
  'terminal': ['wt.exe', 'powershell.exe'],
  'windows terminal': ['wt.exe', 'powershell.exe'],
  'spotify': ['spotify.exe'],
  'discord': ['discord.exe'],
  'slack': ['slack.exe'],
  'paint': ['mspaint.exe'],
  'task manager': ['taskmgr.exe']
};

/** Process image names (tasklist uses the .exe filename) to verify against, keyed the same as KNOWN_APPS. */
const VERIFY_IMAGE_NAMES: Record<string, string[]> = {
  'vs code': ['Code.exe'],
  'vscode': ['Code.exe'],
  'visual studio code': ['Code.exe'],
  'notepad': ['notepad.exe'],
  'chrome': ['chrome.exe'],
  'google chrome': ['chrome.exe'],
  'edge': ['msedge.exe'],
  'ms edge': ['msedge.exe'],
  'microsoft edge': ['msedge.exe'],
  'calc': ['CalculatorApp.exe', 'calc.exe', 'Calculator.exe'],
  'calculator': ['CalculatorApp.exe', 'calc.exe', 'Calculator.exe'],
  'explorer': ['explorer.exe'],
  'file explorer': ['explorer.exe'],
  'cmd': ['cmd.exe'],
  'command prompt': ['cmd.exe'],
  'powershell': ['powershell.exe'],
  'terminal': ['WindowsTerminal.exe', 'powershell.exe'],
  'windows terminal': ['WindowsTerminal.exe', 'powershell.exe'],
  'spotify': ['Spotify.exe'],
  'discord': ['Discord.exe'],
  'slack': ['slack.exe'],
  'paint': ['mspaint.exe'],
  'task manager': ['Taskmgr.exe']
};

/** App names never legitimately need shell/PowerShell metacharacters. */
const SAFE_APP_NAME = /^[A-Za-z0-9 ._+-]+$/;
/** Paths can contain drive letters, colons, backslashes, spaces — but never shell/PowerShell metacharacters or quotes. */
const SAFE_PATH = /^[^&|<>^%"'`$\n\r]+$/;

function escapePowerShellLiteral(input: string): string {
  return input.replace(/'/g, "''");
}

function resolveVsCodeExecutable(): string | null {
  const localAppData = process.env.LOCALAPPDATA;
  const progFiles = process.env.PROGRAMFILES;
  const progFilesX86 = process.env['PROGRAMFILES(X86)'];

  const candidates = [
    localAppData ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe') : null,
    localAppData ? path.join(localAppData, 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd') : null,
    progFiles ? path.join(progFiles, 'Microsoft VS Code', 'Code.exe') : null,
    progFilesX86 ? path.join(progFilesX86, 'Microsoft VS Code', 'Code.exe') : null
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Checks the real Windows process table via `tasklist` — not a guess, an
 * actual query. Uses execFile with an argument array (no shell), since
 * imageName can originate from a raw, unvalidated app name for apps not in
 * KNOWN_APPS/VERIFY_IMAGE_NAMES.
 */
function isProcessRunning(imageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(false);
      return;
    }
    execFile('tasklist', ['/NH', '/FI', `IMAGENAME eq ${imageName}`], { timeout: 5000 }, (err, stdout) => {
      if (err) {
        resolve(false);
        return;
      }
      resolve(stdout.toLowerCase().includes(imageName.toLowerCase()));
    });
  });
}

/** Polls the process table for up to `timeoutMs` — returns the image name that was found, or null. */
async function waitForAnyProcess(imageNames: string[], timeoutMs = 6000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of imageNames) {
      if (await isProcessRunning(name)) return name;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return null;
}

/**
 * Launches an application and VERIFIES it actually started by polling the
 * real Windows process table (§17/§21/§22) — spawn() not throwing is not
 * evidence of success; a matching process actually appearing is.
 */
export async function openApplication(appName: string, targetPath?: string): Promise<{ success: boolean; detail: string }> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Application launch is only implemented for Windows.' };
  }

  // appName/targetPath can be LLM- or user-supplied free text. Reject
  // anything containing shell/PowerShell metacharacters up front — app
  // names and paths never legitimately need them, and every launch path
  // below (cmd.exe's command-line grammar, PowerShell's literal parsing)
  // is vulnerable to them otherwise.
  if (!SAFE_APP_NAME.test(appName.trim())) {
    return { success: false, detail: `My Liege, "${appName}" has characters I'm not passing to a launcher.` };
  }
  if (targetPath !== undefined && !SAFE_PATH.test(targetPath)) {
    return { success: false, detail: "My Liege, that target path has characters I'm not passing to a launcher." };
  }

  const norm = appName.toLowerCase().trim();
  const isVsCode = norm === 'vs code' || norm === 'vscode' || norm === 'visual studio code' || norm === 'code';

  if (isVsCode) {
    const vsCodeExe = resolveVsCodeExecutable();
    const target = vsCodeExe || 'code';
    const args = targetPath ? [targetPath] : [];
    try {
      const child = spawn(target, args, { detached: true, stdio: 'ignore', shell: true, windowsHide: false });
      child.unref();
    } catch (err: any) {
      return { success: false, detail: `My Liege, VS Code wouldn't launch: ${err.message}` };
    }
    const found = await waitForAnyProcess(VERIFY_IMAGE_NAMES['vs code']);
    return found
      ? { success: true, detail: `VS Code is open${targetPath ? ` at "${targetPath}"` : ''}, My Liege.` }
      : { success: false, detail: `My Liege, I ran the launch command for VS Code but couldn't confirm it actually started.` };
  }

  const known = KNOWN_APPS[norm];
  const verifyNames = VERIFY_IMAGE_NAMES[norm] ?? [`${norm.replace(/\s+/g, '')}.exe`];

  let launchAttempted = false;
  let launchError: string | null = null;

  if (known) {
    // Only ever reach cmd.exe's `start` with our own hardcoded, vetted exe
    // names (KNOWN_APPS values) — never with raw user/LLM-supplied text,
    // since `start` is re-parsed by cmd.exe's own command-line grammar.
    for (const cmd of known) {
      try {
        const args = targetPath ? `"${targetPath}"` : '';
        const child = spawn('cmd.exe', ['/c', 'start', '""', cmd, args], { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.unref();
        launchAttempted = true;
        break;
      } catch (err: any) {
        launchError = err.message;
        continue;
      }
    }
  }

  if (!launchAttempted) {
    // Fallback for apps not in KNOWN_APPS: PowerShell Start-Process with a
    // properly escaped single-quoted literal (not double-quoted — only
    // single-quoted PowerShell strings are free of subexpression
    // expansion), after the charset check above already rejected anything
    // containing a backtick or `$`.
    try {
      const safeAppName = escapePowerShellLiteral(appName.trim());
      const psCmd = targetPath
        ? `Start-Process -FilePath '${safeAppName}' -ArgumentList '${escapePowerShellLiteral(targetPath)}'`
        : `Start-Process -FilePath '${safeAppName}'`;
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      launchAttempted = true;
    } catch (err: any) {
      return { success: false, detail: `My Liege, "${appName}" wouldn't launch: ${launchError ?? err.message}` };
    }
  }

  const found = await waitForAnyProcess(verifyNames);
  if (found) {
    return { success: true, detail: `"${appName}" is open, My Liege.` };
  }
  return {
    success: false,
    detail: `My Liege, I ran the launch command for "${appName}" but couldn't confirm it actually started within 6 seconds — it may not be installed, or it registers under a process name I don't know yet.`
  };
}
