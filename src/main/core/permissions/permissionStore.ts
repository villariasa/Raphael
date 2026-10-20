import { JsonStore } from '../../storage/jsonStore';

export interface PermissionGrant {
  scopeKey: string;
  grantedAt: string;
}

interface PermissionData {
  alwaysAllow: PermissionGrant[];
}

/**
 * Persists scoped "Always Allow" grants only. "Allow Once" and "Deny" are
 * never persisted. There is deliberately no API to grant everything —
 * every grant is keyed to a specific scope (see scope.ts).
 */
export class PermissionStore {
  private readonly store: JsonStore<PermissionData>;

  constructor(dataDir: string) {
    this.store = new JsonStore<PermissionData>(dataDir, 'permissions.json', { alwaysAllow: [] });
  }

  isAlwaysAllowed(scopeKey: string): boolean {
    return this.store.read().alwaysAllow.some((g) => g.scopeKey === scopeKey);
  }

  grantAlways(scopeKey: string): void {
    const data = this.store.read();
    if (!data.alwaysAllow.some((g) => g.scopeKey === scopeKey)) {
      data.alwaysAllow.push({ scopeKey, grantedAt: new Date().toISOString() });
      this.store.write(data);
    }
  }

  revoke(scopeKey: string): void {
    const data = this.store.read();
    data.alwaysAllow = data.alwaysAllow.filter((g) => g.scopeKey !== scopeKey);
    this.store.write(data);
  }

  list(): PermissionGrant[] {
    return this.store.read().alwaysAllow;
  }
}
