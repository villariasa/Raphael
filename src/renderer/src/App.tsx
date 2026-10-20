import { useEffect, useRef, useState } from 'react';
import type { ActivityEntry, EnvironmentProfile, AiStatus, PermissionRequest, TaskStatusUpdate, PermissionDecision } from '../../shared/ipc';
import { StatusPill } from './components/StatusPill';
import { CurrentTaskPanel } from './panels/CurrentTaskPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { PermissionDialog } from './panels/PermissionDialog';

export default function App() {
  const [env, setEnv] = useState<EnvironmentProfile | null>(null);
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  const [setupProgress, setSetupProgress] = useState<any>(null);
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
    if (!window.raphael) return;
    window.raphael.getEnvironmentProfile().then(setEnv).catch(console.error);
    window.raphael.getAiStatus().then((s) => {
      setAiStatus(s);
      if (s?.setupProgress) setSetupProgress(s.setupProgress);
    }).catch(console.error);
    window.raphael.getActivity().then(setActivity).catch(console.error);

    const offPermission = window.raphael.onPermissionRequest?.(setPermissionRequest);
    const offActivity = window.raphael.onActivity?.((entry) => setActivity((prev) => [...prev, entry]));
    const offAiSetup = window.raphael.onAiSetupProgress?.((p: any) => {
      setSetupProgress(p);
      if (p.stage === 'ready' || p.stage === 'error') {
        window.raphael.getAiStatus().then(setAiStatus).catch(console.error);
      }
    });
    const offStatus = window.raphael.onTaskStatus?.((update: TaskStatusUpdate) => {
      setStatus(update.status);
      if (update.totalSteps) setStepInfo(`Step ${(update.stepIndex ?? 0) + 1} of ${update.totalSteps}`);
      if (update.done) {
        setRunning(false);
        setPaused(false);
      }
    });

    return () => {
      offPermission?.();
      offActivity?.();
      offAiSetup?.();
      offStatus?.();
    };
  }, []);

  if (typeof window !== 'undefined' && !window.raphael) {
    return (
      <div className="flex h-screen items-center justify-center bg-raphael-bg text-raphael-danger p-6 text-center">
        <div>
          <h2 className="text-xl font-bold mb-2">Bridge Connection Error</h2>
          <p className="text-sm text-raphael-textMuted">Desktop bridge was not detected. Check Electron preload logs.</p>
        </div>
      </div>
    );
  }

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
            detail={
              setupProgress && setupProgress.stage !== 'ready' && setupProgress.stage !== 'idle'
                ? setupProgress.stage === 'downloading_model'
                  ? `Downloading (${setupProgress.percent ?? 0}%)`
                  : setupProgress.stage === 'installing_ollama'
                  ? 'Installing...'
                  : setupProgress.stage === 'starting'
                  ? 'Starting...'
                  : 'Setup Notice'
                : aiStatus
                ? aiStatus.reachable
                  ? aiStatus.models[0] ?? 'connected'
                  : 'offline'
                : 'connecting...'
            }
          />
        </div>
      </header>

      {setupProgress && setupProgress.stage !== 'ready' && setupProgress.stage !== 'idle' && (
        <div className="border-b border-raphael-border bg-raphael-surfaceAlt/70 px-5 py-2.5 text-xs">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className={`inline-block h-2 w-2 rounded-full ${setupProgress.stage === 'error' ? 'bg-raphael-danger' : 'bg-raphael-accent animate-pulse'}`} />
              <span className="font-medium text-raphael-text">{setupProgress.message}</span>
            </div>
            {setupProgress.percent !== undefined && (
              <span className="font-mono text-raphael-textMuted">{setupProgress.percent}%</span>
            )}
            {setupProgress.stage === 'error' && (
              <button
                onClick={() => window.raphael.triggerAiSetup()}
                className="rounded bg-raphael-accent px-2.5 py-1 text-xs text-white hover:bg-raphael-accent/90"
              >
                Retry Setup
              </button>
            )}
          </div>
          {setupProgress.percent !== undefined ? (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-raphael-border">
              <div
                className="h-full bg-raphael-accent transition-all duration-300"
                style={{ width: `${setupProgress.percent}%` }}
              />
            </div>
          ) : (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-raphael-border">
              <div className="h-full w-1/3 animate-pulse bg-raphael-accent" />
            </div>
          )}
        </div>
      )}

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
