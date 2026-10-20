import { randomUUID } from 'crypto';
import type { SafeAction } from '../../../shared/action';
import { riskOf } from '../../../shared/action';
import type { PermissionRequest, PermissionDecision } from '../../../shared/ipc';
import { PermissionStore } from './permissionStore';
import { scopeKeyFor } from './scope';

type AskFn = (request: PermissionRequest) => void;

/**
 * The permission gate (§10). Every action — including ones proposed by the
 * planner/LLM — passes through here before the executor ever sees it.
 * LOW risk is auto-approved. MEDIUM/HIGH require explicit approval unless
 * already covered by a scoped "Always Allow" grant.
 */
export class PermissionGate {
  private readonly pending = new Map<string, (decision: PermissionDecision) => void>();
  private askCallback: AskFn | null = null;

  constructor(private readonly store: PermissionStore) {}

  onAsk(cb: AskFn): void {
    this.askCallback = cb;
  }

  resolve(requestId: string, decision: PermissionDecision): void {
    const resolver = this.pending.get(requestId);
    if (!resolver) return;
    this.pending.delete(requestId);
    resolver(decision);
  }

  async authorize(action: SafeAction): Promise<{ approved: boolean; reason: string }> {
    if (this.store.isAlwaysAllowAll()) {
      return { approved: true, reason: 'all-permissions grant active — auto-approved' };
    }

    const risk = riskOf(action.action);

    if (risk === 'low') {
      return { approved: true, reason: 'low risk — auto-approved' };
    }

    const scopeKey = scopeKeyFor(action);
    if (this.store.isAlwaysAllowed(scopeKey)) {
      return { approved: true, reason: `always-allow grant for "${scopeKey}"` };
    }

    if (!this.askCallback) {
      return { approved: false, reason: 'no permission UI connected' };
    }

    const requestId = randomUUID();
    const decision = await new Promise<PermissionDecision>((resolve) => {
      this.pending.set(requestId, resolve);
      this.askCallback!({
        requestId,
        action,
        risk,
        explanation: describeAction(action)
      });
    });

    if (decision === 'deny') {
      return { approved: false, reason: 'user denied' };
    }
    if (decision === 'always_allow_all') {
      this.store.setAlwaysAllowAll(true);
      return { approved: true, reason: 'user granted all permissions' };
    }
    if (decision === 'always_allow') {
      this.store.grantAlways(scopeKey);
    }
    return { approved: true, reason: `user ${decision}` };
  }
}

function describeAction(action: SafeAction): string {
  const parts = [action.description];
  if (action.requiresAdmin) parts.push('This requires administrator privileges.');
  if (action.permissions.length) parts.push(`Permissions needed: ${action.permissions.join(', ')}.`);
  return parts.join(' ');
}
