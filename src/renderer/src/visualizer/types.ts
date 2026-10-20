import type { RaphaelState } from '../../../shared/ipc';

export type { RaphaelState };

export type QualityTier = 'high' | 'medium' | 'low';

/** Real-time frequency bands extracted from an actual AnalyserNode (§6). Zeroed when no audio is playing. */
export interface AudioBands {
  bass: number; // 0..1
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;
  amplitude: number; // overall RMS-ish level, 0..1
}

export const SILENT_AUDIO: AudioBands = {
  bass: 0,
  lowMid: 0,
  mid: 0,
  highMid: 0,
  treble: 0,
  amplitude: 0
};

/** Developer tuning knobs (§15), applied as multipliers on top of state-driven motion. */
export interface VisualizerTunables {
  coreIntensity: number;
  ringIntensity: number;
  particleDensity: number;
  rayIntensity: number;
  rotationSpeed: number;
  distortion: number;
  bloom: number;
  audioSensitivity: number;
}

export const DEFAULT_TUNABLES: VisualizerTunables = {
  coreIntensity: 1,
  ringIntensity: 1,
  particleDensity: 1,
  rayIntensity: 1,
  rotationSpeed: 1,
  distortion: 1,
  bloom: 1,
  audioSensitivity: 1
};

export const GLYPH_RING_TEXTS = [
  'RAPHAEL · LOCAL INTELLIGENCE · VOICE PROCESSING · COMPUTER CONTROL · ',
  'EXECUTION ENGINE · USER AUTHORIZATION · SYSTEM ACTIVE · LOCAL AI · ',
  'TASK PROCESSING · SYSTEM ONLINE · TASK EXECUTION · RAPHAEL · '
];
