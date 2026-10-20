import { randomUUID } from 'crypto';
import { JsonStore } from './jsonStore';
import type { ActivityEntry } from '../../shared/ipc';

/**
 * Append-only local activity log (§15). Inspectable and clearable by the
 * user; never transmitted anywhere.
 */
export class ActivityStore {
  private readonly store: JsonStore<ActivityEntry[]>;

  constructor(dataDir: string) {
    this.store = new JsonStore<ActivityEntry[]>(dataDir, 'activity.json', []);
  }

  append(message: string, level: ActivityEntry['level'] = 'info'): ActivityEntry {
    const entries = this.store.read();
    const entry: ActivityEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      message,
      level
    };
    entries.push(entry);
    this.store.write(entries);
    return entry;
  }

  getAll(): ActivityEntry[] {
    return this.store.read();
  }

  clear(): void {
    this.store.write([]);
  }
}
