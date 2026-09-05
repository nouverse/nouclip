import { describe, expect, it } from 'bun:test';
import type { WordTimestamp } from '@/core/ass';
import {
  findSpeechIntervals,
  groupParagraphs,
  groupWords,
  isTranscriptFormat,
  renderTranscript,
  shiftWordTimestamps,
  toPlainText,
  toSrt,
  toVtt
} from '@/core/transcript';

const words: WordTimestamp[] = [
  { word: 'Satu', start: 0, end: 0.5 },
  { word: 'dua', start: 0.5, end: 1 },
  { word: 'tiga', start: 1, end: 1.5 },
  { word: 'empat.', start: 1.5, end: 2 },
  { word: 'Lima', start: 2, end: 2.5 }
];

describe('groupWords', () => {
  it('chunks into fixed-size groups', () => {
    expect(groupWords(words, 2).map((g) => g.length)).toEqual([2, 2, 1]);
  });

  it('returns nothing for an empty transcript', () => {
    expect(groupWords([], 4)).toEqual([]);
  });

  it('rejects a non-positive size', () => {
    expect(() => groupWords(words, 0)).toThrow(/greater than 0/);
  });
});

describe('groupParagraphs', () => {
  it('breaks on sentence-final punctuation', () => {
    const paragraphs = groupParagraphs(words);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].map((w) => w.word).join(' ')).toBe('Satu dua tiga empat.');
  });

  it('breaks on a long silence', () => {
    const gapped: WordTimestamp[] = [
      { word: 'a', start: 0, end: 0.5 },
      { word: 'b', start: 5, end: 5.5 }
    ];
    expect(groupParagraphs(gapped, { gapThreshold: 1.2 })).toHaveLength(2);
  });

  it('breaks on the max word cap', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ word: `w${i}`, start: i, end: i + 0.5 }));
    expect(groupParagraphs(many, { maxWords: 3 })).toHaveLength(3);
  });

  it('never drops a word', () => {
    expect(groupParagraphs(words).flat()).toHaveLength(words.length);
  });
});

describe('findSpeechIntervals & shiftWordTimestamps', () => {
  const wordsWithGaps: WordTimestamp[] = [
    { word: 'Mulai', start: 1.0, end: 2.0 },
    { word: 'lanjut', start: 2.2, end: 3.0 },
    // 3.0 -> 6.0 is a 3.0s silent gap
    { word: 'akhir', start: 6.0, end: 7.5 }
  ];

  it('identifies non-silent speech intervals', () => {
    const intervals = findSpeechIntervals(wordsWithGaps, { maxGap: 0.6, pad: 0.1 });
    expect(intervals).toHaveLength(2);
    expect(intervals[0].start).toBe(0.9);
    expect(intervals[0].end).toBe(3.1);
    expect(intervals[1].start).toBe(5.9);
    expect(intervals[1].end).toBe(7.6);
  });

  it('shifts word timestamps according to excised intervals', () => {
    const intervals = findSpeechIntervals(wordsWithGaps, { maxGap: 0.6, pad: 0.1 });
    const shifted = shiftWordTimestamps(wordsWithGaps, intervals);

    expect(shifted).toHaveLength(3);
    expect(shifted[0].word).toBe('Mulai');
    expect(shifted[0].start).toBe(0.1);
    expect(shifted[2].word).toBe('akhir');
    // First interval duration = 3.1 - 0.9 = 2.2s.
    // Word start relative to 2nd interval (5.9) = 6.0 - 5.9 = 0.1s.
    // New start = 2.2 + 0.1 = 2.3s.
    expect(shifted[2].start).toBeCloseTo(2.3, 1);
  });
});

describe('toSrt', () => {
  it('emits numbered cues with comma milliseconds', () => {
    const srt = toSrt(words, 2);
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,000\nSatu dua');
    expect(srt).toContain('2\n00:00:01,000 --> 00:00:02,000\ntiga empat.');
    expect(srt).toContain('3\n');
  });
});

describe('toVtt', () => {
  it('starts with the WEBVTT header and uses dot milliseconds', () => {
    const vtt = toVtt(words, 2);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:00.000 --> 00:00:01.000');
    expect(vtt).not.toContain(',000');
  });
});

describe('toPlainText', () => {
  it('includes a header and timestamped paragraphs', () => {
    const txt = toPlainText({ words, duration: 2.5 }, 'video.mp4');
    expect(txt).toContain('TRANSCRIPT EXPORT (NOUCLIP)');
    expect(txt).toContain('Source   : video.mp4');
    expect(txt).toContain('Words    : 5');
    expect(txt).toContain('[00:00 -> 00:02] Satu dua tiga empat.');
  });

  it('derives the duration from the last word when absent', () => {
    expect(toPlainText({ words }, 'x.mp4')).toContain('(2.5s)');
  });
});

describe('renderTranscript', () => {
  it('dispatches on format', () => {
    expect(renderTranscript({ words }, 'srt', 'x')).toContain('-->');
    expect(renderTranscript({ words }, 'vtt', 'x')).toContain('WEBVTT');
    expect(renderTranscript({ words }, 'txt', 'x')).toContain('TRANSCRIPT EXPORT');
    expect(JSON.parse(renderTranscript({ words }, 'json', 'x')).words).toHaveLength(5);
  });
});
