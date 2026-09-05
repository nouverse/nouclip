import { describe, expect, it } from 'bun:test';
import { ASSGenerator, type WordTimestamp } from '@/core/ass';

const words: WordTimestamp[] = [
  { word: 'Halo', start: 0.0, end: 0.4, probability: 0.99 },
  { word: 'ini', start: 0.45, end: 0.8, probability: 0.98 },
  { word: 'test', start: 0.85, end: 1.4, probability: 0.99 }
];

describe('ASSGenerator.formatTime', () => {
  it('formats H:MM:SS.cc', () => {
    expect(ASSGenerator.formatTime(0)).toBe('0:00:00.00');
    expect(ASSGenerator.formatTime(65.432)).toBe('0:01:05.43');
    expect(ASSGenerator.formatTime(3661.05)).toBe('1:01:01.05');
  });

  it('clamps invalid values to zero', () => {
    expect(ASSGenerator.formatTime(-4)).toBe('0:00:00.00');
    expect(ASSGenerator.formatTime(Number.NaN)).toBe('0:00:00.00');
  });
});

describe('ASSGenerator.sanitizeWords', () => {
  it('drops blank words and unusable timings', () => {
    const cleaned = ASSGenerator.sanitizeWords([
      { word: 'ok', start: 0, end: 1 },
      { word: '   ', start: 1, end: 2 },
      { word: 'nan', start: Number.NaN, end: 2 },
      { word: 'inf', start: 0, end: Number.POSITIVE_INFINITY }
    ]);
    expect(cleaned.map((w) => w.word)).toEqual(['ok']);
  });
});

describe('ASSGenerator.groupWords', () => {
  it('chunks words up to the group size', () => {
    const groups = ASSGenerator.groupWords(words, 2, 0.4);
    expect(groups.map((g) => g.map((w) => w.word))).toEqual([['Halo', 'ini'], ['test']]);
  });

  it('breaks a group early on a long silence', () => {
    const withPause: WordTimestamp[] = [
      { word: 'a', start: 0, end: 0.4 },
      { word: 'b', start: 3.0, end: 3.4 }
    ];
    expect(ASSGenerator.groupWords(withPause, 2, 0.4)).toHaveLength(2);
  });

  it('consumes every word exactly once', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      word: `w${i}`,
      start: i * 0.5,
      end: i * 0.5 + 0.4
    }));
    const flat = ASSGenerator.groupWords(many, 4, 0.4).flat();
    expect(flat.map((w) => w.word)).toEqual(many.map((w) => w.word));
  });
});

describe('ASSGenerator.generateKineticASS', () => {
  it('produces a valid script structure', () => {
    const ass = ASSGenerator.generateKineticASS(words, { fontSize: 64 });

    expect(ass).toContain('[Script Info]');
    expect(ass).toContain('PlayResX: 1080');
    expect(ass).toContain('PlayResY: 1920');
    expect(ass).toContain('[V4+ Styles]');
    expect(ass).toContain('[Events]');
    expect(ass).toContain('Dialogue:');
    expect(ass).toContain('Arial Black, 64');
    expect(ass.endsWith('\n')).toBe(true);
  });

  it('emits one dialogue line per word so each word can be highlighted', () => {
    const dialogues = ASSGenerator.generateKineticASS(words)
      .split('\n')
      .filter((l) => l.startsWith('Dialogue:'));
    expect(dialogues).toHaveLength(words.length);
    expect(dialogues[0]).toContain('HALO');
  });

  it('caps the trailing word so captions do not linger through a pause', () => {
    const lingering: WordTimestamp[] = [{ word: 'solo', start: 10, end: 40 }];
    const line = ASSGenerator.generateKineticASS(lingering, { maxWordDuration: 1 })
      .split('\n')
      .find((l) => l.startsWith('Dialogue:')) as string;

    expect(line).toContain('0:00:10.00,0:00:11.00');
  });

  it('gives zero-length words a minimum visible duration', () => {
    const line = ASSGenerator.generateKineticASS([{ word: 'x', start: 5, end: 5 }])
      .split('\n')
      .find((l) => l.startsWith('Dialogue:')) as string;

    expect(line).toContain('0:00:05.00,0:00:05.30');
  });

  it('strips brace characters that would break ASS override tags', () => {
    const ass = ASSGenerator.generateKineticASS([{ word: '{evil}', start: 0, end: 1 }]);
    expect(ass).toContain('EVIL');
    expect(ass).not.toContain('{EVIL}');
  });

  it('handles an empty transcript without emitting dialogue', () => {
    const ass = ASSGenerator.generateKineticASS([]);
    expect(ass).toContain('[Events]');
    expect(ass).not.toContain('Dialogue:');
  });
});
