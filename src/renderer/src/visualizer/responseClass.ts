/**
 * Raphael response classification (報告 / 回答 / 告). A presentation layer on
 * top of the real answer — never a replacement for it. Derived from the same
 * real signals the rest of the app already has; no fabrication.
 */
export type ResponseClass = 'hokoku' | 'kaito' | 'koku';

export interface ClassInfo {
  id: ResponseClass;
  kanji: string;
  romaji: string;
  english: string;
  /** luminous energy tint for this class (blue-green family per the reference) */
  accent: string;
  /** secondary energy tint */
  accent2: string;
}

export const CLASS_INFO: Record<ResponseClass, ClassInfo> = {
  // Report / status / general info — the calm default (teal-green energy).
  hokoku: { id: 'hokoku', kanji: '報告', romaji: 'HŌKOKU', english: 'REPORT', accent: '#49c7b4', accent2: '#3f7fd6' },
  // Answer / solution — cooler, focused blue.
  kaito: { id: 'kaito', kanji: '回答', romaji: 'KAITŌ', english: 'SOLUTION', accent: '#5a9bff', accent2: '#49c7b4' },
  // Notice / alert — warm amber, still elegant (used for errors / permission).
  koku: { id: 'koku', kanji: '告', romaji: 'KOKU', english: 'NOTICE', accent: '#e8a33d', accent2: '#e5664d' }
};

/** Parchment glyph color from the reference — shared across all classes. */
export const GLYPH_COLOR = '#ddd3c2';

export interface ClassifySignals {
  isError: boolean;
  needsPermission: boolean;
  /** the response came from actually performing an action / solving something */
  hadAction: boolean;
}

export function classifyResponse(s: ClassifySignals): ResponseClass {
  if (s.isError || s.needsPermission) return 'koku';
  if (s.hadAction) return 'kaito';
  return 'hokoku';
}
