interface Props {
  label: string;
  ok: boolean;
  detail?: string;
}

export function StatusPill({ label, ok, detail }: Props) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-raphael-border bg-raphael-surface px-3 py-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-raphael-ok' : 'bg-raphael-danger'}`} />
      <span className="text-raphael-textMuted">{label}</span>
      {detail && <span className="text-raphael-text">{detail}</span>}
    </div>
  );
}
