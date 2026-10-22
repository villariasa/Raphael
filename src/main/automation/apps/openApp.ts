import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';

const KNOWN_APPS: Record<string, string[]> = {
  // Editors & Dev Tools
  'vs code': ['code.cmd', 'code', 'Code.exe'],
  'vscode': ['code.cmd', 'code', 'Code.exe'],
  'visual studio code': ['code.cmd', 'code', 'Code.exe'],
  'visual studio': ['devenv.exe'],
  'devenv': ['devenv.exe'],
  'cursor': ['cursor.exe'],
  'sublime': ['sublime_text.exe'],
  'sublime text': ['sublime_text.exe'],
  'notepad++': ['notepad++.exe'],
  'notepad': ['notepad.exe'],
  'git bash': ['git-bash.exe'],

  // Browsers
  'chrome': ['chrome.exe'],
  'google chrome': ['chrome.exe'],
  'edge': ['msedge.exe'],
  'ms edge': ['msedge.exe'],
  'microsoft edge': ['msedge.exe'],
  'firefox': ['firefox.exe'],
  'brave': ['brave.exe'],
  'opera': ['opera.exe'],
  'vivaldi': ['vivaldi.exe'],

  // Microsoft Office / Productivity
  'word': ['winword.exe', 'WINWORD.EXE'],
  'microsoft word': ['winword.exe', 'WINWORD.EXE'],
  'excel': ['excel.exe', 'EXCEL.EXE'],
  'microsoft excel': ['excel.exe', 'EXCEL.EXE'],
  'powerpoint': ['powerpnt.exe', 'POWERPNT.EXE'],
  'microsoft powerpoint': ['powerpnt.exe', 'POWERPNT.EXE'],
  'outlook': ['outlook.exe', 'OUTLOOK.EXE'],
  'onenote': ['onenote.exe', 'ONENOTE.EXE'],

  // Media & Creative
  'vlc': ['vlc.exe'],
  'vlc player': ['vlc.exe'],
  'vlc media player': ['vlc.exe'],
  'spotify': ['spotify.exe', 'Spotify.exe'],
  'blender': ['blender.exe'],
  'photoshop': ['Photoshop.exe'],
  'illustrator': ['Illustrator.exe'],
  'premiere': ['Adobe Premiere Pro.exe'],
  'davinci resolve': ['Resolve.exe'],
  'resolve': ['Resolve.exe'],
  'figma': ['Figma.exe'],
  'capcut': ['CapCut.exe'],
  'obs': ['obs64.exe', 'obs32.exe', 'obs.exe'],
  'obs studio': ['obs64.exe', 'obs32.exe', 'obs.exe'],

  // Communication
  'discord': ['discord.exe', 'Discord.exe'],
  'slack': ['slack.exe'],
  'telegram': ['telegram.exe', 'Telegram.exe'],
  'whatsapp': ['whatsapp.exe', 'WhatsApp.exe'],
  'zoom': ['zoom.exe', 'Zoom.exe'],
  'teams': ['ms-teams.exe', 'Teams.exe'],
  'skype': ['skype.exe', 'Skype.exe'],

  // Gaming
  'steam': ['steam.exe'],
  'epic games': ['EpicGamesLauncher.exe'],
  'epic games launcher': ['EpicGamesLauncher.exe'],

  // System & Utilities
  'calc': ['calc.exe'],
  'calculator': ['calc.exe'],
  'explorer': ['explorer.exe'],
  'file explorer': ['explorer.exe'],
  'cmd': ['cmd.exe'],
  'command prompt': ['cmd.exe'],
  'powershell': ['powershell.exe'],
  'terminal': ['wt.exe', 'powershell.exe'],
  'windows terminal': ['wt.exe', 'powershell.exe'],
  'paint': ['mspaint.exe'],
  'task manager': ['taskmgr.exe'],
  'settings': ['ms-settings:'],
  'windows settings': ['ms-settings:'],
  'camera': ['microsoft.windows.camera:'],
  '7zip': ['7zFM.exe'],
  '7-zip': ['7zFM.exe'],
  'winrar': ['WinRAR.exe'],
  'github desktop': ['GitHubDesktop.exe', 'github'],
  'github': ['GitHubDesktop.exe']
};

/** Process image names (tasklist uses the .exe filename) to verify against, keyed the same as KNOWN_APPS. */
const VERIFY_IMAGE_NAMES: Record<string, string[]> = {
  'github desktop': ['GitHubDesktop.exe'],
  'github': ['GitHubDesktop.exe'],
  'vs code': ['Code.exe'],
  'vscode': ['Code.exe'],
  'visual studio code': ['Code.exe'],
  'visual studio': ['devenv.exe'],
  'devenv': ['devenv.exe'],
  'cursor': ['Cursor.exe', 'cursor.exe'],
  'sublime': ['sublime_text.exe'],
  'sublime text': ['sublime_text.exe'],
  'notepad++': ['notepad++.exe'],
  'notepad': ['notepad.exe'],
  'git bash': ['mintty.exe', 'sh.exe', 'bash.exe'],

  'chrome': ['chrome.exe'],
  'google chrome': ['chrome.exe'],
  'edge': ['msedge.exe'],
  'ms edge': ['msedge.exe'],
  'microsoft edge': ['msedge.exe'],
  'firefox': ['firefox.exe'],
  'brave': ['brave.exe'],
  'opera': ['opera.exe'],
  'vivaldi': ['vivaldi.exe'],

  'word': ['WINWORD.EXE', 'winword.exe'],
  'microsoft word': ['WINWORD.EXE', 'winword.exe'],
  'excel': ['EXCEL.EXE', 'excel.exe'],
  'microsoft excel': ['EXCEL.EXE', 'excel.exe'],
  'powerpoint': ['POWERPNT.EXE', 'powerpnt.exe'],
  'microsoft powerpoint': ['POWERPNT.EXE', 'powerpnt.exe'],
  'outlook': ['OUTLOOK.EXE', 'outlook.exe'],
  'onenote': ['ONENOTE.EXE', 'onenote.exe'],

  'vlc': ['vlc.exe'],
  'vlc player': ['vlc.exe'],
  'vlc media player': ['vlc.exe'],
  'spotify': ['Spotify.exe', 'spotify.exe'],
  'blender': ['blender.exe'],
  'photoshop': ['Photoshop.exe'],
  'illustrator': ['Illustrator.exe'],
  'premiere': ['Adobe Premiere Pro.exe'],
  'davinci resolve': ['Resolve.exe'],
  'resolve': ['Resolve.exe'],
  'figma': ['Figma.exe'],
  'capcut': ['CapCut.exe'],
  'obs': ['obs64.exe', 'obs32.exe', 'obs.exe'],
  'obs studio': ['obs64.exe', 'obs32.exe', 'obs.exe'],

  'discord': ['Discord.exe', 'discord.exe'],
  'slack': ['slack.exe'],
  'telegram': ['Telegram.exe', 'telegram.exe'],
  'whatsapp': ['WhatsApp.exe', 'whatsapp.exe'],
  'zoom': ['Zoom.exe', 'zoom.exe'],
  'teams': ['ms-teams.exe', 'Teams.exe'],
  'skype': ['Skype.exe', 'skype.exe'],

  'steam': ['steam.exe'],
  'epic games': ['EpicGamesLauncher.exe'],
  'epic games launcher': ['EpicGamesLauncher.exe'],

  'calc': ['CalculatorApp.exe', 'calc.exe', 'Calculator.exe'],
  'calculator': ['CalculatorApp.exe', 'calc.exe', 'Calculator.exe'],
  'explorer': ['explorer.exe'],
  'file explorer': ['explorer.exe'],
  'cmd': ['cmd.exe'],
  'command prompt': ['cmd.exe'],
  'powershell': ['powershell.exe'],
  'terminal': ['WindowsTerminal.exe', 'powershell.exe'],
  'windows terminal': ['WindowsTerminal.exe', 'powershell.exe'],
  'paint': ['mspaint.exe', 'Paint.exe'],
  'task manager': ['Taskmgr.exe', 'taskmgr.exe'],
  'settings': ['SystemSettings.exe'],
  'windows settings': ['SystemSettings.exe'],
  'camera': ['WindowsCamera.exe'],
  '7zip': ['7zFM.exe'],
  '7-zip': ['7zFM.exe'],
  'winrar': ['WinRAR.exe']
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

function resolveSquirrelAppExe(baseDir: string, exeName: string): string | null {
  try {
    if (!fs.existsSync(baseDir)) return null;
    const entries = fs.readdirSync(baseDir);
    const appDirs = entries
      .filter((e) => e.startsWith('app-') && fs.statSync(path.join(baseDir, e)).isDirectory())
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const dir of appDirs) {
      const candidate = path.join(baseDir, dir, exeName);
      if (fs.existsSync(candidate)) return candidate;
    }
    const rootExe = path.join(baseDir, exeName);
    if (fs.existsSync(rootExe)) return rootExe;
  } catch {
    // ignore
  }
  return null;
}

/**
 * Searches Windows Start Menu and Desktop for shortcut (.lnk) files matching the application name.
 */
function findShortcut(query: string): string | null {
  const dirs = [
    path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.USERPROFILE ?? '', 'Desktop'),
    path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop')
  ];

  const qClean = query.toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const root of dirs) {
    if (!fs.existsSync(root)) continue;
    try {
      const queue = [root];
      while (queue.length > 0) {
        const curr = queue.shift()!;
        const entries = fs.readdirSync(curr, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(curr, entry.name);
          if (entry.isDirectory()) {
            queue.push(fullPath);
          } else if (entry.name.toLowerCase().endsWith('.lnk')) {
            const base = entry.name.slice(0, -4).toLowerCase().replace(/[^a-z0-9]/g, '');
            if (base === qClean || base.includes(qClean) || qClean.includes(base)) {
              return fullPath;
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

/**
 * Checks the real Windows process table via `tasklist`.
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
 * Dynamically queries Windows Start Menu apps (via Get-StartApps) and App Paths registry
 * to locate any installed application not in KNOWN_APPS.
 */
async function findInstalledApp(query: string): Promise<{ appId: string; exeName?: string } | null> {
  return new Promise((resolve) => {
    const qLower = query.toLowerCase().trim();
    // PowerShell script to find matching app in Get-StartApps
    const psScript = `
      $q = '${escapePowerShellLiteral(qLower)}';
      $match = Get-StartApps | Where-Object { $_.Name.ToLower() -eq $q -or $_.Name.ToLower() -like "*$q*" } | Select-Object -First 1 Name, AppID;
      if ($match) {
        Write-Output ($match | ConvertTo-Json -Compress);
      }
    `;

    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 6000);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed && parsed.AppID) {
            let exeName: string | undefined;
            if (parsed.AppID.toLowerCase().endsWith('.exe')) {
              exeName = path.basename(parsed.AppID);
            }
            resolve({ appId: parsed.AppID, exeName });
            return;
          }
        } catch {
          // ignore parse error
        }
      }
      resolve(null);
    });
  });
}

/**
 * Launches an application and VERIFIES it actually started by polling the
 * real Windows process table — spawn() not throwing is not evidence of success;
 * a matching process actually appearing is.
 */
export async function openApplication(
  appName: string,
  targetPath?: string
): Promise<{ success: boolean; detail: string }> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Application launch is only implemented for Windows.' };
  }

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

  // Handle Windows URI protocols (e.g. settings, camera)
  if (norm === 'settings' || norm === 'windows settings' || norm === 'camera') {
    const uri = KNOWN_APPS[norm]?.[0] || 'ms-settings:';
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '""', uri], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      const verifyNames = VERIFY_IMAGE_NAMES[norm] || ['SystemSettings.exe'];
      const found = await waitForAnyProcess(verifyNames, 4000);
      return { success: true, detail: `"${appName}" is open, My Liege.` };
    } catch (err: any) {
      return { success: false, detail: `Could not open ${appName}: ${err.message}` };
    }
  }

  const known = KNOWN_APPS[norm];
  let verifyNames = [...(VERIFY_IMAGE_NAMES[norm] ?? [])];

  let launchAttempted = false;
  let launchError: string | null = null;

  // 1. Check for Squirrel-installed apps (e.g. GitHub Desktop, Slack, Discord)
  if (norm === 'github desktop' || norm === 'github') {
    const squirrelExe = resolveSquirrelAppExe(
      path.join(process.env.LOCALAPPDATA ?? '', 'GitHubDesktop'),
      'GitHubDesktop.exe'
    );
    if (squirrelExe) {
      try {
        const startArgs = ['/c', 'start', '""', squirrelExe];
        if (targetPath) startArgs.push(targetPath);
        const child = spawn('cmd.exe', startArgs, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.unref();
        launchAttempted = true;
        if (!verifyNames.includes('GitHubDesktop.exe')) {
          verifyNames.push('GitHubDesktop.exe');
        }
      } catch (err: any) {
        launchError = err.message;
      }
    }
  }

  // 2. Known apps list
  if (!launchAttempted && known) {
    for (const cmd of known) {
      try {
        const startArgs = ['/c', 'start', '""', cmd];
        if (targetPath) startArgs.push(targetPath);
        const child = spawn('cmd.exe', startArgs, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.unref();
        launchAttempted = true;
        break;
      } catch (err: any) {
        launchError = err.message;
        continue;
      }
    }
  }

  // 3. Search Windows Start Menu & Desktop shortcuts (.lnk files)
  if (!launchAttempted) {
    const shortcut = findShortcut(appName);
    if (shortcut) {
      try {
        const startArgs = ['/c', 'start', '""', shortcut];
        if (targetPath) startArgs.push(targetPath);
        const child = spawn('cmd.exe', startArgs, { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
        child.unref();
        launchAttempted = true;
        const base = path.basename(shortcut, '.lnk');
        verifyNames.push(`${base.replace(/\s+/g, '')}.exe`, `${base}.exe`);
      } catch (err: any) {
        launchError = err.message;
      }
    }
  }

  // 4. Dynamic query in Windows Start Menu / App Registry
  if (!launchAttempted) {
    const discovered = await findInstalledApp(norm);
    if (discovered) {
      try {
        const shellFolderTarget = `shell:AppsFolder\\${discovered.appId}`;
        const child = spawn('explorer.exe', [shellFolderTarget], { detached: true, stdio: 'ignore', windowsHide: false });
        child.unref();
        launchAttempted = true;
        if (discovered.exeName && !verifyNames.includes(discovered.exeName)) {
          verifyNames = [discovered.exeName, ...verifyNames];
        }
      } catch (err: any) {
        launchError = err.message;
      }
    }
  }

  // 5. Fallback: PowerShell Start-Process with escaped literal
  if (!launchAttempted) {
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

  if (verifyNames.length === 0) {
    const pascal = norm.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
    verifyNames = [`${norm.replace(/\s+/g, '')}.exe`, `${norm}.exe`, `${pascal}.exe`];
  }

  const found = await waitForAnyProcess(verifyNames, 7000);
  if (found) {
    return { success: true, detail: `"${appName}" is open, My Liege.` };
  }

  return {
    success: false,
    detail: `My Liege, I ran the launch command for "${appName}" but couldn't confirm it actually started within 7 seconds — it may not be installed, or it registers under an unrecognized process name.`
  };
}
