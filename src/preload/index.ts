import { contextBridge, ipcRenderer } from 'electron';
import type { RaphaelApi, PermissionRequest, TaskStatusUpdate, ActivityEntry, PermissionDecision, VoiceOption, SttSetupProgress, IPC as IpcType } from '../shared/ipc';

const IPC: typeof IpcType = {
  getEnvironmentProfile: 'raphael:getEnvironmentProfile',
  getAiStatus: 'raphael:getAiStatus',
  submitCommand: 'raphael:submitCommand',
  respondToPermission: 'raphael:respondToPermission',
  stopTask: 'raphael:stopTask',
  pauseTask: 'raphael:pauseTask',
  resumeTask: 'raphael:resumeTask',
  getActivity: 'raphael:getActivity',
  clearActivity: 'raphael:clearActivity',
  triggerAiSetup: 'raphael:triggerAiSetup',
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
  getUiSettings: 'raphael:getUiSettings',
  setUiSettings: 'raphael:setUiSettings',
  permissionRequestEvent: 'raphael:permissionRequestEvent',
  taskStatusEvent: 'raphael:taskStatusEvent',
  activityEvent: 'raphael:activityEvent',
  aiSetupEvent: 'raphael:aiSetupEvent',
  fullscreenEvent: 'raphael:fullscreenEvent',
  sttSetupEvent: 'raphael:sttSetupEvent'
};

/**
 * The entire renderer↔main surface. Deliberately narrow: no raw ipcRenderer,
 * no Node access, no path to arbitrary exec from the UI/LLM side (§3, §18).
 */
const api: RaphaelApi = {
  getEnvironmentProfile: () => ipcRenderer.invoke(IPC.getEnvironmentProfile),
  getAiStatus: () => ipcRenderer.invoke(IPC.getAiStatus),
  submitCommand: (text: string) => ipcRenderer.invoke(IPC.submitCommand, text),
  respondToPermission: (requestId: string, decision: PermissionDecision) =>
    ipcRenderer.invoke(IPC.respondToPermission, requestId, decision),
  stopTask: (taskId: string) => ipcRenderer.invoke(IPC.stopTask, taskId),
  pauseTask: (taskId: string) => ipcRenderer.invoke(IPC.pauseTask, taskId),
  resumeTask: (taskId: string) => ipcRenderer.invoke(IPC.resumeTask, taskId),
  getActivity: () => ipcRenderer.invoke(IPC.getActivity),
  clearActivity: () => ipcRenderer.invoke(IPC.clearActivity),
  triggerAiSetup: () => ipcRenderer.invoke(IPC.triggerAiSetup),
  speak: (text: string) => ipcRenderer.invoke(IPC.speak, text),
  openFloatingVisualizer: () => ipcRenderer.invoke(IPC.openFloatingVisualizer),
  closeFloatingVisualizer: () => ipcRenderer.invoke(IPC.closeFloatingVisualizer),
  getAlwaysAllowAll: () => ipcRenderer.invoke(IPC.getAlwaysAllowAll),
  setAlwaysAllowAll: (enabled: boolean) => ipcRenderer.invoke(IPC.setAlwaysAllowAll, enabled),
  getVoice: () => ipcRenderer.invoke(IPC.getVoice),
  setVoice: (voice: VoiceOption) => ipcRenderer.invoke(IPC.setVoice, voice),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.toggleFullscreen),
  getStats: () => ipcRenderer.invoke(IPC.getStats),
  getSttStatus: () => ipcRenderer.invoke(IPC.getSttStatus),
  setupStt: () => ipcRenderer.invoke(IPC.setupStt),
  setMicEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.setMicEnabled, enabled),
  transcribe: (wavBase64: string) => ipcRenderer.invoke(IPC.transcribe, wavBase64),
  getUiSettings: () => ipcRenderer.invoke(IPC.getUiSettings),
  setUiSettings: (patch) => ipcRenderer.invoke(IPC.setUiSettings, patch),

  onPermissionRequest: (cb: (req: PermissionRequest) => void) => {
    const listener = (_: unknown, req: PermissionRequest) => cb(req);
    ipcRenderer.on(IPC.permissionRequestEvent, listener);
    return () => ipcRenderer.removeListener(IPC.permissionRequestEvent, listener);
  },
  onTaskStatus: (cb: (update: TaskStatusUpdate) => void) => {
    const listener = (_: unknown, update: TaskStatusUpdate) => cb(update);
    ipcRenderer.on(IPC.taskStatusEvent, listener);
    return () => ipcRenderer.removeListener(IPC.taskStatusEvent, listener);
  },
  onActivity: (cb: (entry: ActivityEntry) => void) => {
    const listener = (_: unknown, entry: ActivityEntry) => cb(entry);
    ipcRenderer.on(IPC.activityEvent, listener);
    return () => ipcRenderer.removeListener(IPC.activityEvent, listener);
  },
  onAiSetupProgress: (cb: (progress: any) => void) => {
    const listener = (_: unknown, progress: any) => cb(progress);
    ipcRenderer.on(IPC.aiSetupEvent, listener);
    return () => ipcRenderer.removeListener(IPC.aiSetupEvent, listener);
  },
  onFullscreenChange: (cb: (isFullscreen: boolean) => void) => {
    const listener = (_: unknown, isFullscreen: boolean) => cb(isFullscreen);
    ipcRenderer.on(IPC.fullscreenEvent, listener);
    return () => ipcRenderer.removeListener(IPC.fullscreenEvent, listener);
  },
  onSttSetupProgress: (cb: (progress: SttSetupProgress) => void) => {
    const listener = (_: unknown, progress: SttSetupProgress) => cb(progress);
    ipcRenderer.on(IPC.sttSetupEvent, listener);
    return () => ipcRenderer.removeListener(IPC.sttSetupEvent, listener);
  }
};

contextBridge.exposeInMainWorld('raphael', api);
