import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';
import type { RaphaelApi, PermissionRequest, TaskStatusUpdate, ActivityEntry, PermissionDecision } from '../shared/ipc';

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
  }
};

contextBridge.exposeInMainWorld('raphael', api);
