import { CLASS_INFO, GLYPH_COLOR, ResponseClass } from '../visualizer/responseClass';

export { GLYPH_COLOR };

/** Public response-type names per the response-event contract (§2/§3). */
export type ResponseType = 'HOKOKU' | 'KAITO' | 'KOKU';
export type Intensity = 'low' | 'medium' | 'high';
export type Formation = 'stacked' | 'horizontal' | 'vertical' | 'radial' | 'assembly';
export type AnimationMode = 'full' | 'reduced' | 'off';

export type WordFormationType =
  | 'horizontal'
  | 'vertical'
  | 'radial'
  | 'diagonal'
  | 'stacked'
  | 'center-expand'
  | 'center-contract'
  | 'assembly'
  | 'particle-to-text'
  | 'text-to-particle'
  | 'word-slide'
  | 'glitch'
  | 'rotating';

export interface SystemLabel {
  kanji: string;
  romanized: string;
  english: string;
  spokenIntro: string;
  spokenJapanese: string;
  spokenEnglish: string;
}

export interface WordTimelineSegment {
  id: string;
  text: string;
  cleanWord: string;
  sentenceIndex: number;
  wordIndexInSentence: number;
  start: number;
  end: number;
  duration: number;
  importance: number; // 0.0 to 1.0
  isKeyword: boolean;
  formation: WordFormationType;
  emphasisType: 'critical' | 'keyword' | 'entity' | 'normal' | 'connector';
}

export interface SentenceTimelineSegment {
  sentenceIndex: number;
  text: string;
  start: number;
  end: number;
  transition: 'dissolve' | 'glitch' | 'geometry-shift' | 'particle-burst';
}

export interface ClassificationTiming {
  start: number;
  kanjiStart: number;
  romajiStart: number;
  englishStart: number;
  voiceJapaneseStart: number;
  voiceJapaneseEnd: number;
  voiceEnglishStart: number;
  voiceEnglishEnd: number;
  end: number;
}

export interface ResponseTimeline {
  responseId: string;
  responseType: ResponseType;
  label: SystemLabel;
  classificationTiming: ClassificationTiming;
  segments: WordTimelineSegment[];
  sentences: SentenceTimelineSegment[];
  totalDuration: number;
  spokenScript: string;
  transcriptText: string;
  accent: string;
  accent2: string;
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
  spokenScript: string;
  voice: { enabled: boolean; text: string; priority: 'low' | 'normal' | 'high' };
  animation: { enabled: boolean; intensity: Intensity; formation: Formation };
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
  let spokenIntro = 'Hōkoku. Report.';
  let spokenJapanese = 'Hōkoku';
  let spokenEnglish = 'Report';
  if (t === 'KAITO') {
    spokenIntro = 'Kaitō. Solution.';
    spokenJapanese = 'Kaitō';
    spokenEnglish = 'Solution';
  } else if (t === 'KOKU') {
    spokenIntro = 'Koku. Notice.';
    spokenJapanese = 'Koku';
    spokenEnglish = 'Notice';
  }

  return {
    kanji: info.kanji,
    romanized: info.romaji,
    english: info.english,
    spokenIntro,
    spokenJapanese,
    spokenEnglish
  };
}

export function accentsFor(t: ResponseType): { accent: string; accent2: string } {
  const info = CLASS_INFO[typeToClass(t)];
  return { accent: info.accent, accent2: info.accent2 };
}
