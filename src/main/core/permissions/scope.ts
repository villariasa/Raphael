import type { SafeAction } from '../../../shared/action';

/**
 * Computes the scope key an "Always Allow" grant is stored under.
 * Per §10, grants must be scoped to a specific capability/action category
 * (and, where relevant, target) — never a blanket "allow everything".
 */
export function scopeKeyFor(action: SafeAction): string {
  switch (action.action) {
    case 'install_application':
    case 'open_application':
      return `${action.action}:${String(action.params.application ?? action.params.name ?? '*')}`;
    case 'create_folder':
    case 'create_file':
    case 'read_file':
    case 'modify_file':
    case 'delete_file':
      return `${action.action}`;
    default:
      return action.action;
  }
}
