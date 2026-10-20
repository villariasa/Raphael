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

export type PermissionDecision = 'allow_once' | 'always_allow' | 'deny';

export interface TaskStatusUpdate {
  taskId: string;
  status: string;
  stepIndex?: number;
  totalSteps?: number;
  done: boolean;
  error?: string;
}

export interface AiStatus {
  provider: 'ollama';
  reachable: boolean;
  baseUrl: string;
  models: string[];
  error?: string;
}

/** The ONLY surface the renderer can call into main through. */
export interface RaphaelApi {
  getEnvironmentProfile(): Promise<EnvironmentProfile>;
  getAiStatus(): Promise<AiStatus>;
  submitCommand(text: string): Promise<{ taskId: string; plan: Plan }>;
  respondToPermission(requestId: string, decision: PermissionDecision): Promise<void>;
  stopTask(taskId: string): Promise<void>;
  pauseTask(taskId: string): Promise<void>;
  resumeTask(taskId: string): Promise<void>;
  getActivity(): Promise<ActivityEntry[]>;
  clearActivity(): Promise<void>;

  onPermissionRequest(cb: (req: PermissionRequest) => void): () => void;
  onTaskStatus(cb: (update: TaskStatusUpdate) => void): () => void;
  onActivity(cb: (entry: ActivityEntry) => void): () => void;
}

export const IPC = {
  getEnvironmentProfile: 'raphael:getEnvironmentProfile',
  getAiStatus: 'raphael:getAiStatus',
  submitCommand: 'raphael:submitCommand',
  respondToPermission: 'raphael:respondToPermission',
  stopTask: 'raphael:stopTask',
  pauseTask: 'raphael:pauseTask',
  resumeTask: 'raphael:resumeTask',
  getActivity: 'raphael:getActivity',
  clearActivity: 'raphael:clearActivity',
  permissionRequestEvent: 'raphael:permissionRequestEvent',
  taskStatusEvent: 'raphael:taskStatusEvent',
  activityEvent: 'raphael:activityEvent'
} as const;
