import type { SpeechTimestamp } from '../../../shared/ipc';
import {
  ClassificationTiming,
  ResponseTimeline,
  ResponseType,
  SentenceTimelineSegment,
  SystemLabel,
  WordTimelineSegment
} from './types';
import {
  analyzeWord,
  cleanWord,
  splitIntoSentences,
  splitIntoWords
} from './semanticImportance';

export interface ProviderInput {
  responseId: string;
  responseType: ResponseType;
  label: SystemLabel;
  message: string;
  spokenScript: string;
  audioDuration: number;
  rawTimestamps?: SpeechTimestamp[];
  accent: string;
  accent2: string;
}

export interface WordTimed {
  raw: string;
  clean: string;
  start: number;
  end: number;
  sentenceIndex: number;
  wordIndexInSentence: number;
}

/**
 * Priority 1: WordTimestampProvider
 * Checks if raw timestamps provided by TTS match individual words.
 */
export class WordTimestampProvider {
  static tryMatch(
    words: { raw: string; clean: string; sentenceIndex: number; wordIndexInSentence: number }[],
    timestamps: SpeechTimestamp[],
    spokenResponseOffset: number
  ): WordTimed[] | null {
    if (!timestamps || timestamps.length === 0) return null;

    // Filter out timestamps that belong to the spoken intro
    const responseTimestamps = timestamps.filter(
      (ts) => ts.start >= spokenResponseOffset * 0.8
    );

    // If we don't have enough timestamps to cover a significant portion of words, bail to Sentence provider
    if (responseTimestamps.length < words.length * 0.6) return null;

    const result: WordTimed[] = [];
    let tsIndex = 0;

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (tsIndex < responseTimestamps.length) {
        const ts = responseTimestamps[tsIndex];
        const start = ts.start;
        const end = Math.max(start + 0.1, ts.end);
        result.push({
          raw: w.raw,
          clean: w.clean,
          start,
          end,
          sentenceIndex: w.sentenceIndex,
          wordIndexInSentence: w.wordIndexInSentence
        });
        tsIndex++;
      } else {
        // Fallback for remaining trailing words
        const prev = result[result.length - 1];
        const start = prev ? prev.end : spokenResponseOffset;
        const end = start + Math.max(0.18, w.clean.length * 0.05);
        result.push({
          raw: w.raw,
          clean: w.clean,
          start,
          end,
          sentenceIndex: w.sentenceIndex,
          wordIndexInSentence: w.wordIndexInSentence
        });
      }
    }

    return result;
  }
}

/**
 * Priority 2: SentenceTimestampProvider
 * When TTS yields subtitle blocks / phrase timestamps (e.g. edge-tts WebVTT),
 * distributes the duration across the words of each phrase with character weighting & pause offsets.
 */
export class SentenceTimestampProvider {
  static tryMatch(
    sentences: string[],
    timestamps: SpeechTimestamp[],
    spokenResponseOffset: number,
    totalDuration: number
  ): WordTimed[] | null {
    if (!timestamps || timestamps.length === 0) return null;

    const result: WordTimed[] = [];
    // Identify intro vs response subtitle blocks
    const responseTimestamps = timestamps.filter((ts) => ts.start >= spokenResponseOffset * 0.7);
    if (responseTimestamps.length === 0) return null;

    let wordGlobalIndex = 0;

    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const sentText = sentences[sIdx];
      const sentWords = splitIntoWords(sentText);
      if (sentWords.length === 0) continue;

      // Find matching timestamp or slice of timestamps for this sentence
      const ts = responseTimestamps[sIdx] || {
        start: sIdx === 0 ? spokenResponseOffset : result[result.length - 1]?.end ?? spokenResponseOffset,
        end: sIdx === sentences.length - 1 ? totalDuration : spokenResponseOffset + (sIdx + 1) * 2.0,
        text: sentText
      };

      const segStart = Math.max(spokenResponseOffset, ts.start);
      const segEnd = Math.max(segStart + 0.3, ts.end);
      const segDuration = segEnd - segStart;

      // Calculate relative word weights based on character count and punctuation
      const weights = sentWords.map((w) => {
        let wt = Math.max(1, cleanWord(w).length);
        if (/[,\-;:]/.test(w)) wt += 3;
        if (/[.!?]/.test(w)) wt += 5;
        return wt;
      });
      const totalWeight = weights.reduce((a, b) => a + b, 0);

      let currentWordStart = segStart;
      for (let wIdx = 0; wIdx < sentWords.length; wIdx++) {
        const raw = sentWords[wIdx];
        const clean = cleanWord(raw);
        const fraction = weights[wIdx] / totalWeight;
        const wordDur = Math.max(0.12, segDuration * fraction);
        const wordEnd = Math.min(segEnd, currentWordStart + wordDur);

        result.push({
          raw,
          clean,
          start: currentWordStart,
          end: wordEnd,
          sentenceIndex: sIdx,
          wordIndexInSentence: wIdx
        });

        currentWordStart = wordEnd;
        wordGlobalIndex++;
      }
    }

    return result.length > 0 ? result : null;
  }
}

/**
 * Priority 3: FallbackTimingProvider
 * Estimates word-level timing from actual audio duration, speech rate, and punctuation pauses.
 */
export class FallbackTimingProvider {
  static estimate(
    sentences: string[],
    spokenResponseOffset: number,
    totalDuration: number
  ): WordTimed[] {
    const result: WordTimed[] = [];
    const availableDuration = Math.max(1.0, totalDuration - spokenResponseOffset);

    // Collect all words across all sentences
    const allItems: { raw: string; clean: string; sIdx: number; wIdx: number; weight: number }[] = [];

    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const words = splitIntoWords(sentences[sIdx]);
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        const raw = words[wIdx];
        const clean = cleanWord(raw);
        let weight = Math.max(2, clean.length);
        if (/[,\-;:]/.test(raw)) weight += 4;
        if (/[.!?]/.test(raw)) weight += 7;
        allItems.push({ raw, clean, sIdx, wIdx, weight });
      }
    }

    if (allItems.length === 0) return [];

    const totalWeight = allItems.reduce((acc, it) => acc + it.weight, 0);
    let currentTime = spokenResponseOffset;

    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      const frac = item.weight / totalWeight;
      const wordDur = Math.max(0.12, availableDuration * frac);
      const end = i === allItems.length - 1 ? totalDuration : currentTime + wordDur;

      result.push({
        raw: item.raw,
        clean: item.clean,
        start: currentTime,
        end,
        sentenceIndex: item.sIdx,
        wordIndexInSentence: item.wIdx
      });

      currentTime = end;
    }

    return result;
  }
}

/**
 * VoiceTimelineProvider
 * Coordinates the 3 timing providers in priority order and outputs the complete ResponseTimeline.
 */
export class VoiceTimelineProvider {
  static buildTimeline(input: ProviderInput): ResponseTimeline {
    const {
      responseId,
      responseType,
      label,
      message,
      spokenScript,
      audioDuration,
      rawTimestamps,
      accent,
      accent2
    } = input;

    // 1. Classification Timing
    // For "Hōkoku. Report." spoken intro:
    let voiceJapaneseStart = 1.0;
    let voiceJapaneseEnd = 1.55;
    let voiceEnglishStart = 1.6;
    let voiceEnglishEnd = 2.15;
    let spokenResponseOffset = 2.25;

    // Check if raw timestamps contain intro timings
    if (rawTimestamps && rawTimestamps.length > 0) {
      const t0 = rawTimestamps[0];
      if (t0 && /H[ōo]koku|Kait[ōo]|Koku/i.test(t0.text)) {
        voiceJapaneseStart = t0.start;
        voiceJapaneseEnd = t0.end;
      }
      if (rawTimestamps.length > 1) {
        const t1 = rawTimestamps[1];
        if (/Report|Solution|Notice/i.test(t1.text)) {
          voiceEnglishStart = t1.start;
          voiceEnglishEnd = t1.end;
          spokenResponseOffset = Math.max(voiceEnglishEnd + 0.1, 2.0);
        }
      }
    }

    const classificationTiming: ClassificationTiming = {
      start: 0.0,
      kanjiStart: 0.25,
      romajiStart: 0.65,
      englishStart: 0.95,
      voiceJapaneseStart,
      voiceJapaneseEnd,
      voiceEnglishStart,
      voiceEnglishEnd,
      end: spokenResponseOffset
    };

    // 2. Tokenize response
    const sentences = splitIntoSentences(message);
    const flatWords: { raw: string; clean: string; sentenceIndex: number; wordIndexInSentence: number }[] = [];
    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const words = splitIntoWords(sentences[sIdx]);
      for (let wIdx = 0; wIdx < words.length; wIdx++) {
        flatWords.push({
          raw: words[wIdx],
          clean: cleanWord(words[wIdx]),
          sentenceIndex: sIdx,
          wordIndexInSentence: wIdx
        });
      }
    }

    // Ensure audioDuration is reasonable
    const effectiveAudioDuration = Math.max(audioDuration, spokenResponseOffset + flatWords.length * 0.25);

    // 3. Priority Provider Resolution
    // Priority 1: Word Timestamps
    let timedWords = WordTimestampProvider.tryMatch(flatWords, rawTimestamps ?? [], spokenResponseOffset);

    // Priority 2: Sentence Timestamps
    if (!timedWords) {
      timedWords = SentenceTimestampProvider.tryMatch(
        sentences,
        rawTimestamps ?? [],
        spokenResponseOffset,
        effectiveAudioDuration
      );
    }

    // Priority 3: Fallback Estimation
    if (!timedWords) {
      timedWords = FallbackTimingProvider.estimate(
        sentences,
        spokenResponseOffset,
        effectiveAudioDuration
      );
    }

    // 4. Build Word Timeline Segments with Dynamic Formations & Semantic Emphasis
    let prevFormation: any = null;
    const segments: WordTimelineSegment[] = [];

    for (let i = 0; i < timedWords.length; i++) {
      const tw = timedWords[i];
      const sentenceLength = splitIntoWords(sentences[tw.sentenceIndex] || '').length;
      const analyzed = analyzeWord(tw.raw, tw.wordIndexInSentence, sentenceLength, prevFormation);
      prevFormation = analyzed.formation;

      segments.push({
        id: `${responseId}-w-${tw.sentenceIndex}-${tw.wordIndexInSentence}`,
        text: tw.raw,
        cleanWord: tw.clean,
        sentenceIndex: tw.sentenceIndex,
        wordIndexInSentence: tw.wordIndexInSentence,
        start: tw.start,
        end: tw.end,
        duration: Math.max(0.1, tw.end - tw.start),
        importance: analyzed.importance,
        isKeyword: analyzed.isKeyword,
        formation: analyzed.formation,
        emphasisType: analyzed.emphasisType
      });
    }

    // 5. Build Sentence Timeline Segments
    const sentenceSegments: SentenceTimelineSegment[] = [];
    for (let sIdx = 0; sIdx < sentences.length; sIdx++) {
      const wordsInSent = segments.filter((s) => s.sentenceIndex === sIdx);
      const sStart = wordsInSent[0]?.start ?? (spokenResponseOffset + sIdx * 2.0);
      const sEnd = wordsInSent[wordsInSent.length - 1]?.end ?? (sStart + 2.0);
      const transitions: ('dissolve' | 'glitch' | 'geometry-shift' | 'particle-burst')[] = [
        'dissolve',
        'geometry-shift',
        'particle-burst',
        'glitch'
      ];

      sentenceSegments.push({
        sentenceIndex: sIdx,
        text: sentences[sIdx],
        start: sStart,
        end: sEnd,
        transition: transitions[sIdx % transitions.length]
      });
    }

    const totalDuration = Math.max(
      effectiveAudioDuration,
      sentenceSegments[sentenceSegments.length - 1]?.end ?? effectiveAudioDuration
    );

    return {
      responseId,
      responseType,
      label,
      classificationTiming,
      segments,
      sentences: sentenceSegments,
      totalDuration,
      spokenScript,
      transcriptText: message,
      accent,
      accent2
    };
  }
}
