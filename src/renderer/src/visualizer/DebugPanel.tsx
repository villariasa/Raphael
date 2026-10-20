import { QualityTier, RaphaelState, VisualizerTunables } from './types';
import { VisualizerDebugStats } from './RaphaelVisualizer';

const TUNABLE_FIELDS: Array<{ key: keyof VisualizerTunables; label: string; min: number; max: number; step: number }> = [
  { key: 'coreIntensity', label: 'Core intensity', min: 0.3, max: 2, step: 0.05 },
  { key: 'ringIntensity', label: 'Ring intensity', min: 0, max: 2, step: 0.05 },
  { key: 'particleDensity', label: 'Particle density', min: 0, max: 2, step: 0.05 },
  { key: 'rayIntensity', label: 'Ray intensity', min: 0, max: 2, step: 0.05 },
  { key: 'rotationSpeed', label: 'Rotation speed', min: 0, max: 3, step: 0.05 },
  { key: 'distortion', label: 'Distortion', min: 0, max: 2, step: 0.05 },
  { key: 'bloom', label: 'Bloom', min: 0, max: 2, step: 0.05 },
  { key: 'audioSensitivity', label: 'Audio sensitivity', min: 0, max: 3, step: 0.05 }
];

const ALL_STATES: RaphaelState[] = [
  'idle',
  'listening',
  'thinking',
  'researching',
  'waiting_for_permission',
  'executing',
  'speaking',
  'completed',
  'error'
];

const LIVE_STATES = new Set<RaphaelState>(['idle', 'thinking', 'executing', 'waiting_for_permission', 'completed', 'error', 'speaking']);

interface Props {
  stats: VisualizerDebugStats | null;
  tunables: VisualizerTunables;
  onTunablesChange: (t: VisualizerTunables) => void;
  forceQuality: QualityTier | null;
  onForceQualityChange: (q: QualityTier | null) => void;
  debugState: RaphaelState | null;
  onDebugStateChange: (s: RaphaelState | null) => void;
  onClose: () => void;
}

export function DebugPanel({
  stats,
  tunables,
  onTunablesChange,
  forceQuality,
  onForceQualityChange,
  debugState,
  onDebugStateChange,
  onClose
}: Props) {
  return (
    <div className="absolute right-3 top-3 z-20 w-72 rounded-lg border border-raphael-border bg-raphael-surface/95 p-3 text-xs text-raphael-text shadow-xl backdrop-blur">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold tracking-wide">VISUALIZER DEBUG</span>
        <button onClick={onClose} className="text-raphael-textMuted hover:text-raphael-text">
          ✕
        </button>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px] text-raphael-textMuted">
        <span>FPS</span>
        <span className="text-right text-raphael-text">{stats?.fps ?? '–'}</span>
        <span>State</span>
        <span className="text-right text-raphael-text">{stats?.state ?? '–'}</span>
        <span>Quality</span>
        <span className="text-right text-raphael-text">{stats?.quality ?? '–'}</span>
        <span>Resolution</span>
        <span className="text-right text-raphael-text">{stats?.resolution ?? '–'}</span>
        <span>Particles</span>
        <span className="text-right text-raphael-text">{stats?.particleCount ?? '–'}</span>
        <span>Amplitude</span>
        <span className="text-right text-raphael-text">{fmt(stats?.audio.amplitude)}</span>
        <span>Bass</span>
        <span className="text-right text-raphael-text">{fmt(stats?.audio.bass)}</span>
        <span>Mid</span>
        <span className="text-right text-raphael-text">{fmt(stats?.audio.mid)}</span>
        <span>Treble</span>
        <span className="text-right text-raphael-text">{fmt(stats?.audio.treble)}</span>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-raphael-textMuted">Render mode</label>
        <select
          value={forceQuality ?? 'auto'}
          onChange={(e) => onForceQualityChange(e.target.value === 'auto' ? null : (e.target.value as QualityTier))}
          className="w-full rounded border border-raphael-border bg-raphael-surfaceAlt px-2 py-1 text-raphael-text"
        >
          <option value="auto">Auto (adaptive)</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <div className="mb-3">
        <label className="mb-1 block text-raphael-textMuted">
          State preview <span className="text-[10px]">(listening/researching not yet wired to real signals)</span>
        </label>
        <select
          value={debugState ?? 'live'}
          onChange={(e) => onDebugStateChange(e.target.value === 'live' ? null : (e.target.value as RaphaelState))}
          className="w-full rounded border border-raphael-border bg-raphael-surfaceAlt px-2 py-1 text-raphael-text"
        >
          <option value="live">Live (real signals)</option>
          {ALL_STATES.map((s) => (
            <option key={s} value={s}>
              {s} {LIVE_STATES.has(s) ? '' : '(preview only)'}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        {TUNABLE_FIELDS.map((f) => (
          <div key={f.key}>
            <div className="mb-0.5 flex justify-between text-raphael-textMuted">
              <span>{f.label}</span>
              <span className="text-raphael-text">{tunables[f.key].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={f.min}
              max={f.max}
              step={f.step}
              value={tunables[f.key]}
              onChange={(e) => onTunablesChange({ ...tunables, [f.key]: parseFloat(e.target.value) })}
              className="w-full accent-raphael-accent"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(v: number | undefined): string {
  return v === undefined ? '–' : v.toFixed(2);
}
