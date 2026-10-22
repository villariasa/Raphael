import { classifyResponse, ClassifySignals } from '../visualizer/responseClass';
import { accentsFor, AnimationMode, classToType, labelFor, SystemResponse } from './types';
import { intensityFor, selectFormation } from './formationEngine';

export interface BuildInput {
  message: string;
  signals: ClassifySignals;
  /** current overlay dimensions, for aspect-aware formation selection */
  width: number;
  height: number;
  /** user settings */
  voiceEnabled: boolean;
  animationMode: AnimationMode;
  /** 'important' shows the animation only for KOKU/KAITO; 'always' for every reply */
  scope: 'always' | 'important';
}

let counter = 0;
function newId(): string {
  counter += 1;
  try {
    return (window.crypto?.randomUUID?.() ?? `r-${Date.now()}-${counter}`);
  } catch {
    return `r-${Date.now()}-${counter}`;
  }
}

/**
 * Single source of truth that turns a ready answer + its real signals into the
 * SystemResponse contract (§2). Every Raphael response goes through here, so
 * classification/intensity/formation/voice are decided in one place rather
 * than re-guessed by the animation, voice, and text layers.
 */
export function buildSystemResponse(input: BuildInput): SystemResponse {
  const type = classToType(classifyResponse(input.signals));
  const label = labelFor(type);
  const { accent, accent2 } = accentsFor(type);
  const intensity = intensityFor(input.message, type);
  const { formation } = selectFormation(type, intensity, input.width, input.height, newId());

  const priority: 'low' | 'normal' | 'high' = type === 'KOKU' ? 'high' : 'normal';

  const scopeAllows = input.scope === 'always' || type === 'KOKU' || type === 'KAITO';
  const animationEnabled = input.animationMode !== 'off' && scopeAllows;

  const spokenScript = `${label.spokenIntro} ${input.message.trim()}`;

  return {
    responseId: newId(),
    responseType: type,
    systemLabel: label,
    message: input.message,
    spokenScript,
    voice: { enabled: input.voiceEnabled, text: spokenScript, priority },
    animation: {
      enabled: animationEnabled,
      intensity: input.animationMode === 'reduced' ? 'low' : intensity,
      formation
    },
    accent,
    accent2
  };
}
