import { JsonStore } from '../../storage/jsonStore';

export interface PermissionGrant {
  scopeKey: string;
  grantedAt: string;
}

interface PermissionData {
  alwaysAllow: PermissionGrant[];
  alwaysAllowAll?: boolean;
}

/**
 * Persists scoped "Always Allow" grants and global permission bypass.
 */
export class PermissionStore {
  private readonly store: JsonStore<PermissionData>;

  constructor(dataDir: string) {
    this.store = new JsonStore<PermissionData>(dataDir, 'permissions.json', { alwaysAllow: [], alwaysAllowAll: false });
  }

  isAlwaysAllowAll(): boolean {
    return !!this.store.read().alwaysAllowAll;
  }

  setAlwaysAllowAll(enabled: boolean): void {
    const data = this.store.read();
    data.alwaysAllowAll = enabled;
    this.store.write(data);
  }

  isAlwaysAllowed(scopeKey: string): boolean {
    const data = this.store.read();
    if (data.alwaysAllowAll) return true;
    return data.alwaysAllow.some((g) => g.scopeKey === scopeKey);
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
