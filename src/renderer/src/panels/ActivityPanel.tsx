import type { ActivityEntry } from '../../../shared/ipc';

interface Props {
  entries: ActivityEntry[];
  onClear: () => void;
}

const LEVEL_COLOR: Record<ActivityEntry['level'], string> = {
  info: 'text-raphael-textMuted',
  success: 'text-raphael-ok',
  warn: 'text-raphael-warn',
  error: 'text-raphael-danger'
};

export function ActivityPanel({ entries, onClear }: Props) {
  return (
    <div className="flex h-full flex-col rounded-lg border border-raphael-border bg-raphael-surface">
      <div className="flex items-center justify-between border-b border-raphael-border px-4 py-3">
        <h2 className="text-sm font-medium text-raphael-text">Activity</h2>
        <button
          onClick={onClear}
          className="text-xs text-raphael-textMuted hover:text-raphael-text transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-5">
        {entries.length === 0 && <p className="py-4 text-raphael-textMuted">No activity yet.</p>}
        {entries
          .slice()
          .reverse()
          .map((e) => (
            <div key={e.id} className="py-1">
              <span className="text-raphael-textMuted">{new Date(e.timestamp).toLocaleTimeString()}</span>{' '}
              <span className={LEVEL_COLOR[e.level]}>{e.message}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
