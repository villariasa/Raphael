import fs from 'fs';
import path from 'path';
import os from 'os';

export interface CreateFolderResult {
  targetPath: string;
  created: boolean;
  alreadyExisted: boolean;
}

/** Creates a folder on the user's Desktop. Real filesystem I/O — no simulation. */
export function createFolder(name: string): CreateFolderResult {
  const safeName = sanitizeName(name);
  const targetPath = path.join(os.homedir(), 'Desktop', safeName);

  const alreadyExisted = fs.existsSync(targetPath);
  if (!alreadyExisted) {
    fs.mkdirSync(targetPath, { recursive: true });
  }
  return { targetPath, created: !alreadyExisted, alreadyExisted };
}

/** Verifies the folder genuinely exists on disk — never assume success (§17). */
export function verifyFolderExists(targetPath: string): boolean {
  try {
    return fs.statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
}

function sanitizeName(name: string): string {
  const trimmed = name.trim();
  const withoutTraversal = trimmed.replace(/\.\./g, '').replace(/[\\/]/g, '-');
  if (!withoutTraversal) throw new Error('Folder name cannot be empty.');
  return withoutTraversal;
}
