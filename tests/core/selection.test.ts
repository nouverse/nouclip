import { describe, expect, it } from 'bun:test';
import { requireTimeSelection, resolveTimeSelection, selectionSuffix } from '@/core/selection';
import { CliError } from '@/utils/errors';

describe('resolveTimeSelection', () => {
  it('returns no selection when no time flags are given', () => {
    expect(resolveTimeSelection()).toEqual({ start: 0, duration: 0, hasSelection: false });
    expect(resolveTimeSelection({})).toMatchObject({ hasSelection: false });
  });

  it('resolves --range', () => {
    expect(resolveTimeSelection({ range: '13:25-14:50' })).toEqual({
      start: 805,
      duration: 85,
      hasSelection: true
    });
  });

  it('resolves --start with --duration', () => {
    expect(resolveTimeSelection({ start: '1m', duration: '30s' })).toEqual({
      start: 60,
      duration: 30,
      hasSelection: true
    });
  });

  it('resolves --start with --end', () => {
    expect(resolveTimeSelection({ start: '01:00', end: '01:45' })).toEqual({
      start: 60,
      duration: 45,
      hasSelection: true
    });
  });

  it('accepts the --from/--to aliases', () => {
    expect(resolveTimeSelection({ from: '10', to: '40' })).toEqual({
      start: 10,
      duration: 30,
      hasSelection: true
    });
  });

  it('treats a lone --start as no cut', () => {
    expect(resolveTimeSelection({ start: '30' })).toEqual({
      start: 30,
      duration: 0,
      hasSelection: false
    });
  });

  it('supports --end without --start', () => {
    expect(resolveTimeSelection({ end: '30' })).toEqual({
      start: 0,
      duration: 30,
      hasSelection: true
    });
  });

  it('rejects an end before the start', () => {
    expect(() => resolveTimeSelection({ start: '02:00', end: '01:00' })).toThrow(CliError);
    expect(() => resolveTimeSelection({ start: '02:00', end: '02:00' })).toThrow(/must be after/);
  });

  it('rejects a non-positive duration', () => {
    expect(() => resolveTimeSelection({ start: '10', duration: '0' })).toThrow(
      /must be greater than 0/
    );
  });

  it('prefers --duration over --end when both are present', () => {
    expect(resolveTimeSelection({ start: '10', end: '100', duration: '5' })).toMatchObject({
      duration: 5
    });
  });
});

describe('requireTimeSelection', () => {
  it('passes a complete selection through', () => {
    expect(requireTimeSelection({ range: '0-10' })).toMatchObject({ duration: 10 });
  });

  it('throws when nothing was supplied', () => {
    expect(() => requireTimeSelection({})).toThrow(/Missing time range/);
    expect(() => requireTimeSelection({ start: '10' })).toThrow(CliError);
  });
});

describe('selectionSuffix', () => {
  it('names the artifact after the rounded range', () => {
    expect(selectionSuffix({ start: 80.4, duration: 30.2, hasSelection: true })).toBe('_80s-111s');
  });

  it('is empty when nothing was selected', () => {
    expect(selectionSuffix({ start: 0, duration: 0, hasSelection: false })).toBe('');
  });
});
