import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import type { EnvironmentProfile } from '../../../shared/ipc';

const execFileAsync = promisify(execFile);

async function commandExists(cmd: string, versionArgs: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, versionArgs, { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects only what Raphael needs to plan actions (§4). On Windows this
 * inspects the real shell/package-manager surface. On non-Windows dev
 * machines it reports `supported: false` rather than guessing — Raphael
 * is Windows-first and must not pretend to know an environment it can't
 * act on.
 */
export async function detectEnvironment(): Promise<EnvironmentProfile> {
  const platform = process.platform;
  const isWindows = platform === 'win32';
  const notes: string[] = [];
  const packageManagers: string[] = [];

  if (isWindows) {
    if (await commandExists('winget', ['--version'])) packageManagers.push('winget');
    if (await commandExists('choco', ['--version'])) packageManagers.push('choco');
  } else {
    notes.push('Running on a non-Windows host; Windows-specific detection and automation are disabled.');
  }

  let shell = 'unknown';
  if (isWindows) {
    shell = process.env.PSModulePath ? 'PowerShell' : 'cmd.exe';
  } else if (process.env.SHELL) {
    shell = process.env.SHELL;
  }

  return {
    os: `${os.type()} ${os.release()}`,
    platform,
    isWindows,
    architecture: os.arch(),
    shell,
    packageManagers,
    detectedAt: new Date().toISOString(),
    supported: isWindows,
    notes
  };
}
