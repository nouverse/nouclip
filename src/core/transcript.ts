import type { WordTimestamp } from '@/core/ass';
import { formatCueTime } from '@/utils/time';

export const TRANSCRIPT_FORMATS = ['txt', 'srt', 'vtt', 'json'] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export function isTranscriptFormat(value: string): value is TranscriptFormat {
  return (TRANSCRIPT_FORMATS as readonly string[]).includes(value);
}

export interface TranscriptData {
  words: WordTimestamp[];
  text?: string;
  duration?: number;
}

export interface SpeechInterval {
  start: number;
  end: number;
}

export interface SilenceTrimOptions {
  /** Maximum silence gap allowed between words before trimming. Default: 0.6s */
  maxGap?: number;
  /** Padding around speech segments in seconds. Default: 0.1s */
  pad?: number;
  /** Total media duration. */
  totalDuration?: number;
}

/** Splits words into fixed-size cue groups. */
export function groupWords(words: WordTimestamp[], size: number): WordTimestamp[][] {
  if (size <= 0) throw new Error('Group size must be greater than 0');

  const groups: WordTimestamp[][] = [];
  for (let i = 0; i < words.length; i += size) {
    groups.push(words.slice(i, i + size));
  }
  return groups;
}

/**
 * Splits words into readable paragraphs, breaking on sentence-final
 * punctuation, long silences, or a hard word cap.
 */
export function groupParagraphs(
  words: WordTimestamp[],
  options: { gapThreshold?: number; maxWords?: number } = {}
): WordTimestamp[][] {
  const gapThreshold = options.gapThreshold ?? 1.2;
  const maxWords = options.maxWords ?? 20;

  const paragraphs: WordTimestamp[][] = [];
  let current: WordTimestamp[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    current.push(word);

    const text = word.word.trim();
    const next = words[i + 1];
    const shouldBreak =
      /[.?!]$/.test(text) ||
      (next !== undefined && next.start - word.end > gapThreshold) ||
      current.length >= maxWords;

    if (shouldBreak || i === words.length - 1) {
      paragraphs.push(current);
      current = [];
    }
  }

  return paragraphs;
}

/**
 * Computes non-silent speech intervals from word timestamps.
 * Gaps longer than `maxGap` are excised while adding `pad` margins
 * around active speech.
 */
export function findSpeechIntervals(
  words: WordTimestamp[],
  options: SilenceTrimOptions = {}
): SpeechInterval[] {
  if (!words || words.length === 0) {
    if (options.totalDuration && options.totalDuration > 0) {
      return [{ start: 0, end: options.totalDuration }];
    }
    return [];
  }

  const maxGap = options.maxGap ?? 0.6;
  const pad = options.pad ?? 0.1;
  const totalDuration = options.totalDuration ?? words[words.length - 1].end + pad;

  const intervals: SpeechInterval[] = [];
  let currentStart = Math.max(0, words[0].start - pad);
  let currentEnd = words[0].end + pad;

  for (let i = 1; i < words.length; i++) {
    const word = words[i];
    const gap = word.start - words[i - 1].end;

    if (gap > maxGap) {
      // End current interval and start a new one
      intervals.push({
        start: Number(currentStart.toFixed(3)),
        end: Number(Math.min(currentEnd, totalDuration).toFixed(3))
      });
      currentStart = Math.max(0, word.start - pad);
      currentEnd = word.end + pad;
    } else {
      // Extend current interval
      currentEnd = word.end + pad;
    }
  }

  intervals.push({
    start: Number(currentStart.toFixed(3)),
    end: Number(Math.min(currentEnd, totalDuration).toFixed(3))
  });

  return intervals.filter((int) => int.end > int.start);
}

/**
 * Recalculates word timestamp timings after silence intervals have been excised.
 * Aligns subtitles frame-accurately with the trimmed video output.
 */
export function shiftWordTimestamps(
  words: WordTimestamp[],
  intervals: SpeechInterval[]
): WordTimestamp[] {
  if (intervals.length === 0) return [];

  const shifted: WordTimestamp[] = [];

  for (const word of words) {
    let accumulatedTime = 0;
    let placed = false;

    for (const interval of intervals) {
      const intervalDuration = interval.end - interval.start;

      // Check if word falls in or intersects this interval
      if (word.end >= interval.start && word.start <= interval.end) {
        const relativeStart = Math.max(0, word.start - interval.start);
        const relativeEnd = Math.max(relativeStart + 0.1, word.end - interval.start);

        shifted.push({
          ...word,
          start: Number((accumulatedTime + relativeStart).toFixed(3)),
          end: Number((accumulatedTime + relativeEnd).toFixed(3))
        });
        placed = true;
        break;
      }

      accumulatedTime += intervalDuration;
    }

    if (!placed) {
      // If outside trimmed boundaries, clamp to nearest interval
      shifted.push({ ...word });
    }
  }

  return shifted;
}

export function toSrt(words: WordTimestamp[], wordsPerCue = 4): string {
  return groupWords(words, wordsPerCue)
    .map((group, idx) => {
      const start = formatCueTime(group[0].start, ',');
      const end = formatCueTime(group[group.length - 1].end, ',');
      const text = group.map((w) => w.word.trim()).join(' ');
      return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

export function toVtt(words: WordTimestamp[], wordsPerCue = 4): string {
  const cues = groupWords(words, wordsPerCue).map((group) => {
    const start = formatCueTime(group[0].start, '.');
    const end = formatCueTime(group[group.length - 1].end, '.');
    const text = group.map((w) => w.word.trim()).join(' ');
    return `${start} --> ${end}\n${text}\n`;
  });

  return ['WEBVTT\n', ...cues].join('\n');
}

export function toPlainText(data: TranscriptData, source: string): string {
  const words = data.words;
  const duration = data.duration ?? (words.length > 0 ? words[words.length - 1].end : 0);

  const pad = (n: number) => Math.floor(n).toString().padStart(2, '0');
  const stamp = (sec: number) => `${pad(sec / 60)}:${pad(sec % 60)}`;

  const lines: string[] = [
    '='.repeat(60),
    'TRANSCRIPT EXPORT (NOUCLIP)',
    `Source   : ${source}`,
    `Duration : ${Math.floor(duration / 60)}m ${Math.floor(duration % 60)}s (${duration.toFixed(1)}s)`,
    `Words    : ${words.length}`,
    '='.repeat(60),
    ''
  ];

  for (const paragraph of groupParagraphs(words)) {
    const start = paragraph[0].start;
    const end = paragraph[paragraph.length - 1].end;
    lines.push(
      `[${stamp(start)} -> ${stamp(end)}] ${paragraph.map((w) => w.word.trim()).join(' ')}\n`
    );
  }

  return lines.join('\n');
}

export function renderTranscript(
  data: TranscriptData,
  format: TranscriptFormat,
  source: string
): string {
  switch (format) {
    case 'txt':
      return toPlainText(data, source);
    case 'srt':
      return toSrt(data.words);
    case 'vtt':
      return toVtt(data.words);
    case 'json':
      return JSON.stringify(data, null, 2);
  }
}
