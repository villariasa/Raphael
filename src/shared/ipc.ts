import type { Plan, SafeAction, RiskLevel } from './action';

export interface EnvironmentProfile {
  os: string;
  platform: NodeJS.Platform;
  isWindows: boolean;
  architecture: string;
  shell: string;
  packageManagers: string[];
  detectedAt: string;
  supported: boolean;
  notes: string[];
}

export interface ActivityEntry {
  id: string;
  timestamp: string;
  message: string;
  level: 'info' | 'success' | 'warn' | 'error';
}

export interface PermissionRequest {
  requestId: string;
  action: SafeAction;
  risk: RiskLevel;
  explanation: string;
}

export type PermissionDecision = 'allow_once' | 'always_allow' | 'always_allow_all' | 'deny';

export interface TaskStatusUpdate {
  taskId: string;
  status: string;
  stepIndex?: number;
  totalSteps?: number;
  done: boolean;
  error?: string;
}

export interface AiSetupProgress {
  stage: 'idle' | 'starting' | 'installing_ollama' | 'downloading_model' | 'ready' | 'error';
  message: string;
  percent?: number;
  model?: string;
  error?: string;
}

export interface AiStatus {
  provider: 'ollama';
  reachable: boolean;
  baseUrl: string;
  models: string[];
  setupProgress?: AiSetupProgress;
  error?: string;
}

/** Raphael's visual/behavioral state, driven by real signals only (§7). */
export type RaphaelState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'researching'
  | 'waiting_for_permission'
  | 'executing'
  | 'speaking'
  | 'completed'
  | 'error';

export type SpeakResult =
  | { ok: true; audioBase64: string; mime: string }
  | { ok: false; reason: string };

/**
 * Voice persona for TTS. Each maps to a real OS voice request (Windows
 * SAPI culture/gender hint, macOS `say -v`, or espeak-ng `-v`) — not a
 * cosmetic label. Non-English voices depend on what's actually installed
 * on the user's machine (e.g. Windows only ships a Japanese voice if the
 * Japanese language pack is installed); when unavailable the OS silently
 * falls back to its default voice rather than failing.
 */
export type VoiceOption = 'en-US-female' | 'ja-JP-female';

/** Lifetime usage statistics Raphael keeps locally (§22: never transmitted). */
export interface ConversationStats {
  firstSeen: string;
  lastSeen: string;
  totalTurns: number;
  totalActionsPlanned: number;
  actionsByKind: Record<string, number>;
  successes: number;
  failures: number;
  daysActive: string[];
  turnsByDay: Record<string, number>;
}

/**
 * Speech-to-text (listening) status. Local-first via a SenseVoice sidecar;
 * voice input is an OPTIONAL second input — typing is always primary and
 * always works, regardless of STT state (§ voice-input architecture).
 */
export interface SttSetupProgress {
  stage: 'idle' | 'checking' | 'installing_runtime' | 'downloading_model' | 'loading_model' | 'ready' | 'error';
  message: string;
  percent?: number;
  error?: string;
}

export interface SttStatus {
  available: boolean;       // runtime + model ready to transcribe
  runtime: 'python' | 'none';
  micEnabled: boolean;      // user's persisted MICROPHONE permission toggle
  setupProgress: SttSetupProgress;
  error?: string;
}

export type TranscribeResult =
  | { ok: true; text: string; language?: string }
  | { ok: false; reason: string };

export const VOICE_OPTIONS: Array<{ id: VoiceOption; label: string }> = [
  { id: 'en-US-female', label: 'English (US) — Female' },
  { id: 'ja-JP-female', label: '日本語 (Japanese) — Female' }
];

/** The ONLY surface the renderer can call into main through. */
export interface RaphaelApi {
  getEnvironmentProfile(): Promise<EnvironmentProfile>;
  getAiStatus(): Promise<AiStatus>;
  triggerAiSetup(): Promise<void>;
  submitCommand(text: string): Promise<{ taskId: string; plan: Plan }>;
  respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  getActivity(): Promise<ActivityEntry[]>;
  clearActivity(): Promise<void>;
  speak(text: string): Promise<SpeakResult>;
  openFloatingVisualizer(): Promise<void>;
  closeFloatingVisualizer(): Promise<void>;
  getAlwaysAllowAll(): Promise<boolean>;
  setAlwaysAllowAll(enabled: boolean): Promise<void>;
  getVoice(): Promise<VoiceOption>;
  setVoice(voice: VoiceOption): Promise<void>;
  toggleFullscreen(): Promise<void>;
  getStats(): Promise<ConversationStats>;
  getSttStatus(): Promise<SttStatus>;
  setupStt(): Promise<void>;
  setMicEnabled(enabled: boolean): Promise<void>;
  transcribe(wavBase64: string): Promise<TranscribeResult>;

  onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
  onTaskStatus(cb: (update: TaskStatusUpdate) => void): () => void;
  onActivity(cb: (entry: ActivityEntry) => void): () => void;
  onAiSetupProgress(cb: (progress: AiSetupProgress) => void): () => void;
  onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void;
  onSttSetupProgress(cb: (progress: SttSetupProgress) => void): () => void;
}

export const IPC = {
  getEnvironmentProfile: 'raphael:getEnvironmentProfile',
  getAiStatus: 'raphael:getAiStatus',
  triggerAiSetup: 'raphael:triggerAiSetup',
  submitCommand: 'raphael:submitCommand',
  respondToPermission: 'raphael:respondToPermission',
  stopTask: 'raphael:stopTask',
  pauseTask: 'raphael:pauseTask',
  resumeTask: 'raphael:resumeTask',
  getActivity: 'raphael:getActivity',
  clearActivity: 'raphael:clearActivity',
  speak: 'raphael:speak',
  openFloatingVisualizer: 'raphael:openFloatingVisualizer',
  closeFloatingVisualizer: 'raphael:closeFloatingVisualizer',
  getAlwaysAllowAll: 'raphael:getAlwaysAllowAll',
  setAlwaysAllowAll: 'raphael:setAlwaysAllowAll',
  getVoice: 'raphael:getVoice',
  setVoice: 'raphael:setVoice',
  toggleFullscreen: 'raphael:toggleFullscreen',
  getStats: 'raphael:getStats',
  getSttStatus: 'raphael:getSttStatus',
  setupStt: 'raphael:setupStt',
  setMicEnabled: 'raphael:setMicEnabled',
  transcribe: 'raphael:transcribe',
  permissionRequestEvent: 'raphael:permissionRequestEvent',
  taskStatusEvent: 'raphael:taskStatusEvent',
  activityEvent: 'raphael:activityEvent',
  aiSetupEvent: 'raphael:aiSetupEvent',
  fullscreenEvent: 'raphael:fullscreenEvent',
  sttSetupEvent: 'raphael:sttSetupEvent'
} as const;
