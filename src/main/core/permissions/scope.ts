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
    case 'close_application':
      return `${action.action}:${String(action.params.application ?? action.params.name ?? action.params.package ?? action.params.app ?? '*')}`;
    case 'open_url':
    case 'search_browser':
      // Coarse-grained: a per-URL/per-query grant would be meaningless
      // (every search has a different URL) — "always allow" here means
      // "always allow browser control", matching §18's BROWSER_CONTROL
      // permission category.
      return 'browser_control';
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
