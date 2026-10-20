interface Props {
  summary: string | null;
  status: string | null;
  stepInfo: string | null;
  running: boolean;
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export function CurrentTaskPanel({ summary, status, stepInfo, running, paused, onPause, onResume, onStop }: Props) {
  return (
    <div className="rounded-lg border border-raphael-border bg-raphael-surface p-4">
      <h2 className="mb-2 text-sm font-medium text-raphael-text">Current Task</h2>
      {!summary && <p className="text-sm text-raphael-textMuted">Nothing running. Tell Raphael what to do.</p>}
      {summary && (
        <div className="space-y-1">
          <p className="text-sm text-raphael-text">{summary}</p>
          {stepInfo && <p className="text-xs text-raphael-textMuted">{stepInfo}</p>}
          <p className="text-sm text-raphael-accent">{status}</p>
        </div>
      )}
      {running && (
        <div className="mt-3 flex gap-2">
          {!paused ? (
            <button onClick={onPause} className="rounded-md border border-raphael-border px-3 py-1.5 text-xs text-raphael-text hover:bg-raphael-surfaceAlt">
              Pause
            </button>
          ) : (
            <button onClick={onResume} className="rounded-md border border-raphael-border px-3 py-1.5 text-xs text-raphael-text hover:bg-raphael-surfaceAlt">
              Resume
            </button>
          )}
          <button onClick={onStop} className="rounded-md border border-raphael-danger/50 bg-raphael-danger/10 px-3 py-1.5 text-xs text-raphael-danger hover:bg-raphael-danger/20">
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
