import { useEffect, useState } from 'react';
import type { PermissionRequest, TaskStatusUpdate } from '../../../shared/ipc';
import { RaphaelVisualizer } from './RaphaelVisualizer';
import { deriveRaphaelState } from './deriveState';
import { DEFAULT_TUNABLES, SILENT_AUDIO } from './types';

/**
 * The floating visualizer window (§9). Mirrors the main window's real
 * state signals via the same broadcast IPC events, but owns no audio
 * element of its own — it never plays a second copy of TTS output, so it
 * does not enter the audio-driven SPEAKING motion (falls back to EXECUTING
 * if speech happens to overlap with an active task, otherwise IDLE).
 */
export function FloatingVisualizer() {
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatusUpdate | null>(null);
  const [aiError, setAiError] = useState(false);
  const [running, setRunning] = useState(false);
  const [completedAt, setCompletedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!window.raphael) return;
    const offPermission = window.raphael.onPermissionRequest?.(setPermissionRequest);
    const offStatus = window.raphael.onTaskStatus?.((update) => {
      setTaskStatus(update);
      if (update.done) {
        setRunning(false);
        if (!update.error) setCompletedAt(performance.now());
      } else {
        setRunning(true);
      }
    });
    const offSetup = window.raphael.onAiSetupProgress?.((p: any) => setAiError(p.stage === 'error'));
    return () => {
      offPermission?.();
      offStatus?.();
      offSetup?.();
    };
  }, []);

  const state = deriveRaphaelState({
    aiError,
    taskError: !!taskStatus?.error,
    permissionPending: !!permissionRequest,
    running,
    paused: false,
    hasSteps: !!taskStatus?.totalSteps,
    isSpeaking: false,
    debugOverride: null
  });

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#05070a]" style={{ WebkitAppRegion: 'drag' } as any}>
      <RaphaelVisualizer state={state} audio={SILENT_AUDIO} tunables={DEFAULT_TUNABLES} completedAt={completedAt} />
      <button
        onClick={() => window.raphael?.closeFloatingVisualizer()}
        style={{ WebkitAppRegion: 'no-drag' } as any}
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 text-xs text-white/80 hover:bg-black/70 hover:text-white"
        title="Close floating visualizer"
      >
        ✕
      </button>
    </div>
  );
}
