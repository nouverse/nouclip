import { CliError } from '@/utils/errors';
import { parseRange, parseTimestamp } from '@/utils/time';

/**
 * Shared time-selection flags. `auto`, `cut` and `extract` all accept the same
 * vocabulary, so the resolution rules live here instead of being re-implemented
 * (and drifting) in each command.
 */
export interface TimeSelectionOptions {
  range?: string;
  start?: string;
  from?: string;
  end?: string;
  to?: string;
  duration?: string;
}

export interface TimeSelection {
  start: number;
  duration: number;
  /** True when the flags describe an actual sub-range of the source media. */
  hasSelection: boolean;
}

const NO_SELECTION: TimeSelection = { start: 0, duration: 0, hasSelection: false };

/**
 * Resolves `--range` / `--start` / `--end` / `--duration` into `{ start, duration }`.
 * Returns `hasSelection: false` when no time flags were supplied at all.
 */
export function resolveTimeSelection(options: TimeSelectionOptions = {}): TimeSelection {
  const { range, start, from, end, to, duration } = options;

  if (range) {
    const parsed = parseRange(range);
    return { start: parsed.start, duration: parsed.duration, hasSelection: parsed.duration > 0 };
  }

  if (!start && !from && !end && !to && !duration) {
    return NO_SELECTION;
  }

  const startSec = parseTimestamp(start ?? from);

  if (duration) {
    const durSec = parseTimestamp(duration);
    if (durSec <= 0) {
      throw new CliError(`Invalid duration "${duration}": must be greater than 0.`);
    }
    return { start: startSec, duration: durSec, hasSelection: true };
  }

  const endValue = end ?? to;
  if (endValue) {
    const endSec = parseTimestamp(endValue);
    if (endSec <= startSec) {
      throw new CliError(
        `Invalid range: end (${endValue}) must be after start (${start ?? from ?? '0'}).`
      );
    }
    return { start: startSec, duration: endSec - startSec, hasSelection: true };
  }

  // Only a start was given — nothing to cut without an end or duration.
  return { start: startSec, duration: 0, hasSelection: false };
}

/** Same as {@link resolveTimeSelection}, but rejects a missing/incomplete range. */
export function requireTimeSelection(options: TimeSelectionOptions = {}): TimeSelection {
  const selection = resolveTimeSelection(options);
  if (!selection.hasSelection) {
    throw new CliError(
      'Missing time range. Provide --range "MM:SS-MM:SS", or --start with --end/--duration.'
    );
  }
  return selection;
}

/** Suffix used to name artifacts derived from a sub-range, e.g. `_80s-110s`. */
export function selectionSuffix(selection: TimeSelection): string {
  if (!selection.hasSelection) return '';
  const start = Math.round(selection.start);
  const end = Math.round(selection.start + selection.duration);
  return `_${start}s-${end}s`;
}
