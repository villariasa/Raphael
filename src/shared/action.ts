import { z } from 'zod';

/**
 * The Safe Action Model (§18). This is the ONLY shape of thing the executor
 * will ever run. The LLM/planner may propose actions; nothing is executed
 * until it round-trips through this schema and the permission system.
 *
 * MVP implements exactly one action kind: create_folder. Additional kinds
 * are declared here so the schema/risk map stays the single source of
 * truth as Phase 2/3 land, but unimplemented kinds are rejected by the
 * executor with "not implemented" rather than silently no-op'ing.
 */
export const ActionKind = z.enum([
  'read_system_info',
  'list_installed_applications',
  'create_folder',
  'create_file',
  'read_file',
  'modify_file',
  'open_application',
  'close_application',
  'open_url',
  'search_browser',
  'move_window',
  'read_screen',
  'click_element',
  'type_text',
  'scroll',
  'download_file',
  'install_application',
  'execute_command',
  'modify_path',
  'modify_registry',
  'delete_file'
]);
export type ActionKind = z.infer<typeof ActionKind>;

export const RiskLevel = z.enum(['low', 'medium', 'high']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const ACTION_RISK: Record<ActionKind, RiskLevel> = {
  read_system_info: 'low',
  list_installed_applications: 'low',
  create_folder: 'medium',
  create_file: 'medium',
  read_file: 'low',
  modify_file: 'medium',
  open_application: 'medium',
  close_application: 'medium',
  open_url: 'medium',
  search_browser: 'medium',
  move_window: 'medium',
  read_screen: 'low',
  click_element: 'medium',
  type_text: 'medium',
  scroll: 'low',
  download_file: 'medium',
  install_application: 'high',
  execute_command: 'high',
  modify_path: 'high',
  modify_registry: 'high',
  delete_file: 'high'
};

/** Action kinds the executor actually implements in this phase of development. */
export const IMPLEMENTED_ACTION_KINDS: ActionKind[] = [
  'read_system_info',
  'create_folder',
  'open_application',
  'close_application',
  'open_url',
  'search_browser',
  'move_window',
  'read_screen',
  'click_element',
  'type_text',
  'scroll',
  'create_file',
  // execute_command stays implemented for the explicit, literally-typed
  // "run: <command>" path (planner.ts RUN_COMMAND_PATTERNS) — HIGH risk,
  // permission-gated. It is deliberately NOT offered to the LLM's
  // free-form planning fallback (§20: the AI must never invent and run
  // its own shell commands) — see Planner.aiPlan().
  'execute_command'
];

export const SafeAction = z.object({
  action: ActionKind,
  description: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  requiresAdmin: z.boolean().default(false),
  permissions: z.array(z.string()).default([])
});
export type SafeAction = z.infer<typeof SafeAction>;

export const Plan = z.object({
  id: z.string(),
  summary: z.string(),
  steps: z.array(SafeAction)
});
export type Plan = z.infer<typeof Plan>;

export function riskOf(kind: ActionKind): RiskLevel {
  return ACTION_RISK[kind];
}
