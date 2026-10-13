import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CliError, getErrorMessage } from '@/utils/errors';
import { formatSecondsToTimestamp, parseRange, parseRangeList, parseTimestamp } from '@/utils/time';

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

export const NO_SELECTION: TimeSelection = { start: 0, duration: 0, hasSelection: false };

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

// ---------------------------------------------------------------------------
// Timelines: several ranges spliced in the order written, minus skip windows.
// ---------------------------------------------------------------------------

/**
 * The timeline flags `auto`, `cut` and `stitch` take on top of the single-range ones.
 *
 * A short-form edit is rarely one continuous range: the hook comes from deep in the video,
 * then the setup from the start, and the channel bumper in between is cut out. `--timeline`
 * lists the segments in the order they should play; `--skip` names windows to cut out of
 * whatever was selected.
 */
export interface TimelineOptions extends TimeSelectionOptions {
  /** `--timeline "1:30-1:35 + 0:00-0:15 + 0:25-0:50"`, in output order. */
  timeline?: string;
  /** `--ranges`, an alias of `--timeline`. */
  ranges?: string;
  /** `--timeline-file tracks.json`: `[{ "start": "01:30", "end": "01:35", "tag": "hook" }]`. */
  timelineFile?: string;
  /** `--skip "0:06-0:14, 1:10-1:20"`: windows to cut out. */
  skip?: string;
  /** `--exclude`, an alias of `--skip`. */
  exclude?: string;
}

export interface TimeWindow {
  start: number;
  end: number;
}

export interface TimelineSegment extends TimeWindow {
  duration: number;
  /** A label from the manifest (`hook`, `main_body`), for logs and provenance only. */
  tag?: string;
}

/** What the flags asked for, before the media is known. */
export interface TimelinePlan {
  /** Ranges to keep, in output order. Empty means the whole media — only `skips` then apply. */
  segments: TimelineSegment[];
  /** Windows to cut out of `segments`. */
  skips: TimeWindow[];
}

export interface ResolvedTimeline {
  /** What to splice, in output order, after the skips — in the media's own clock. */
  segments: TimelineSegment[];
  totalDuration: number;
  isMultiSegment: boolean;
  /** False when no time flag was given at all: the media is used untouched. */
  hasSelection: boolean;
}

export interface TimelineMedia {
  /** The media's length in seconds. Segments are clamped to it; one starting past it is an error. */
  duration?: number;
  /**
   * Where the media's clock starts, in the timeline's coordinates — a section downloaded from
   * `offset` onwards has its own zero there, so every time is shifted back by this much.
   */
  offset?: number;
}

/** A leftover shorter than this after skipping is a sliver at a cut, not content. */
export const MIN_SEGMENT_DURATION = 0.1;

const round3 = (n: number) => Number(n.toFixed(3));

function makeSegment(start: number, end: number, tag?: string): TimelineSegment {
  return {
    start: round3(start),
    end: round3(end),
    duration: round3(end - start),
    ...(tag ? { tag } : {})
  };
}

/**
 * Reads every time flag into a plan: the segments to keep, in order, and the windows to skip.
 *
 * `--timeline` / `--timeline-file` and the single-range flags describe the same thing two ways,
 * so combining them is rejected rather than guessed at.
 */
export function parseTimelinePlan(options: TimelineOptions = {}): TimelinePlan {
  const timelineText = options.timeline ?? options.ranges;
  const skipText = options.skip ?? options.exclude;
  const hasSingleRangeFlags = Boolean(
    options.range || options.start || options.from || options.end || options.to || options.duration
  );

  if (timelineText && options.timelineFile) {
    throw new CliError('Pass either --timeline or --timeline-file, not both.');
  }
  if ((timelineText || options.timelineFile) && hasSingleRangeFlags) {
    throw new CliError(
      '--timeline cannot be combined with --range/--start/--end/--duration: list every range in the timeline instead.'
    );
  }

  let segments: TimelineSegment[];
  if (timelineText) {
    segments = parseRanges(timelineText, '--timeline').map((r) =>
      makeSegment(r.start, r.end as number)
    );
  } else if (options.timelineFile) {
    segments = readTimelineFile(options.timelineFile);
  } else {
    const selection = resolveTimeSelection(options);
    segments = selection.hasSelection
      ? [makeSegment(selection.start, selection.start + selection.duration)]
      : [];
  }

  const skips = skipText
    ? parseRanges(skipText, '--skip').map((r) => ({ start: r.start, end: r.end as number }))
    : [];

  return { segments, skips };
}

function parseRanges(text: string, flag: string) {
  try {
    return parseRangeList(text);
  } catch (err) {
    throw new CliError(`Invalid ${flag}: ${getErrorMessage(err)}`);
  }
}

function readTimelineFile(file: string): TimelineSegment[] {
  const path = resolve(file);
  if (!existsSync(path)) throw new CliError(`Timeline file not found: ${file}`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new CliError(`Could not read timeline file ${file}: ${getErrorMessage(err)}`);
  }
  return parseTimelineManifest(raw, file);
}

/**
 * A timeline manifest: `[{ "start", "end" | "duration", "tag"? }, ...]`, or the same list under
 * a `segments` key. Times are anything {@link parseTimestamp} reads — `"01:30"`, `"90s"`, `90`.
 */
export function parseTimelineManifest(
  raw: unknown,
  source = 'timeline manifest'
): TimelineSegment[] {
  const list = Array.isArray(raw) ? raw : (raw as { segments?: unknown } | null)?.segments;
  if (!Array.isArray(list) || list.length === 0) {
    throw new CliError(
      `${source}: expected a JSON array of segments like [{ "start": "01:30", "end": "01:35" }].`
    );
  }

  return list.map((entry, index) => {
    const where = `${source}: segment ${index + 1}`;
    if (!entry || typeof entry !== 'object') {
      throw new CliError(`${where} must be an object with "start" and "end".`);
    }
    const item = entry as { start?: unknown; end?: unknown; duration?: unknown; tag?: unknown };
    if (item.start === undefined) throw new CliError(`${where} needs a "start".`);

    const start = manifestTime(item.start, `${where} "start"`);
    let end: number;
    if (item.end !== undefined) {
      end = manifestTime(item.end, `${where} "end"`);
    } else if (item.duration !== undefined) {
      end = start + manifestTime(item.duration, `${where} "duration"`);
    } else {
      throw new CliError(`${where} needs an "end" (or a "duration").`);
    }
    if (end <= start) {
      throw new CliError(
        `${where} ends (${String(item.end)}) before it starts (${String(item.start)}).`
      );
    }
    return makeSegment(start, end, typeof item.tag === 'string' ? item.tag.trim() : undefined);
  });
}

function manifestTime(value: unknown, what: string): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new CliError(`${what} must be a timestamp string or a number of seconds.`);
  }
  try {
    return parseTimestamp(value);
  } catch (err) {
    throw new CliError(`${what}: ${getErrorMessage(err)}`);
  }
}

/** True when the plan needs splicing: more than one segment, or windows to cut out. */
export function isSplicePlan(plan: TimelinePlan): boolean {
  return plan.skips.length > 0 || plan.segments.length > 1;
}

/** The one range a plan describes, for the single-range paths; no selection for a timeline. */
export function planSelection(plan: TimelinePlan): TimeSelection {
  if (plan.segments.length !== 1 || plan.skips.length > 0) return NO_SELECTION;
  const [segment] = plan.segments;
  return { start: segment.start, duration: segment.duration, hasSelection: true };
}

/**
 * The one window spanning every segment of a plan — what to download for a timeline, so the
 * splice reads a short section instead of the whole video. No selection when the plan has no
 * segments (skips alone apply to the whole media).
 */
export function planBounds(plan: TimelinePlan): TimeSelection {
  if (plan.segments.length === 0) return NO_SELECTION;
  const start = Math.min(...plan.segments.map((s) => s.start));
  const end = Math.max(...plan.segments.map((s) => s.end));
  return { start, duration: round3(end - start), hasSelection: true };
}

/**
 * Cuts `skips` out of `segments`, keeping the order and splitting a segment a window lands
 * inside. Segments do not need to be sorted or disjoint: a replayed hook overlaps on purpose.
 */
export function subtractWindows(
  segments: TimelineSegment[],
  skips: TimeWindow[]
): TimelineSegment[] {
  const kept: TimelineSegment[] = [];

  for (const segment of segments) {
    let pieces: TimelineSegment[] = [segment];
    for (const skip of skips) {
      const next: TimelineSegment[] = [];
      for (const piece of pieces) {
        if (skip.end <= piece.start || skip.start >= piece.end) {
          next.push(piece);
          continue;
        }
        if (skip.start > piece.start) next.push(makeSegment(piece.start, skip.start, piece.tag));
        if (skip.end < piece.end) next.push(makeSegment(skip.end, piece.end, piece.tag));
      }
      pieces = next;
    }
    kept.push(...pieces);
  }

  return kept;
}

/**
 * Turns a plan into the segments to splice, in the media's own clock:
 * shifted by `media.offset`, minus the skip windows, clamped to `media.duration`,
 * and without slivers shorter than {@link MIN_SEGMENT_DURATION}.
 */
export function resolveTimeline(plan: TimelinePlan, media: TimelineMedia = {}): ResolvedTimeline {
  if (plan.segments.length === 0 && plan.skips.length === 0) {
    return { segments: [], totalDuration: 0, isMultiSegment: false, hasSelection: false };
  }

  const offset = media.offset ?? 0;
  const knownDuration = media.duration !== undefined && media.duration > 0;

  let base: TimelineSegment[];
  if (plan.segments.length > 0) {
    base = plan.segments.map((s) => makeSegment(s.start - offset, s.end - offset, s.tag));
  } else {
    if (!knownDuration) {
      throw new CliError(
        '--skip on its own needs the media length to cut from; give --range or --timeline as well.'
      );
    }
    base = [makeSegment(0, media.duration as number)];
  }

  const skips = plan.skips.map((w) => ({ start: w.start - offset, end: w.end - offset }));
  let segments = subtractWindows(base, skips);

  if (knownDuration) {
    const duration = media.duration as number;
    segments = segments.map((s) => {
      if (s.start >= duration) {
        throw new CliError(
          `Segment ${describeWindow(s, offset)} starts after the media ends (${formatSecondsToTimestamp(duration)}).`
        );
      }
      return s.end > duration ? makeSegment(s.start, duration, s.tag) : s;
    });
  }

  segments = segments.filter((s) => s.duration >= MIN_SEGMENT_DURATION);
  if (segments.length === 0) {
    throw new CliError(
      `Nothing left to keep: every segment is shorter than ${MIN_SEGMENT_DURATION}s or covered by --skip.`
    );
  }

  return {
    segments,
    totalDuration: round3(segments.reduce((sum, s) => sum + s.duration, 0)),
    isMultiSegment: segments.length > 1,
    hasSelection: true
  };
}

/** The same segments `delta` seconds later — back into the source's clock after an offset. */
export function shiftSegments(segments: TimelineSegment[], delta: number): TimelineSegment[] {
  if (delta === 0) return segments;
  return segments.map((s) => makeSegment(s.start + delta, s.end + delta, s.tag));
}

/**
 * Suffix naming artifacts made from a timeline, e.g. `_90s-95s+0s-6s+14s-50s`. One segment
 * gives the same `_80s-110s` as {@link selectionSuffix}; past three, the rest are counted.
 */
export function timelineSuffix(segments: TimelineSegment[]): string {
  if (segments.length === 0) return '';
  const label = (s: TimelineSegment) => `${Math.round(s.start)}s-${Math.round(s.end)}s`;
  const shown = segments.slice(0, 3).map(label);
  const rest = segments.length - shown.length;
  return `_${shown.join('+')}${rest > 0 ? `+${rest}more` : ''}`;
}

function describeWindow(window: TimeWindow, offset = 0): string {
  return `${formatSecondsToTimestamp(window.start + offset)}-${formatSecondsToTimestamp(window.end + offset)}`;
}

/** One log line per segment: `1. 01:30 -> 01:35 (5.0s) hook`. */
export function describeTimeline(segments: TimelineSegment[]): string[] {
  return segments.map(
    (s, i) =>
      `${i + 1}. ${formatSecondsToTimestamp(s.start)} -> ${formatSecondsToTimestamp(s.end)} (${s.duration.toFixed(1)}s)${s.tag ? ` ${s.tag}` : ''}`
  );
}
