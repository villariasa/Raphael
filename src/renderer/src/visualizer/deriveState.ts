import { RaphaelState } from './types';

export interface DeriveStateInput {
  aiError: boolean;
  taskError: boolean;
  permissionPending: boolean;
  running: boolean;
  paused: boolean;
  hasSteps: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  debugOverride: RaphaelState | null;
}

/**
 * Pure mapping from real app signals to a visual state (§7). No signal here
 * is synthetic — each input traces back to an actual IPC event, the mic
 * capture session, or the audio element. LISTENING is now real (driven by the
 * voice-input mic session); RESEARCHING is still only reachable via the debug
 * override until a research subsystem exists.
 */
export function deriveRaphaelState(input: DeriveStateInput): RaphaelState {
  if (input.debugOverride) return input.debugOverride;
  if (input.taskError || input.aiError) return 'error';
  if (input.isSpeaking) return 'speaking';
  if (input.permissionPending) return 'waiting_for_permission';
  if (input.running && !input.paused) return input.hasSteps ? 'executing' : 'thinking';
  if (input.isListening) return 'listening';
  return 'idle';
}
