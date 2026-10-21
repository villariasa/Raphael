import { CLASS_INFO, GLYPH_COLOR, ResponseClass } from '../visualizer/responseClass';

export { GLYPH_COLOR };

/** Public response-type names per the response-event contract (§2/§3). */
export type ResponseType = 'HOKOKU' | 'KAITO' | 'KOKU';
export type Intensity = 'low' | 'medium' | 'high';
export type Formation = 'stacked' | 'horizontal' | 'vertical' | 'radial' | 'assembly';
export type AnimationMode = 'full' | 'reduced' | 'off';

export interface SystemLabel {
  kanji: string;
  romanized: string;
  english: string;
}

/**
 * The structured response event the whole pipeline is built around
 * (§2 response contract). Built in ONE place (buildSystemResponse) so the
 * animation/voice/text layers never re-guess the response type.
 */
export interface SystemResponse {
  responseId: string;
  responseType: ResponseType;
  systemLabel: SystemLabel;
  message: string;
  voice: { enabled: boolean; text: string; priority: 'low' | 'normal' | 'high' };
  animation: { enabled: boolean; intensity: Intensity; formation: Formation };
  /** energy tints carried through to the animation engine */
  accent: string;
  accent2: string;
}

const TYPE_TO_CLASS: Record<ResponseType, ResponseClass> = {
  HOKOKU: 'hokoku',
  KAITO: 'kaito',
  KOKU: 'koku'
};
const CLASS_TO_TYPE: Record<ResponseClass, ResponseType> = {
  hokoku: 'HOKOKU',
  kaito: 'KAITO',
  koku: 'KOKU'
};

export function typeToClass(t: ResponseType): ResponseClass {
  return TYPE_TO_CLASS[t];
}
export function classToType(c: ResponseClass): ResponseType {
  return CLASS_TO_TYPE[c];
}

export function labelFor(t: ResponseType): SystemLabel {
  const info = CLASS_INFO[typeToClass(t)];
  return { kanji: info.kanji, romanized: info.romaji, english: info.english };
}
export function accentsFor(t: ResponseType): { accent: string; accent2: string } {
  const info = CLASS_INFO[typeToClass(t)];
  return { accent: info.accent, accent2: info.accent2 };
}
