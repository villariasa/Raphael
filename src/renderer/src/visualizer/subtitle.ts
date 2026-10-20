/**
 * Subtitle timing model. Turns an utterance into word tokens, each assigned
 * a share of the total speech duration weighted by length + punctuation
 * pauses, so reveal timing tracks how long the voice actually spends on
 * each word rather than a fixed typewriter speed. Structured so true
 * word/phoneme timestamps (if a future TTS engine provides them) can
 * replace `buildTokens` without touching the renderer.
 */
export interface SubtitleToken {
  text: string;
  /** cumulative normalized time (0..1) at which this word begins */
  startFrac: number;
}

const STRONG_PUNCT = /[.!?…。！？]$/;
const WEAK_PUNCT = /[,;:、，；：]$/;

/** Rough "how long to dwell on this word" weight. */
function wordWeight(word: string): number {
  // Base on visible length (a proxy for syllable count), floored so very
  // short words still take a beat.
  let w = Math.max(2, word.replace(/[^\p{L}\p{N}]/gu, '').length);
  // Linger after punctuation to create the natural pause before the next word.
  if (STRONG_PUNCT.test(word)) w += 7;
  else if (WEAK_PUNCT.test(word)) w += 3.5;
  return w;
}

export function buildTokens(text: string): SubtitleToken[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const weights = words.map(wordWeight);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const tokens: SubtitleToken[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    tokens.push({ text: words[i], startFrac: acc / total });
    acc += weights[i];
  }
  return tokens;
}

/**
 * Given playback progress (0..1), return the rolling subtitle window: the
 * words revealed so far, trimmed from the front so it stays ~1–2 lines
 * (never a growing paragraph). A word is revealed once playback reaches its
 * start, so text appears in step with the voice.
 */
export function visibleSubtitle(tokens: SubtitleToken[], progress: number, maxChars = 84): string {
  if (tokens.length === 0) return '';
  // How many words have been reached by now (always at least the first once
  // any progress exists).
  let revealed = 0;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startFrac <= progress) revealed = i + 1;
    else break;
  }
  if (revealed === 0) revealed = progress > 0 ? 1 : 0;
  if (revealed === 0) return '';

  // Take the tail that fits within maxChars, word-aligned, ending at the
  // most recently revealed word so older words scroll off the front.
  const end = revealed;
  let start = end;
  let len = -1; // account for no leading space
  while (start > 0) {
    const next = start - 1;
    const addition = tokens[next].text.length + 1;
    if (len + addition > maxChars && start < end) break;
    len += addition;
    start = next;
  }
  return tokens.slice(start, end).map((t) => t.text).join(' ');
}
