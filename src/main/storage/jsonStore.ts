import fs from 'fs';
import path from 'path';

/** Minimal durable JSON file store. Local-first: never leaves the machine. */
export class JsonStore<T> {
  private readonly filePath: string;

  constructor(dir: string, filename: string, private readonly defaultValue: T) {
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, filename);
  }

  read(): T {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch {
      return structuredClone(this.defaultValue);
    }
  }

  write(value: T): void {
    fs.writeFileSync(this.filePath, JSON.stringify(value, null, 2), 'utf-8');
  }
}
