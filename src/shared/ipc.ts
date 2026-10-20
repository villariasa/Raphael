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

  onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
  onTaskStatus(cb: (update: TaskStatusUpdate) => void): () => void;
  onActivity(cb: (entry: ActivityEntry) => void): () => void;
  onAiSetupProgress(cb: (progress: AiSetupProgress) => void): () => void;
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
  permissionRequestEvent: 'raphael:permissionRequestEvent',
  taskStatusEvent: 'raphael:taskStatusEvent',
  activityEvent: 'raphael:activityEvent',
  aiSetupEvent: 'raphael:aiSetupEvent'
} as const;
