import { spawn } from 'child_process';

export interface LaunchResult {
  success: boolean;
  detail: string;
  processName?: string;
}

/** Common close targets by friendly name → Windows process name (no .exe). App launching itself lives in openApp.ts. */
const CLOSE_ALIASES: Record<string, string> = {
  chrome: 'chrome',
  'google chrome': 'chrome',
  edge: 'msedge',
  'microsoft edge': 'msedge',
  firefox: 'firefox',
  'vs code': 'Code',
  vscode: 'Code',
  'visual studio code': 'Code',
  notepad: 'notepad',
  discord: 'Discord',
  spotify: 'Spotify',
  explorer: 'explorer'
};

const BROWSER_PROCESS_NAMES = ['chrome', 'msedge', 'firefox', 'iexplore', 'brave', 'opera'];

/** Rejects characters that have no business in an app name/URL, before it's embedded in a PowerShell literal. */
function sanitizeForPowerShellLiteral(input: string): string {
  const clean = input.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return clean.replace(/'/g, "''");
}

function runPowerShell(script: string, timeoutMs = 12000): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('PowerShell command timed out.'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: stdout.trim(), code: code ?? (stderr ? 1 : 0) });
    });
  });
}

/** Closes a running application by process name and verifies it's actually gone. */
export async function closeApplication(name: string): Promise<LaunchResult> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Application control is only implemented for Windows.' };
  }
  const key = name.trim().toLowerCase();
  const resolvedProcessName = CLOSE_ALIASES[key] ?? key.replace(/\s+/g, '');
  // The name can originate from free-form / LLM text. `Get-Process -Name`
  // and `Stop-Process -Name` interpret PowerShell wildcards (* ? [ ]), so a
  // name like "*" would match — and kill — every process. Reject anything
  // that isn't a plain process-name character BEFORE it reaches the script.
  if (!/^[A-Za-z0-9._-]+$/.test(resolvedProcessName)) {
    return { success: false, detail: `My Liege, "${name}" isn't a valid app name to close.` };
  }
  const processName = sanitizeForPowerShellLiteral(resolvedProcessName);

  const script = `
    $ErrorActionPreference = 'SilentlyContinue';
    if (-not (Get-Process -Name '${processName}' -ErrorAction SilentlyContinue)) { Write-Output 'NOT_RUNNING'; exit 0 }
    Stop-Process -Name '${processName}' -Force;
    Start-Sleep -Milliseconds 500;
    if (Get-Process -Name '${processName}' -ErrorAction SilentlyContinue) { Write-Output 'STILL_RUNNING'; exit 1 }
    Write-Output 'CLOSED';
    exit 0;
  `;

  let result: { stdout: string; code: number };
  try {
    result = await runPowerShell(script);
  } catch (err: any) {
    return { success: false, detail: `Couldn't run the close command: ${err?.message ?? err}` };
  }

  if (result.stdout.includes('NOT_RUNNING')) {
    return { success: true, detail: `"${name}" wasn't even running, My Liege.` };
  }
  if (result.stdout.includes('CLOSED')) {
    return { success: true, detail: `"${name}" is closed, My Liege.` };
  }
  return { success: false, detail: `My Liege, "${name}" is still running — it wouldn't close.` };
}

/**
 * Opens a URL in the user's default browser and verifies some browser
 * process is actually running afterward. This cannot prove the specific
 * tab/navigation happened (that needs DOM/UI automation, not implemented
 * yet) — it proves the OS actually handed the URL to a real browser
 * process, which is a real, non-fake verification step.
 */
export async function openUrlInBrowser(url: string): Promise<LaunchResult> {
  if (process.platform !== 'win32') {
    return { success: false, detail: 'Browser launch is only implemented for Windows.' };
  }
  const safeUrl = sanitizeForPowerShellLiteral(url);
  if (!/^https?:\/\//i.test(safeUrl)) {
    return { success: false, detail: 'Refusing to open a non-http(s) URL.' };
  }

  const browserList = BROWSER_PROCESS_NAMES.map((b) => `'${b}'`).join(',');
  const script = `
    $ErrorActionPreference = 'Stop';
    try { Start-Process '${safeUrl}' } catch { Write-Output "LAUNCH_FAILED:$($_.Exception.Message)"; exit 1 }
    $browsers = @(${browserList});
    $deadline = (Get-Date).AddSeconds(6);
    while ((Get-Date) -lt $deadline) {
      foreach ($b in $browsers) {
        if (Get-Process -Name $b -ErrorAction SilentlyContinue) { Write-Output "VERIFIED:$b"; exit 0 }
      }
      Start-Sleep -Milliseconds 300;
    }
    Write-Output 'LAUNCHED_UNVERIFIED';
    exit 0;
  `;

  let result: { stdout: string; code: number };
  try {
    result = await runPowerShell(script);
  } catch (err: any) {
    return { success: false, detail: `Couldn't run the browser-launch command: ${err?.message ?? err}` };
  }

  if (result.stdout.startsWith('LAUNCH_FAILED')) {
    return { success: false, detail: `My Liege, the browser wouldn't open: ${result.stdout.split(':').slice(1).join(':')}` };
  }
  if (result.stdout.startsWith('VERIFIED')) {
    const browser = result.stdout.split(':')[1];
    return { success: true, detail: `Browser's open, My Liege.`, processName: browser };
  }
  return {
    success: false,
    detail: "My Liege, I ran the browser-launch command but couldn't confirm a browser process started within 6 seconds."
  };
}

export function buildSearchUrl(query: string, engine: 'google' | 'bing' | 'duckduckgo' = 'google'): string {
  const q = encodeURIComponent(query.trim());
  switch (engine) {
    case 'bing':
      return `https://www.bing.com/search?q=${q}`;
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${q}`;
    default:
      return `https://www.google.com/search?q=${q}`;
  }
}
