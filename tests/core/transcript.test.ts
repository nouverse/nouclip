import { describe, expect, it } from 'bun:test';
import type { WordTimestamp } from '@/core/ass';
import {
  MIN_REMAPPED_WORD_DURATION,
  assignTimelineSegments,
  findSpeechIntervals,
  groupParagraphs,
  groupWords,
  isTranscriptFormat,
  remapTimelineWordTimestamps,
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

describe('remapTimelineWordTimestamps', () => {
  const seg = (start: number, end: number) => ({ start, end, duration: end - start });
  // One word per second of a 100s source, each 0.8s long.
  const source: WordTimestamp[] = Array.from({ length: 100 }, (_, i) => ({
    word: `w${i}`,
    start: i,
    end: i + 0.8,
    probability: 0.9
  }));

  it('lands each segment at the summed length of the ones before it, in timeline order', () => {
    const remapped = remapTimelineWordTimestamps(source, [seg(90, 95), seg(0, 6), seg(14, 50)]);

    expect(remapped.map((w) => w.word).slice(0, 7)).toEqual([
      'w90',
      'w91',
      'w92',
      'w93',
      'w94',
      'w0',
      'w1'
    ]);
    // The hook (90-95) plays first, from zero.
    expect(remapped[0]).toEqual({ word: 'w90', start: 0, end: 0.8, probability: 0.9, segment: 0 });
    // The setup (0-6) follows after the hook's 5 seconds.
    expect(remapped.find((w) => w.word === 'w0')).toMatchObject({ start: 5, end: 5.8, segment: 1 });
    // The body (14-50) follows after 5 + 6 seconds.
    expect(remapped.find((w) => w.word === 'w14')).toMatchObject({
      start: 11,
      end: 11.8,
      segment: 2
    });
    expect(remapped.at(-1)).toMatchObject({ word: 'w49', start: 46, end: 46.8 });
  });

  it('drops words outside every segment and keeps the rest intact', () => {
    const remapped = remapTimelineWordTimestamps(source, [seg(10, 13)]);
    expect(remapped.map((w) => w.word)).toEqual(['w10', 'w11', 'w12']);
    expect(remapped.every((w) => w.probability === 0.9)).toBe(true);
  });

  it('clips a word straddling a cut to the segment and keeps it readable', () => {
    const straddling: WordTimestamp[] = [
      { word: 'before', start: 9.5, end: 10.4 },
      { word: 'after', start: 12.9, end: 13.6 },
      { word: 'sliver', start: 12.99, end: 13.6 }
    ];
    const remapped = remapTimelineWordTimestamps(straddling, [seg(10, 13), seg(20, 21)]);

    // Starts at the cut, ends where it ended.
    expect(remapped[0]).toMatchObject({ word: 'before', start: 0, end: 0.4 });
    // Ends at the cut.
    expect(remapped[1]).toMatchObject({ word: 'after', start: 2.9, end: 3 });
    // A 10ms overlap would flicker: it gets the minimum duration instead.
    expect(remapped[2]).toMatchObject({ word: 'sliver', start: 2.99 });
    expect(remapped[2].end).toBeCloseTo(2.99 + MIN_REMAPPED_WORD_DURATION, 3);
  });

  it('shows a word twice when two segments replay it', () => {
    const remapped = remapTimelineWordTimestamps(source, [seg(50, 52), seg(49, 53)]);
    expect(remapped.map((w) => w.word)).toEqual(['w50', 'w51', 'w49', 'w50', 'w51', 'w52']);
    expect(remapped.map((w) => w.segment)).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it('returns nothing for an empty timeline', () => {
    expect(remapTimelineWordTimestamps(source, [])).toEqual([]);
  });

  it('orders by output time even when the source was unsorted', () => {
    const shuffled = [source[3], source[1], source[2]];
    expect(remapTimelineWordTimestamps(shuffled, [seg(0, 10)]).map((w) => w.word)).toEqual([
      'w1',
      'w2',
      'w3'
    ]);
  });
});

describe('assignTimelineSegments', () => {
  const seg = (start: number, end: number) => ({ start, end, duration: end - start });
  const clipWords: WordTimestamp[] = [
    { word: 'a', start: 0, end: 1 },
    { word: 'b', start: 4.8, end: 5.3 }, // straddles the cut at 5s, mostly after it
    { word: 'c', start: 7, end: 8 },
    { word: 'd', start: 12, end: 13 } // past the last cut: belongs to the last segment
  ];

  it('tags clip-clock words by the segment their midpoint falls in', () => {
    const tagged = assignTimelineSegments(clipWords, [seg(90, 95), seg(0, 6), seg(14, 16)]);
    expect(tagged.map((w) => w.segment)).toEqual([0, 1, 1, 2]);
    expect(tagged.map((w) => w.start)).toEqual(clipWords.map((w) => w.start));
  });

  it('leaves words alone when there is no cut', () => {
    expect(assignTimelineSegments(clipWords, [seg(0, 20)])).toBe(clipWords);
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
