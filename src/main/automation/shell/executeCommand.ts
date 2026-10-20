import { exec } from 'child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function executeCommand(cmd: string, cwd?: string, timeoutMs = 30000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    exec(
      cmd,
      {
        cwd: cwd || process.cwd(),
        shell: 'powershell.exe',
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error && error.killed) {
          return reject(new Error(`Command timed out after ${timeoutMs / 1000}s`));
        }
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: error ? (error.code ?? 1) : 0
        });
      }
    );
  });
}
