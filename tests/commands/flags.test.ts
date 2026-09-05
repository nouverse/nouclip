import { describe, expect, it } from 'bun:test';
import { isDraftRun, shouldSkipSubtitles } from '@/commands/auto';
import { resolveFramingMode } from '@/commands/framing';
import {
  applyDurationBudget,
  parseNumericOption,
  resolveTranscriptJson
} from '@/commands/highlight';
import { parseFontSize } from '@/commands/subtitle';
import { CliError } from '@/utils/errors';

/**
 * Commander represents `--no-x` as `{ x: false }` and defaults it to `true`.
 * These tests pin that contract: reading a `noX` key instead silently ignored
 * the `--no-subs`, `--no-subtitle` and `--no-burn` aliases.
 */
describe('shouldSkipSubtitles', () => {
  it('is false by default', () => {
    expect(shouldSkipSubtitles({})).toBe(false);
    expect(shouldSkipSubtitles({ subtitles: true, subs: true, subtitle: true })).toBe(false);
  });

  it('honours every --no-subtitles alias', () => {
    expect(shouldSkipSubtitles({ subtitles: false })).toBe(true);
    expect(shouldSkipSubtitles({ subs: false })).toBe(true);
    expect(shouldSkipSubtitles({ subtitle: false })).toBe(true);
  });
});

describe('isDraftRun', () => {
  it('is false by default', () => {
    expect(isDraftRun({})).toBe(false);
    expect(isDraftRun({ burn: true })).toBe(false);
  });

  it('is true for --draft and for --no-burn', () => {
    expect(isDraftRun({ draft: true })).toBe(true);
    expect(isDraftRun({ burn: false })).toBe(true);
  });
});

describe('resolveFramingMode', () => {
  it('defaults to blur', () => {
    expect(resolveFramingMode({})).toBe('blur');
    expect(resolveFramingMode()).toBe('blur');
  });

  it('reads --mode', () => {
    expect(resolveFramingMode({ mode: 'pad' })).toBe('pad');
    expect(resolveFramingMode({ mode: ' CENTER ' })).toBe('center');
  });

  it('lets the shortcuts win over --mode', () => {
    expect(resolveFramingMode({ mode: 'pad', center: true })).toBe('center');
    expect(resolveFramingMode({ mode: 'pad', blur: true })).toBe('blur');
  });

  it('rejects an unknown mode instead of silently reframing', () => {
    expect(() => resolveFramingMode({ mode: 'zoom' })).toThrow(CliError);
    expect(() => resolveFramingMode({ mode: 'zoom' })).toThrow(/blur, center, pad, stretch/);
  });
});

describe('parseFontSize', () => {
  it('stays undefined when the flag is absent so the style preset size wins', () => {
    expect(parseFontSize(undefined)).toBeUndefined();
  });

  it('parses a numeric flag', () => {
    expect(parseFontSize('72')).toBe(72);
  });

  it('rejects values that would produce an unreadable subtitle', () => {
    expect(() => parseFontSize('0')).toThrow(/positive number/);
    expect(() => parseFontSize('-10')).toThrow(CliError);
    expect(() => parseFontSize('big')).toThrow(CliError);
  });
});

describe('parseNumericOption', () => {
  it('falls back when absent', () => {
    expect(parseNumericOption(undefined, '--max-clips', 5)).toBe(5);
  });

  it('parses floats', () => {
    expect(parseNumericOption('12.5', '--min-duration', 25)).toBe(12.5);
  });

  it('names the offending flag in the error', () => {
    expect(() => parseNumericOption('abc', '--max-clips', 5)).toThrow(/--max-clips/);
    expect(() => parseNumericOption('0', '--max-clips', 5)).toThrow(/positive number/);
  });
});

describe('applyDurationBudget', () => {
  const clip = (duration: number) => ({ duration });

  it('keeps every clip when they fit the budget', () => {
    const clips = [clip(30), clip(40), clip(50)];
    expect(applyDurationBudget(clips, 180)).toEqual(clips);
  });

  it('stops adding clips once the budget is spent', () => {
    expect(applyDurationBudget([clip(60), clip(60), clip(60)], 120)).toEqual([clip(60), clip(60)]);
  });

  it('skips an oversized clip but still fits a later shorter one', () => {
    expect(applyDurationBudget([clip(50), clip(60), clip(25)], 80)).toEqual([clip(50), clip(25)]);
  });

  it('always keeps the top clip even when it alone exceeds the budget', () => {
    expect(applyDurationBudget([clip(90), clip(30)], 45)).toEqual([clip(90)]);
  });

  it('handles an empty result set', () => {
    expect(applyDurationBudget([], 180)).toEqual([]);
  });
});

describe('resolveTranscriptJson', () => {
  it('passes a JSON path through', () => {
    expect(resolveTranscriptJson('/w/a.whisper.json')).toBe('/w/a.whisper.json');
  });

  it('derives the companion JSON for a video path', () => {
    expect(resolveTranscriptJson('/w/clip.mp4')).toBe('/w/clip.whisper.json');
    expect(resolveTranscriptJson('/w/my.video.name.mkv')).toBe('/w/my.video.name.whisper.json');
  });
});
