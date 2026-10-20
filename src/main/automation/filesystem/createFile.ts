import fs from 'fs';
import path from 'path';
import os from 'os';

export function resolveDesktopPath(...segments: string[]): string {
  const desktop = path.join(os.homedir(), 'Desktop');
  return path.join(desktop, ...segments);
}

/**
 * Creates a file on the user's Desktop. `nameOrPath` can originate from the
 * LLM's free-form JSON action authoring (planner.ts aiPlan), so it must
 * never be trusted as a path — only a bare filename confined to the
 * Desktop is accepted. No absolute paths, no traversal, no separators.
 */
export function createFile(nameOrPath: string, content = ''): { targetPath: string; alreadyExisted: boolean } {
  const name = nameOrPath.trim();
  if (!name) throw new Error('File name cannot be empty.');
  if (path.isAbsolute(name) || name.includes('..') || /[\\/]/.test(name)) {
    throw new Error('create_file only accepts a plain filename on the Desktop — no paths, no "..".');
  }

  const desktop = fs.realpathSync(path.join(os.homedir(), 'Desktop'));
  const targetPath = path.join(desktop, name);

  // Confirm the resolved path genuinely lands inside Desktop before
  // writing — catches symlink tricks that a plain string check can't. Since
  // `name` has no separators, the parent dir is always the Desktop itself;
  // this just resolves its realpath in case Desktop is a symlink.
  const resolvedDir = fs.realpathSync(path.dirname(targetPath));
  if (resolvedDir !== desktop) {
    throw new Error('That path escapes the Desktop folder.');
  }

  const alreadyExisted = fs.existsSync(targetPath);
  fs.writeFileSync(targetPath, content, { encoding: 'utf8', mode: 0o600 });
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
