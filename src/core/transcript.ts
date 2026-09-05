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
