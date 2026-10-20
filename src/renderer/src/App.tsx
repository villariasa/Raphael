import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, EnvironmentProfile, AiStatus, PermissionRequest, TaskStatusUpdate, PermissionDecision } from '../../shared/ipc';
import { StatusPill } from './components/StatusPill';
import { CurrentTaskPanel } from './panels/CurrentTaskPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { PermissionDialog } from './panels/PermissionDialog';

export default function App() {
  const [env, setEnv] = useState<EnvironmentProfile | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [commandText, setCommandText] = useState('');
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [stepInfo, setStepInfo] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);

  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.raphael.getEnvironmentProfile().then(setEnv);
    window.raphael.getAiStatus().then(setAiStatus);
    window.raphael.getActivity().then(setActivity);

    const offPermission = window.raphael.onPermissionRequest(setPermissionRequest);
    const offActivity = window.raphael.onActivity((entry) => setActivity((prev) => [...prev, entry]));
    const offStatus = window.raphael.onTaskStatus((update: TaskStatusUpdate) => {
      setStatus(update.status);
      if (update.totalSteps) setStepInfo(`Step ${(update.stepIndex ?? 0) + 1} of ${update.totalSteps}`);
      if (update.done) {
        setRunning(false);
        setPaused(false);
      }
    });

    return () => {
      offPermission();
      offActivity();
      offStatus();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = commandText.trim();
    if (!text) return;
    setCommandText('');
    setStepInfo(null);
    setStatus('Thinking...');
    setRunning(true);
    setPaused(false);
    const { taskId: id, plan } = await window.raphael.submitCommand(text);
    setTaskId(id);
    setSummary(plan.summary);
    if (plan.steps.length === 0) setRunning(false);
  }

  async function decide(decision: PermissionDecision) {
    if (!permissionRequest) return;
    await window.raphael.respondToPermission(permissionRequest.requestId, decision);
    setPermissionRequest(null);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-raphael-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tracking-wide text-raphael-text">RAPHAEL</span>
          <span className="text-xs text-raphael-textMuted">v0.1 · Phase 1 MVP</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusPill label="Environment" ok={!!env?.supported} detail={env ? env.os : 'detecting...'} />
          <StatusPill
            label="Ollama"
            ok={!!aiStatus?.reachable}
            detail={aiStatus ? (aiStatus.reachable ? aiStatus.models[0] ?? 'connected' : 'offline') : '...'}
          />
        </div>
      </header>

      <main className="flex flex-1 gap-4 overflow-hidden p-4">
        <div className="flex w-[380px] flex-col gap-4">
          <CurrentTaskPanel
            summary={summary}
            status={status}
            stepInfo={stepInfo}
            running={running}
            paused={paused}
            onPause={async () => {
              if (!taskId) return;
              await window.raphael.pauseTask(taskId);
              setPaused(true);
            }}
            onResume={async () => {
              if (!taskId) return;
              await window.raphael.resumeTask(taskId);
              setPaused(false);
            }}
            onStop={async () => {
              if (!taskId) return;
              await window.raphael.stopTask(taskId);
            }}
          />
          <div className="flex-1 overflow-hidden">
            <ActivityPanel entries={activity} onClear={async () => { await window.raphael.clearActivity(); setActivity([]); }} />
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-end gap-3">
          <div ref={logEndRef} className="flex-1 rounded-lg border border-raphael-border bg-raphael-surface p-4">
            <p className="text-sm text-raphael-textMuted">
              Try: <span className="text-raphael-text">"Create a folder called Projects"</span> or{' '}
              <span className="text-raphael-text">"What's my system?"</span>
            </p>
            <p className="mt-2 text-xs text-raphael-textMuted">
              Only these actions are implemented right now. Everything else will say so instead of pretending to run.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              value={commandText}
              onChange={(e) => setCommandText(e.target.value)}
              placeholder="Tell Raphael what you want to do..."
              className="flex-1 rounded-md border border-raphael-border bg-raphael-surfaceAlt px-4 py-3 text-sm text-raphael-text placeholder:text-raphael-textMuted focus:outline-none focus:ring-1 focus:ring-raphael-accent"
            />
            <button
              type="submit"
              className="rounded-md bg-raphael-accent px-5 py-3 text-sm font-medium text-white hover:bg-raphael-accent/90"
            >
              Send
            </button>
          </form>
        </div>
      </main>

      {permissionRequest && <PermissionDialog request={permissionRequest} onDecision={decide} />}
    </div>
  );
}
