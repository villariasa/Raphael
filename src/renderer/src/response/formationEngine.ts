import { Formation, Intensity, ResponseType } from './types';

/**
 * FormationEngine — picks how the system label is *constructed* for a given
 * response, so the typography isn't one fixed fade every time (§5). Selection
 * is deterministic per responseId (stable within a response, varied across
 * them) and adapts to the window aspect ratio (§18).
 */

export interface FormationChoice {
  formation: Formation;
  /** 0..1 energy multiplier derived from intensity */
  energy: number;
}

const INTENSITY_ENERGY: Record<Intensity, number> = { low: 0.6, medium: 0.8, high: 1 };

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff; // 0..1
}

/**
 * Choose a formation from response type, intensity, window aspect, and a
 * stable per-response variation. Aspect wins for extreme shapes; type biases
 * the rest.
 */
export function selectFormation(
  type: ResponseType,
  intensity: Intensity,
  width: number,
  height: number,
  responseId: string
): FormationChoice {
  const energy = INTENSITY_ENERGY[intensity];
  const aspect = width / Math.max(1, height);
  const v = hashId(responseId);

  // Extreme shapes dictate the layout regardless of type.
  if (aspect < 0.72) return { formation: 'vertical', energy };
  if (aspect > 2.1) return { formation: 'horizontal', energy };

  let formation: Formation;
  if (type === 'KOKU') {
    // Notices: sharp + immediate → radial or assembly.
    formation = v < 0.5 ? 'radial' : 'assembly';
  } else if (type === 'KAITO') {
    // Answers: more active → assembling/horizontal construction.
    formation = v < 0.45 ? 'assembly' : v < 0.75 ? 'horizontal' : 'stacked';
  } else {
    // Reports: calm → stacked/radial, occasional horizontal.
    formation = v < 0.55 ? 'stacked' : v < 0.8 ? 'radial' : 'horizontal';
  }
  return { formation, energy };
}

/** Classify response importance/length into an intensity (§8 duration adaptation). */
export function intensityFor(message: string, type: ResponseType): Intensity {
  const len = message.trim().length;
  let base: Intensity = len < 40 ? 'low' : len < 160 ? 'medium' : 'high';
  // Notices and answers carry more weight than plain reports.
  if (type === 'KOKU' && base === 'low') base = 'medium';
  if (type === 'KAITO' && base === 'low') base = 'medium';
  return base;
}

/** Per-formation phase durations (ms). Intensity scales the whole thing (§8). */
export interface FormationTiming {
  act: number;
  cls: number;
  proc: number;
  fade: number;
}

export function timingFor(intensity: Intensity, reduced: boolean): FormationTiming {
  if (reduced) return { act: 90, cls: 220, proc: 120, fade: 150 };
  // low ≈ 0.9s intro, medium ≈ 1.7s, high ≈ 2.6s (plus fade) — §8 targets.
  switch (intensity) {
    case 'low':
      return { act: 160, cls: 430, proc: 180, fade: 280 };
    case 'high':
      return { act: 520, cls: 760, proc: 980, fade: 540 };
    default:
      return { act: 360, cls: 600, proc: 560, fade: 440 };
  }
}
