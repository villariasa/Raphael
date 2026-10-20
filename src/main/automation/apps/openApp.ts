import { spawn } from 'child_process';
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

export async function openApplication(appName: string, targetPath?: string): Promise<{ success: boolean; detail: string }> {
  const norm = appName.toLowerCase().trim();

  // Special handling for VS Code
  if (norm === 'vs code' || norm === 'vscode' || norm === 'visual studio code' || norm === 'code') {
    const vsCodeExe = resolveVsCodeExecutable();
    const target = vsCodeExe || 'code';
    const args = targetPath ? [targetPath] : [];

    const child = spawn(target, args, {
      detached: true,
      stdio: 'ignore',
      shell: true,
      windowsHide: false
    });
    child.unref();
    return { success: true, detail: `Launched Visual Studio Code ${targetPath ? `at "${targetPath}"` : ''}`.trim() };
  }

  const known = KNOWN_APPS[norm];
  const candidates = known ? known : [appName];

  // Try direct launch via cmd.exe start
  for (const cmd of candidates) {
    try {
      const args = targetPath ? `"${targetPath}"` : '';
      const child = spawn('cmd.exe', ['/c', 'start', '""', cmd, args], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false
      });
      child.unref();
      return { success: true, detail: `Launched "${cmd}" ${args}`.trim() };
    } catch {
      continue;
    }
  }

  // Fallback: PowerShell Start-Process
  try {
    const psCmd = targetPath
      ? `Start-Process -FilePath "${appName}" -ArgumentList "${targetPath}"`
      : `Start-Process -FilePath "${appName}"`;
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return { success: true, detail: `Started process "${appName}" via PowerShell` };
  } catch (err: any) {
    throw new Error(`Failed to open application "${appName}": ${err.message}`);
  }
}
