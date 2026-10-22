import { WordFormationType } from './types';

const CONNECTOR_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'nor', 'so', 'yet',
  'in', 'on', 'at', 'to', 'for', 'with', 'by', 'of', 'from', 'about',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their',
  'this', 'that', 'these', 'those', 'as', 'if', 'then', 'than'
]);

const CRITICAL_REGEX = /\b(error|failed|failure|missing|installer|verified|success|successfully|compatible|preparing|admin|administrator|privileges|warning|notice|solution|exception|denied|granted|complete|completed|installing|analyzing)\b/i;

const FORMATION_POOL: WordFormationType[] = [
  'word-slide',
  'assembly',
  'horizontal',
  'center-expand',
  'vertical',
  'particle-to-text',
  'radial',
  'diagonal',
  'stacked',
  'glitch'
];

export interface AnalyzedWord {
  raw: string;
  clean: string;
  importance: number;
  isKeyword: boolean;
  emphasisType: 'critical' | 'keyword' | 'entity' | 'normal' | 'connector';
  formation: WordFormationType;
}

export function hasJapaneseCharacters(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text);
}

export function splitIntoSentences(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  // Split on both English and Japanese sentence boundaries (. ! ? 。 ！ ？)
  const matches = clean.match(/[^.!?。！？\r\n]+(?:[.!?。！？\r\n]+|$)/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [clean];
}

export function splitJapaneseIntoSegments(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];

  // Split on punctuation first, keeping punctuation attached
  const chunks = clean.match(/[^、。！？\s]+[、。！？]?/g) || [clean];
  const segments: string[] = [];

  for (const chunk of chunks) {
    if (chunk.length <= 6) {
      segments.push(chunk);
    } else {
      // Further split long chunks along particle or Katakana/Kanji/Alphabet boundaries
      const sub = chunk.match(
        /(?:[a-zA-Z0-9_]+|[A-Z]+|[\u3400-\u4dbf\u4e00-\u9fff]+[\u3040-\u309f]*|[\u30a0-\u30ff]+[\u3040-\u309f]*|[\u3040-\u309f]{2,}|[、。！？]+)/g
      );
      if (sub && sub.length > 1) {
        segments.push(...sub.map((s) => s.trim()).filter(Boolean));
      } else {
        segments.push(chunk);
      }
    }
  }

  return segments.filter(Boolean);
}

export function splitIntoWords(sentence: string): string[] {
  const clean = sentence.trim();
  if (hasJapaneseCharacters(clean)) {
    return splitJapaneseIntoSegments(clean);
  }
  return clean.split(/\s+/).filter(Boolean);
}

export function cleanWord(raw: string): string {
  return raw.replace(/^[^\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+|[^\w\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]+$/g, '');
}

export function analyzeWord(
  raw: string,
  wordIndex: number,
  totalWordsInSentence: number,
  prevFormation: WordFormationType | null
): AnalyzedWord {
  const clean = cleanWord(raw);
  const lower = clean.toLowerCase();

  const isJp = hasJapaneseCharacters(raw);
  let isConnector = CONNECTOR_WORDS.has(lower);
  let isCritical = CRITICAL_REGEX.test(clean) || /[A-Z0-9_]{3,}/.test(raw) || /^[0-9]+(\.[0-9]+)?$/.test(clean);
  let isCodeOrParam = clean.includes('_') || (clean.length > 2 && /^[a-z]+[A-Z]/.test(clean));

  if (isJp) {
    // Japanese semantic detection
    if (/^(?:は|が|を|に|へ|と|で|から|まで|より|も|ね|よ|の)$/.test(clean)) {
      isConnector = true;
    } else if (/我が君|主様|マスター/.test(clean)) {
      isCritical = true;
    } else if (/完了|正常|成功|互換|準備|権限|エラー|解決|指示|実行|確認|検出|警告|注意|終了|起動|作成|検索/.test(clean)) {
      isCritical = true;
    } else if (/[\u30a0-\u30ff]{3,}/.test(clean) || /[a-zA-Z0-9_]/.test(clean)) {
      // Katakana technical loanword or code identifier
      isCodeOrParam = true;
    }
  }

  let importance = 0.7;
  let isKeyword = false;
  let emphasisType: AnalyzedWord['emphasisType'] = 'normal';

  if (isConnector) {
    importance = 0.35;
    emphasisType = 'connector';
  } else if (isCritical || isCodeOrParam) {
    importance = 1.0;
    isKeyword = true;
    emphasisType = isCritical ? 'critical' : 'entity';
  } else if (clean.length > 7 || /^[A-Z]/.test(clean)) {
    importance = 0.85;
    isKeyword = true;
    emphasisType = 'keyword';
  }

  // Choose formation dynamically based on word role and avoid repeating the previous formation
  let formation: WordFormationType;

  if (isCritical) {
    const criticalChoices: WordFormationType[] = ['center-expand', 'glitch', 'radial', 'particle-to-text', 'assembly'];
    formation = criticalChoices.find((f) => f !== prevFormation) ?? 'center-expand';
  } else if (isCodeOrParam) {
    formation = prevFormation === 'vertical' ? 'assembly' : 'vertical';
  } else if (wordIndex === 0 && totalWordsInSentence > 1) {
    formation = 'word-slide';
  } else if (isConnector) {
    const connectorChoices: WordFormationType[] = ['horizontal', 'center-contract', 'word-slide'];
    formation = connectorChoices.find((f) => f !== prevFormation) ?? 'horizontal';
  } else {
    // Dynamic selection from pool
    const candidates = FORMATION_POOL.filter((f) => f !== prevFormation);
    const hash = (clean.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) + wordIndex * 7) % candidates.length;
    formation = candidates[hash];
  }

  return {
    raw,
    clean,
    importance,
    isKeyword,
    emphasisType,
    formation
  };
}
