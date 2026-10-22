import fs from 'fs';
import path from 'path';

/**
 * Minimal, dependency-free ".env" loader (no quoting/interpolation) so free
 * LLM API keys can be dropped in a `.env` file next to the project (dev) or
 * the installed .exe (packaged), instead of requiring real OS environment
 * variables. Existing process.env values always win — a .env file never
 * overrides what's already set in the environment.
 */
export function loadDotEnv(candidateDirs: string[]): void {
  for (const dir of candidateDirs) {
    const envPath = path.join(dir, '.env');
    if (!fs.existsSync(envPath)) continue;

    const content = fs.readFileSync(envPath, 'utf-8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;

      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      if (key && !(key in process.env)) {
        process.env[key] = value;
      }
    }
    return;
  }
}
