import { spawn, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface InstallOptions {
  appName: string;
  manager?: 'auto' | 'winget' | 'choco' | 'npm' | 'pip';
  packageId?: string;
  version?: string;
  silent?: boolean;
}

export interface InstallResult {
  success: boolean;
  detail: string;
  manager?: string;
  installedId?: string;
}

export interface InstalledAppInfo {
  name: string;
  appId: string;
}

const SAFE_NAME_PATTERN = /^[A-Za-z0-9 ._@/+-]+$/;

async function checkCommand(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 4000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Searches winget for candidate packages matching the query and returns
 * the best matching Package Id if found.
 */
export async function searchWingetPackage(query: string): Promise<{ id: string; name: string } | null> {
  return new Promise((resolve) => {
    const child = spawn(
      'winget',
      ['search', query, '--accept-source-agreements'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
    );

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 15000);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        resolve(null);
        return;
      }

      // Parse tabular output from winget
      // Name                           Id                     Version     Match        Source
      // -------------------------------------------------------------------------------------
      // VLC media player               VideoLAN.VLC           3.0.24      Moniker: vlc winget
      const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
      const sepIndex = lines.findIndex((l) => l.startsWith('---') || l.includes('-----'));
      if (sepIndex === -1 || sepIndex + 1 >= lines.length) {
        resolve(null);
        return;
      }

      const results: Array<{ name: string; id: string }> = [];
      for (let i = sepIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        // Split on 2 or more spaces
        const parts = line.split(/\s{2,}/).map((p) => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
          results.push({ name: parts[0], id: parts[1] });
        }
      }

      if (results.length === 0) {
        resolve(null);
        return;
      }

      // Prefer exact moniker/name match or winget/msstore ID
      const qLower = query.toLowerCase().trim();
      const exactMatch = results.find(
        (r) => r.name.toLowerCase() === qLower || r.id.toLowerCase() === qLower
      );
      if (exactMatch) {
        resolve(exactMatch);
        return;
      }

      // First result from list
      resolve(results[0]);
    });
  });
}

/**
 * Installs an application or package on Windows using winget, chocolatey, npm, or pip.
 */
export async function installApplication(
  options: InstallOptions,
  onProgress?: (msg: string) => void
): Promise<InstallResult> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Application installation is currently only supported on Windows, My Liege.' };
  }

  const rawName = (options.appName || '').trim();
  if (!rawName) {
    return { success: false, detail: 'My Liege, no application name was specified to install.' };
  }

  if (!SAFE_NAME_PATTERN.test(rawName)) {
    return { success: false, detail: `My Liege, "${rawName}" contains characters that are unsafe for package managers.` };
  }

  let mgr = options.manager ?? 'auto';

  // Auto-detect manager based on query or prefix
  if (mgr === 'auto') {
    if (/^npm\s+/i.test(rawName) || /^@[\w-]+\/[\w-]+/.test(rawName)) {
      mgr = 'npm';
    } else if (/^pip\s+/i.test(rawName) || /^python\s+-m\s+pip\s+/i.test(rawName)) {
      mgr = 'pip';
    } else {
      mgr = 'winget';
    }
  }

  const cleanName = rawName.replace(/^(?:npm|pip|winget|choco)\s+(?:install\s+)?/i, '').trim();

  if (mgr === 'npm') {
    onProgress?.(`Installing npm package "${cleanName}" globally...`);
    return runGenericInstaller('npm', ['install', '-g', cleanName], cleanName, 'npm');
  }

  if (mgr === 'pip') {
    onProgress?.(`Installing Python package "${cleanName}"...`);
    const hasPython = await checkCommand('python', ['--version']);
    const exe = hasPython ? 'python' : 'pip';
    const args = hasPython ? ['-m', 'pip', 'install', cleanName] : ['install', cleanName];
    return runGenericInstaller(exe, args, cleanName, 'pip');
  }

  if (mgr === 'choco') {
    onProgress?.(`Installing "${cleanName}" via Chocolatey...`);
    return runGenericInstaller('choco', ['install', cleanName, '-y'], cleanName, 'choco');
  }

  // Default: winget
  onProgress?.(`Checking package registry for "${cleanName}"...`);
  const hasWinget = await checkCommand('winget', ['--version']);
  if (!hasWinget) {
    const hasChoco = await checkCommand('choco', ['--version']);
    if (hasChoco) {
      onProgress?.('Winget not found; falling back to Chocolatey...');
      return runGenericInstaller('choco', ['install', cleanName, '-y'], cleanName, 'choco');
    }
    return {
      success: false,
      detail: 'My Liege, winget (Windows Package Manager) is not available on this system.'
    };
  }

  // Check if caller gave an explicit packageId, or search for the best ID
  let targetId = options.packageId;
  let targetDisplayName = cleanName;
  if (!targetId) {
    const found = await searchWingetPackage(cleanName);
    if (found) {
      targetId = found.id;
      targetDisplayName = found.name;
    }
  }

  const installArgs = [
    'install',
    targetId ? '--id' : cleanName,
    ...(targetId ? [targetId, '--exact'] : []),
    '--accept-package-agreements',
    '--accept-source-agreements',
    '--disable-interactivity'
  ];

  onProgress?.(`Installing ${targetDisplayName}${targetId ? ` (${targetId})` : ''} via winget...`);

  return new Promise<InstallResult>((resolve) => {
    const child = spawn('winget', installArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      // Extract download progress lines
      if (text.includes('%') || text.toLowerCase().includes('download') || text.toLowerCase().includes('verifying') || text.toLowerCase().includes('installing')) {
        const line = text.split(/\r?\n/).filter((l: string) => l.trim().length > 0).pop();
        if (line) onProgress?.(line.slice(0, 100));
      }
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        detail: `Failed to execute winget: ${err.message}`,
        manager: 'winget'
      });
    });

    child.on('close', (code) => {
      const output = `${stdout}\n${stderr}`;

      // Check for common winget outcome codes
      // 0: Success
      // 0x8A15002B / -1978335189: Already installed
      if (code === 0 || output.toLowerCase().includes('successfully installed')) {
        resolve({
          success: true,
          detail: `Successfully installed "${targetDisplayName}", My Liege.`,
          manager: 'winget',
          installedId: targetId
        });
        return;
      }

      if (output.toLowerCase().includes('already installed') || code === -1978335189 || code === 2316632075) {
        resolve({
          success: true,
          detail: `"${targetDisplayName}" is already installed on your system, My Liege.`,
          manager: 'winget',
          installedId: targetId
        });
        return;
      }

      if (output.toLowerCase().includes('no package found') || output.toLowerCase().includes('no applicable update found')) {
        resolve({
          success: false,
          detail: `My Liege, I could not find a winget package matching "${cleanName}". Check the exact name or ID.`,
          manager: 'winget'
        });
        return;
      }

      const errorSnippet = (stderr || stdout).trim().slice(-300);
      resolve({
        success: false,
        detail: `Installation of "${targetDisplayName}" exited with code ${code}.${errorSnippet ? ` Detail: ${errorSnippet}` : ''}`,
        manager: 'winget',
        installedId: targetId
      });
    });
  });
}

function runGenericInstaller(
  cmd: string,
  args: string[],
  packageName: string,
  managerName: string
): Promise<InstallResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('error', (err) => {
      resolve({
        success: false,
        detail: `Failed to run ${managerName}: ${err.message}`,
        manager: managerName
      });
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          detail: `Successfully installed "${packageName}" via ${managerName}, My Liege.`,
          manager: managerName
        });
      } else {
        const snippet = (stderr || stdout).trim().slice(-200);
        resolve({
          success: false,
          detail: `Failed to install "${packageName}" via ${managerName} (code ${code}). ${snippet}`,
          manager: managerName
        });
      }
    });
  });
}

/**
 * Lists installed applications from the Windows Start Menu and App Registry.
 */
export async function listInstalledApplications(): Promise<{ success: boolean; apps: InstalledAppInfo[]; detail: string }> {
  if (process.platform !== 'win32') {
    return { success: false, apps: [], detail: 'Listing installed apps is only supported on Windows.' };
  }

  return new Promise((resolve) => {
    // Query Get-StartApps
    const psScript = 'Get-StartApps | Select-Object Name, AppID | ConvertTo-Json -Compress';
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdout = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ success: false, apps: [], detail: 'Timed out scanning installed applications.' });
    }, 10000);

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, apps: [], detail: `Failed to scan apps: ${err.message}` });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || !stdout.trim()) {
        resolve({ success: false, apps: [], detail: 'Could not query installed applications from Windows.' });
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const list: Array<{ Name?: string; AppID?: string }> = Array.isArray(parsed) ? parsed : [parsed];
        const unique = new Map<string, InstalledAppInfo>();

        for (const item of list) {
          const name = (item.Name || '').trim();
          const appId = (item.AppID || '').trim();
          if (name && appId && !unique.has(name.toLowerCase())) {
            unique.set(name.toLowerCase(), { name, appId });
          }
        }

        const apps = Array.from(unique.values()).sort((a, b) => a.name.localeCompare(b.name));
        resolve({
          success: true,
          apps,
          detail: `Found ${apps.length} installed applications on your system, My Liege.`
        });
      } catch (err: any) {
        resolve({ success: false, apps: [], detail: `Failed to parse app list: ${err.message}` });
      }
    });
  });
}
