import { describe, expect, it } from 'bun:test';
import type { WordTimestamp } from '@/core/ass';
import { findHeuristicMoments, findKeywordMoments, round } from '@/core/highlights';

/** Builds a synthetic transcript of `count` words, one word every 0.5s. */
function makeWords(count: number, at?: Record<number, string>): WordTimestamp[] {
  return Array.from({ length: count }, (_, i) => ({
    word: at?.[i] ?? `w${i}`,
    start: i * 0.5,
    end: i * 0.5 + 0.4
  }));
}

describe('round', () => {
  it('rounds to the requested precision', () => {
    expect(round(1.2345, 1)).toBe(1.2);
    expect(round(1.25, 1)).toBe(1.3);
    expect(round(10, 0)).toBe(10);
  });
});

describe('findKeywordMoments', () => {
  const words = makeWords(400, { 100: 'bitcoin', 110: 'bitcoin', 300: 'Bitcoin' });

  it('finds clips around keyword matches', () => {
    const clips = findKeywordMoments(words, 'bitcoin', 25, 60, 5);
    expect(clips.length).toBeGreaterThan(0);
    expect(clips[0].title).toContain('BITCOIN');
    expect(clips[0].end).toBeGreaterThan(clips[0].start);
  });

  it('is case insensitive', () => {
    expect(findKeywordMoments(words, 'BITCOIN', 25, 60, 5).length).toBeGreaterThan(0);
  });

  it('collapses near-duplicate matches into one clip', () => {
    // Matches at index 100 and 110 are 5s apart, well inside the overlap window.
    const clips = findKeywordMoments(words, 'bitcoin', 25, 60, 5);
    const starts = clips.map((c) => c.start);
    expect(new Set(starts).size).toBe(starts.length);
    expect(clips).toHaveLength(2);
  });

  it('respects maxClips', () => {
    expect(findKeywordMoments(words, 'w', 25, 60, 3)).toHaveLength(3);
  });

  it('returns nothing for an empty transcript, blank keyword, or no match', () => {
    expect(findKeywordMoments([], 'x', 25, 60, 5)).toEqual([]);
    expect(findKeywordMoments(words, '  ', 25, 60, 5)).toEqual([]);
    expect(findKeywordMoments(words, 'zzzz', 25, 60, 5)).toEqual([]);
    expect(findKeywordMoments(words, 'w', 25, 60, 0)).toEqual([]);
  });
});

describe('findHeuristicMoments', () => {
  it('spreads clips across the transcript', () => {
    const clips = findHeuristicMoments(makeWords(600), 25, 60, 5);
    expect(clips).toHaveLength(5);

    const starts = clips.map((c) => c.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    for (const clip of clips) {
      expect(clip.end).toBeGreaterThan(clip.start);
      expect(clip.duration).toBeGreaterThan(0);
    }
  });

  it('collapses a short transcript into a single clip instead of duplicates', () => {
    const clips = findHeuristicMoments(makeWords(3), 25, 60, 5);
    expect(clips).toHaveLength(1);
    expect(clips[0].start).toBe(0);
    expect(clips[0].end).toBe(1.4);
  });

  it('handles empty input and a zero clip budget', () => {
    expect(findHeuristicMoments([], 25, 60, 5)).toEqual([]);
    expect(findHeuristicMoments(makeWords(100), 25, 60, 0)).toEqual([]);
  });

  it('never indexes past the end of the transcript', () => {
    for (const count of [1, 2, 7, 31, 61, 200]) {
      const clips = findHeuristicMoments(makeWords(count), 25, 60, 5);
      for (const clip of clips) {
        expect(Number.isFinite(clip.start)).toBe(true);
        expect(Number.isFinite(clip.end)).toBe(true);
      }
    }
  });
});
