import { useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityEntry, EnvironmentProfile, AiStatus, PermissionRequest, TaskStatusUpdate, PermissionDecision } from '../../shared/ipc';
import type { RaphaelState } from './visualizer/types';
import { StatusPill } from './components/StatusPill';
import { CurrentTaskPanel } from './panels/CurrentTaskPanel';
import { ActivityPanel } from './panels/ActivityPanel';
import { PermissionDialog } from './panels/PermissionDialog';
import { RaphaelVisualizer, VisualizerDebugStats } from './visualizer/RaphaelVisualizer';
import { DebugPanel } from './visualizer/DebugPanel';
import { FloatingVisualizer } from './visualizer/FloatingVisualizer';
import { useAudioReactive, playSpeechWav, resumeAudioContext } from './visualizer/useAudioReactive';
import { deriveRaphaelState } from './visualizer/deriveState';
import { DEFAULT_TUNABLES, QualityTier, VisualizerTunables } from './visualizer/types';

export default function App() {
  const isFloating = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'floating';
  if (isFloating) return <FloatingVisualizer />;
  return <MainApp />;
}

function MainApp() {
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
  const [taskError, setTaskError] = useState(false);
  const [allPermissions, setAllPermissions] = useState(false);
  const logEndRef = useRef<HTMLDivElement | null>(null);
  const summaryRef = useRef<string | null>(null);

  // --- Visualizer wiring -------------------------------------------------
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  if (!audioElRef.current && typeof window !== 'undefined') audioElRef.current = new Audio();
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [completedAt, setCompletedAt] = useState<number | null>(null);
  const [aiError, setAiError] = useState(false);
  const [visualizerMode, setVisualizerMode] = useState<'embedded' | 'large'>('embedded');
  const [showDebug, setShowDebug] = useState(false);
  const [debugState, setDebugState] = useState<RaphaelState | null>(null);
  const [debugStats, setDebugStats] = useState<VisualizerDebugStats | null>(null);
  const [tunables, setTunables] = useState<VisualizerTunables>(DEFAULT_TUNABLES);
  const [forceQuality, setForceQuality] = useState<QualityTier | null>(null);

  const audioBands = useAudioReactive(audioElRef.current, tunables.audioSensitivity);

  const raphaelState = useMemo(
    () =>
      deriveRaphaelState({
        aiError,
        taskError,
        permissionPending: !!permissionRequest,
        running,
        paused,
        hasSteps: !!stepInfo,
        isSpeaking,
        debugOverride: debugState
      }),
    [aiError, taskError, permissionRequest, running, paused, stepInfo, isSpeaking, debugState]
  );

  async function speak(text: string) {
    if (!text || !text.trim() || !window.raphael?.speak) return;
    try {
      await resumeAudioContext();
      const result = await window.raphael.speak(text);
      if (!result.ok) {
        console.warn('[speak] TTS synthesis error:', result.reason);
        return;
      }

      setIsSpeaking(true);
      const played = await playSpeechWav(result.audioBase64, () => {
        setIsSpeaking(false);
      });

      if (!played && audioElRef.current) {
        const audioEl = audioElRef.current;
        audioEl.src = `data:${result.mime};base64,${result.audioBase64}`;
        audioEl.volume = 1.0;
        audioEl.muted = false;
        audioEl.onended = () => setIsSpeaking(false);
        audioEl.onerror = () => setIsSpeaking(false);
        await audioEl.play().catch(() => setIsSpeaking(false));
      }
    } catch (err) {
      console.error('[speak] playback error:', err);
      setIsSpeaking(false);
    }
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') setShowDebug((v) => !v);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    if (!window.raphael) return;
    window.raphael.getEnvironmentProfile().then(setEnv).catch(console.error);
    window.raphael.getAiStatus().then((s) => {
      setAiStatus(s);
      if (s?.setupProgress) setSetupProgress(s.setupProgress);
    }).catch(console.error);
    window.raphael.getActivity().then(setActivity).catch(console.error);
    window.raphael.getAlwaysAllowAll?.().then(setAllPermissions).catch(console.error);

    const offPermission = window.raphael.onPermissionRequest?.(setPermissionRequest);
    const offActivity = window.raphael.onActivity?.((entry) => setActivity((prev) => [...prev, entry]));
    const offAiSetup = window.raphael.onAiSetupProgress?.((p: any) => {
      setSetupProgress(p);
      setAiError(p.stage === 'error');
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
        setTaskError(!!update.error);
        if (!update.error) {
          setCompletedAt(performance.now());
          speak(update.status || summaryRef.current || 'Done.');
        }
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
    summaryRef.current = plan.summary;
    if (plan.steps.length === 0) {
      setRunning(false);
      setStatus(plan.summary);
      setCompletedAt(performance.now());
      speak(plan.summary);
    }
  }

  async function decide(decision: PermissionDecision) {
    if (!permissionRequest) return;
    await window.raphael.respondToPermission(permissionRequest.requestId, decision);
    if (decision === 'always_allow_all') setAllPermissions(true);
    setPermissionRequest(null);
  }

  return (
    <div className="flex h-screen flex-col">
      <audio ref={audioElRef} className="hidden" preload="auto" />
      <header className="flex items-center justify-between border-b border-raphael-border px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tracking-wide text-raphael-text">RAPHAEL</span>
          <span className="rounded bg-raphael-accent/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-raphael-accent">
            v2.0
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => speak("Raphael voice synthesis is active and online.")}
            className="rounded-md border border-raphael-border px-2.5 py-1 text-xs text-raphael-textMuted hover:text-raphael-text"
            title="Click to test Raphael's voice"
          >
            🔊 Test Voice
          </button>
          <button
            onClick={async () => {
              const next = !allPermissions;
              await window.raphael.setAlwaysAllowAll?.(next);
              setAllPermissions(next);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              allPermissions
                ? 'border-raphael-ok/40 bg-raphael-ok/15 text-raphael-ok'
                : 'border-raphael-border text-raphael-textMuted hover:text-raphael-text'
            }`}
            title="Toggle full permission execution without confirmation prompts"
          >
            {allPermissions ? 'Permissions: All Allowed ✓' : 'Permissions: Ask'}
          </button>
          <button
            onClick={() => setVisualizerMode((m) => (m === 'embedded' ? 'large' : 'embedded'))}
            className="rounded-md border border-raphael-border px-2.5 py-1 text-xs text-raphael-textMuted hover:text-raphael-text"
          >
            {visualizerMode === 'embedded' ? 'Expand' : 'Collapse'}
          </button>
          <button
            onClick={() => window.raphael.openFloatingVisualizer()}
            className="rounded-md border border-raphael-border px-2.5 py-1 text-xs text-raphael-textMuted hover:text-raphael-text"
          >
            Float
          </button>
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="rounded-md border border-raphael-border px-2.5 py-1 text-xs text-raphael-textMuted hover:text-raphael-text"
            title="Ctrl+Shift+D"
          >
            Debug
          </button>
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
        {visualizerMode === 'embedded' && (
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
        )}

        <div className="flex flex-1 flex-col justify-end gap-3">
          <div ref={logEndRef} className="relative flex-1 overflow-hidden rounded-lg border border-raphael-border bg-[#020305]">
            <RaphaelVisualizer
              state={raphaelState}
              audio={audioBands}
              tunables={tunables}
              forceQuality={forceQuality}
              completedAt={completedAt}
              onStats={setDebugStats}
            />
            {showDebug && (
              <DebugPanel
                stats={debugStats}
                tunables={tunables}
                onTunablesChange={setTunables}
                forceQuality={forceQuality}
                onForceQualityChange={setForceQuality}
                debugState={debugState}
                onDebugStateChange={setDebugState}
                onClose={() => setShowDebug(false)}
              />
            )}
            {visualizerMode === 'embedded' && (
              <div className="pointer-events-none absolute bottom-3 left-3 right-3 text-center text-xs text-raphael-textMuted/80">
                Try: <span className="text-raphael-text">"Create a folder called Projects"</span> or{' '}
                <span className="text-raphael-text">"What's my system?"</span>
              </div>
            )}
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
