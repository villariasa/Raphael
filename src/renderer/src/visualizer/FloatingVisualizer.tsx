import { useEffect, useRef, useState } from 'react';
import type { PermissionRequest, TaskStatusUpdate, PermissionDecision } from '../../../shared/ipc';
import { RaphaelVisualizerVideo as RaphaelVisualizer } from './RaphaelVisualizerVideo';
import { ResponseSystem } from './ResponseSystem';
import { useResponseOrchestrator } from '../response/useResponseOrchestrator';
import { buildSystemResponse } from '../response/buildSystemResponse';
import { deriveRaphaelState } from './deriveState';
import { DEFAULT_TUNABLES, SILENT_AUDIO } from './types';

const STATE_LABELS: Record<string, string> = {
  idle: 'Ask Raphael anything…',
  listening: 'Listening…',
  thinking: 'Thinking…',
  researching: 'Researching…',
  waiting_for_permission: 'Permission required',
  executing: 'Executing…',
  speaking: 'Speaking…',
  completed: 'Done',
  error: 'Action failed'
};

/**
 * The floating command bar (§14): a real, always-on-top, independently
 * closeable window that lets My Liege command Raphael while working in
 * another app. It submits through the same narrow IPC surface as the main
 * window and mirrors real task state via broadcast events — it never fakes
 * completion. TTS still plays from the main window (which also receives the
 * broadcast), so this window owns no audio of its own.
 */
export function FloatingVisualizer() {
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);
  const [taskStatus, setTaskStatus] = useState<TaskStatusUpdate | null>(null);
  const [aiError, setAiError] = useState(false);
  const [running, setRunning] = useState(false);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [commandText, setCommandText] = useState('');
  const [reply, setReply] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const orchestrator = useResponseOrchestrator();

  function triggerAnimatedReply(message: string, isError = false, hadAction = false) {
    if (!message || !message.trim()) return;
    const r = buildSystemResponse({
      message,
      signals: { isError, needsPermission: false, hadAction },
      width: 380,
      height: 380,
      voiceEnabled: true,
      animationMode: 'full',
      scope: 'always'
    });
    orchestrator.handle(r, 'ja-JP-female');
  }

  useEffect(() => {
    if (!window.raphael) return;
    const offPermission = window.raphael.onPermissionRequest?.(setPermissionRequest);
    const offStatus = window.raphael.onTaskStatus?.((update) => {
      setTaskStatus(update);
      setReply(update.status);
      if (update.done) {
        setRunning(false);
        setPermissionRequest(null);
        if (!update.error) {
          setCompletedAt(performance.now());
          triggerAnimatedReply(update.status || 'Done, My Liege.', false, true);
        } else {
          triggerAnimatedReply(update.status || 'Action failed, My Liege.', true, true);
        }
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
    isSpeaking: orchestrator.isSpeaking,
    isListening: false,
    debugOverride: null
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = commandText.trim();
    if (!text || !window.raphael) return;
    setCommandText('');
    setReply('Thinking…');
    setRunning(true);
    try {
      const { plan } = await window.raphael.submitCommand(text);
      setReply(plan.summary);
      triggerAnimatedReply(plan.summary, false, plan.steps.length > 0);
      if (plan.steps.length === 0) setRunning(false);
    } catch {
      const errMsg = 'My Liege, that request failed to reach me.';
      setReply(errMsg);
      triggerAnimatedReply(errMsg, true, false);
      setRunning(false);
    }
  }

  async function decide(decision: PermissionDecision) {
    if (!permissionRequest || !window.raphael) return;
    await window.raphael.respondToPermission(permissionRequest.requestId, decision);
    setPermissionRequest(null);
  }

  const statusLabel = reply ?? STATE_LABELS[state] ?? 'Ask Raphael anything…';

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-[#05070a]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Drag handle / title row */}
      <div className="flex items-center justify-between px-3 py-2 text-[11px] font-semibold tracking-wide text-white/70">
        <span>✦ RAPHAEL</span>
        <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {running && (
            <button
              onClick={() => taskStatus?.taskId && window.raphael?.stopTask(taskStatus.taskId)}
              className="rounded bg-raphael-danger/80 px-2 py-0.5 text-[10px] text-white hover:bg-raphael-danger"
              title="Stop Raphael"
            >
              Stop
            </button>
          )}
          <button
            onClick={() => window.raphael?.closeFloatingVisualizer()}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-black/40 text-xs text-white/80 hover:bg-black/70 hover:text-white"
            title="Close floating Raphael"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Visualizer & Animated Reply */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <RaphaelVisualizer state={state} audio={SILENT_AUDIO} tunables={DEFAULT_TUNABLES} completedAt={completedAt} />
        <ResponseSystem
          timeline={orchestrator.timeline}
          currentTimeSec={orchestrator.currentTimeSec}
          isPlaying={orchestrator.isSpeaking}
          active={orchestrator.isActive}
        />
      </div>

      {/* Status / reply line */}
      <div
        className="px-3 pb-1 pt-1.5 text-center text-xs text-white/80"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className={state === 'error' ? 'text-raphael-danger' : state === 'waiting_for_permission' ? 'text-raphael-warn' : ''}>
          {statusLabel}
        </span>
      </div>

      {/* Permission prompt (compact) */}
      {permissionRequest && (
        <div
          className="mx-3 mb-1 rounded-md border border-raphael-warn/40 bg-raphael-warn/10 px-2.5 py-2 text-[11px] text-white/90"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <p className="mb-1.5">{permissionRequest.explanation}</p>
          <div className="flex gap-1.5">
            <button onClick={() => decide('allow_once')} className="flex-1 rounded bg-raphael-ok/80 px-2 py-1 text-[10px] font-medium text-white hover:bg-raphael-ok">
              Allow once
            </button>
            <button onClick={() => decide('always_allow')} className="flex-1 rounded border border-white/20 bg-white/10 px-2 py-1 text-[10px] font-medium text-white hover:bg-white/20">
              Always allow
            </button>
            <button onClick={() => decide('deny')} className="flex-1 rounded bg-raphael-danger/80 px-2 py-1 text-[10px] font-medium text-white hover:bg-raphael-danger">
              Deny
            </button>
          </div>
        </div>
      )}

      {/* Command input */}
      <form
        onSubmit={handleSubmit}
        className="flex gap-1.5 p-2.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <input
          ref={inputRef}
          value={commandText}
          onChange={(e) => setCommandText(e.target.value)}
          placeholder="Type a command…"
          className="flex-1 rounded-md border border-raphael-border bg-raphael-surfaceAlt px-3 py-2 text-xs text-raphael-text placeholder:text-raphael-textMuted focus:outline-none focus:ring-1 focus:ring-raphael-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-raphael-accent px-3 py-2 text-xs font-medium text-white hover:bg-raphael-accent/90"
        >
          Send
        </button>
      </form>
    </div>
  );
}
