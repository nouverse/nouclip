import { describe, expect, it } from 'bun:test';
import { formatCueTime, formatSecondsToTimestamp, parseRange, parseTimestamp } from '@/utils/time';

describe('parseTimestamp', () => {
  it('parses plain seconds', () => {
    expect(parseTimestamp('10')).toBe(10);
    expect(parseTimestamp('85.5')).toBe(85.5);
    expect(parseTimestamp(42)).toBe(42);
  });

  it('parses colon notation', () => {
    expect(parseTimestamp('01:30')).toBe(90);
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('01:02:03')).toBe(3723);
    expect(parseTimestamp('00:00:01.5')).toBe(1.5);
  });

  it('parses human units', () => {
    expect(parseTimestamp('10s')).toBe(10);
    expect(parseTimestamp('1m30s')).toBe(90);
    expect(parseTimestamp('2m')).toBe(120);
    expect(parseTimestamp('1h')).toBe(3600);
    expect(parseTimestamp('1h30m10s')).toBe(5410);
    expect(parseTimestamp('1.5h')).toBe(5400);
  });

  it('treats empty input as zero', () => {
    expect(parseTimestamp(undefined)).toBe(0);
    expect(parseTimestamp(null)).toBe(0);
    expect(parseTimestamp('')).toBe(0);
    expect(parseTimestamp('   ')).toBe(0);
  });

  it('clamps negative numeric input to zero', () => {
    expect(parseTimestamp(-5)).toBe(0);
  });

  it('rejects junk instead of silently returning a partial match', () => {
    expect(() => parseTimestamp('banana')).toThrow(/Could not parse timestamp/);
    expect(() => parseTimestamp('12x34')).toThrow(/Could not parse timestamp/);
    // Previously the unanchored unit regex matched the trailing "1h" here.
    expect(() => parseTimestamp('garbage 1h')).toThrow();
    expect(() => parseTimestamp('1:2:3:4')).toThrow(/Invalid timestamp format/);
    expect(() => parseTimestamp('aa:bb')).toThrow(/Invalid timestamp format/);
    expect(() => parseTimestamp(Number.NaN)).toThrow(/Invalid timestamp/);
  });
});

describe('parseRange', () => {
  it('supports every delimiter', () => {
    expect(parseRange('01:00-02:00')).toEqual({
      start: 60,
      end: 120,
      duration: 60,
      raw: '01:00-02:00'
    });
    expect(parseRange('10s-40s')).toEqual({ start: 10, end: 40, duration: 30, raw: '10s-40s' });
    expect(parseRange('00:00..00:30')).toEqual({
      start: 0,
      end: 30,
      duration: 30,
      raw: '00:00..00:30'
    });
    expect(parseRange('01:00 to 01:45')).toEqual({
      start: 60,
      end: 105,
      duration: 45,
      raw: '01:00 to 01:45'
    });
    expect(parseRange('60,90')).toEqual({ start: 60, end: 90, duration: 30, raw: '60,90' });
  });

  it('falls back to the default duration when only a start is given', () => {
    expect(parseRange('01:00')).toMatchObject({ start: 60, end: undefined, duration: 30 });
    expect(parseRange('01:00', 12)).toMatchObject({ duration: 12 });
  });

  it('rejects an end that is not after the start', () => {
    expect(() => parseRange('02:00-01:00')).toThrow(/must be after start/);
    expect(() => parseRange('02:00-02:00')).toThrow(/must be after start/);
  });

  it('rejects an empty range', () => {
    expect(() => parseRange('  ')).toThrow(/Range is empty/);
  });
});

describe('formatSecondsToTimestamp', () => {
  it('formats mm:ss and hh:mm:ss', () => {
    expect(formatSecondsToTimestamp(90)).toBe('01:30');
    expect(formatSecondsToTimestamp(90, true)).toBe('00:01:30');
    expect(formatSecondsToTimestamp(3723)).toBe('01:02:03');
    expect(formatSecondsToTimestamp(0)).toBe('00:00');
  });

  it('is defensive about bad input', () => {
    expect(formatSecondsToTimestamp(-5)).toBe('00:00');
    expect(formatSecondsToTimestamp(Number.NaN)).toBe('00:00');
  });
});

describe('formatCueTime', () => {
  it('renders SRT and VTT cue timestamps', () => {
    expect(formatCueTime(0, ',')).toBe('00:00:00,000');
    expect(formatCueTime(65.432, ',')).toBe('00:01:05,432');
    expect(formatCueTime(3661.05, '.')).toBe('01:01:01.050');
  });
});
