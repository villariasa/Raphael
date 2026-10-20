import type { PermissionRequest, PermissionDecision } from '../../../shared/ipc';

interface Props {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => void;
}

const RISK_LABEL: Record<PermissionRequest['risk'], { text: string; color: string }> = {
  low: { text: 'Low risk', color: 'text-raphael-ok' },
  medium: { text: 'Medium risk', color: 'text-raphael-warn' },
  high: { text: 'High risk', color: 'text-raphael-danger' }
};

export function PermissionDialog({ request, onDecision }: Props) {
  const risk = RISK_LABEL[request.risk];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] rounded-lg border border-raphael-border bg-raphael-surface p-5 shadow-xl">
        <p className="text-xs font-medium uppercase tracking-wide text-raphael-textMuted">Raphael needs permission</p>
        <p className={`mt-1 text-xs ${risk.color}`}>{risk.text}</p>
        <p className="mt-3 text-sm text-raphael-text">{request.explanation}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            onClick={() => onDecision('allow_once')}
            className="rounded-md bg-raphael-accent px-3 py-2 text-sm font-medium text-white hover:bg-raphael-accent/90"
          >
            Allow Once
          </button>
          <button
            onClick={() => onDecision('always_allow')}
            className="rounded-md border border-raphael-border px-3 py-2 text-sm text-raphael-text hover:bg-raphael-surfaceAlt"
          >
            Always Allow for this action
          </button>
          <button
            onClick={() => onDecision('deny')}
            className="rounded-md border border-raphael-border px-3 py-2 text-sm text-raphael-danger hover:bg-raphael-danger/10"
          >
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
