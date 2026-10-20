import fs from 'fs';
import path from 'path';
import os from 'os';

export function resolveDesktopPath(...segments: string[]): string {
  const desktop = path.join(os.homedir(), 'Desktop');
  return path.join(desktop, ...segments);
}

export function createFile(nameOrPath: string, content = ''): { targetPath: string; alreadyExisted: boolean } {
  const targetPath = path.isAbsolute(nameOrPath) ? nameOrPath : resolveDesktopPath(nameOrPath);
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const alreadyExisted = fs.existsSync(targetPath);
  fs.writeFileSync(targetPath, content, 'utf8');
  return { targetPath, alreadyExisted };
}

export function verifyFileExists(targetPath: string): boolean {
  try {
    const stat = fs.statSync(targetPath);
    return stat.isFile();
  } catch {
    return false;
  }
}
