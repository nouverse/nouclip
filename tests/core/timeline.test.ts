import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIN_SEGMENT_DURATION,
  type TimelinePlan,
  describeTimeline,
  isSplicePlan,
  parseTimelineManifest,
  parseTimelinePlan,
  planBounds,
  planSelection,
  resolveTimeline,
  shiftSegments,
  subtractWindows,
  timelineSuffix
} from '@/core/selection';
import { CliError } from '@/utils/errors';

const seg = (start: number, end: number, tag?: string) => ({
  start,
  end,
  duration: Number((end - start).toFixed(3)),
  ...(tag ? { tag } : {})
});

describe('parseTimelinePlan', () => {
  it('reads --timeline in the order written, non-linear included', () => {
    const plan = parseTimelinePlan({ timeline: '1:30-1:35 + 0:00-0:15 + 0:25-0:50' });
    expect(plan.segments).toEqual([seg(90, 95), seg(0, 15), seg(25, 50)]);
    expect(plan.skips).toEqual([]);
  });

  it('accepts --ranges as an alias and every list delimiter', () => {
    expect(parseTimelinePlan({ ranges: '1:30-1:35; 0:00-0:15' }).segments).toEqual([
      seg(90, 95),
      seg(0, 15)
    ]);
    expect(parseTimelinePlan({ timeline: '1:30-1:35, 0:00-0:15' }).segments).toHaveLength(2);
  });

  it('reads --skip / --exclude windows next to a single range', () => {
    const plan = parseTimelinePlan({ range: '0:00-2:00', skip: '0:06-0:14, 1:10-1:20' });
    expect(plan.segments).toEqual([seg(0, 120)]);
    expect(plan.skips).toEqual([
      { start: 6, end: 14 },
      { start: 70, end: 80 }
    ]);
    expect(parseTimelinePlan({ exclude: '0:06-0:14' }).skips).toEqual([{ start: 6, end: 14 }]);
  });

  it('turns the single-range flags into a one-segment plan', () => {
    expect(parseTimelinePlan({ start: '1m', duration: '30s' }).segments).toEqual([seg(60, 90)]);
    expect(parseTimelinePlan({})).toEqual({ segments: [], skips: [] });
    expect(parseTimelinePlan({ start: '30' }).segments).toEqual([]);
  });

  it('rejects a timeline combined with the single-range flags or a manifest', () => {
    expect(() => parseTimelinePlan({ timeline: '0-5', range: '0-10' })).toThrow(CliError);
    expect(() => parseTimelinePlan({ timeline: '0-5', duration: '10' })).toThrow(
      /cannot be combined/
    );
    expect(() => parseTimelinePlan({ timeline: '0-5', timelineFile: 'x.json' })).toThrow(
      /either --timeline or --timeline-file/
    );
  });

  it('names the flag in a parse error', () => {
    expect(() => parseTimelinePlan({ timeline: '1:30 + 0-5' })).toThrow(/Invalid --timeline/);
    expect(() => parseTimelinePlan({ range: '0-10', skip: 'junk' })).toThrow(/Invalid --skip/);
  });

  it('reads a --timeline-file manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nouclip-timeline-'));
    try {
      const file = join(dir, 'tracks.json');
      writeFileSync(
        file,
        JSON.stringify([
          { start: '01:30', end: '01:35', tag: 'hook' },
          { start: 0, duration: 6 },
          { start: '14s', end: '50s', tag: 'main_body' }
        ])
      );
      expect(parseTimelinePlan({ timelineFile: file }).segments).toEqual([
        seg(90, 95, 'hook'),
        seg(0, 6),
        seg(14, 50, 'main_body')
      ]);

      writeFileSync(file, '{ not json');
      expect(() => parseTimelinePlan({ timelineFile: file })).toThrow(/Could not read/);
      expect(() => parseTimelinePlan({ timelineFile: join(dir, 'missing.json') })).toThrow(
        /not found/
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('parseTimelineManifest', () => {
  it('accepts a bare array or a { segments } object', () => {
    expect(parseTimelineManifest([{ start: 1, end: 2 }])).toEqual([seg(1, 2)]);
    expect(parseTimelineManifest({ segments: [{ start: 1, end: 2 }] })).toEqual([seg(1, 2)]);
  });

  it('explains what is wrong with a bad entry', () => {
    expect(() => parseTimelineManifest([])).toThrow(/expected a JSON array/);
    expect(() => parseTimelineManifest({ nope: 1 })).toThrow(/expected a JSON array/);
    expect(() => parseTimelineManifest(['1-2'])).toThrow(/segment 1 must be an object/);
    expect(() => parseTimelineManifest([{ end: 2 }])).toThrow(/needs a "start"/);
    expect(() => parseTimelineManifest([{ start: 2 }])).toThrow(/needs an "end"/);
    expect(() => parseTimelineManifest([{ start: 5, end: 2 }])).toThrow(/before it starts/);
    expect(() => parseTimelineManifest([{ start: true, end: 2 }])).toThrow(/timestamp string/);
    expect(() => parseTimelineManifest([{ start: 'soon', end: 2 }])).toThrow(/Could not parse/);
  });
});

describe('isSplicePlan / planSelection / planBounds', () => {
  const single: TimelinePlan = { segments: [seg(10, 40)], skips: [] };
  const multi: TimelinePlan = { segments: [seg(90, 95), seg(0, 15)], skips: [] };
  const skipped: TimelinePlan = { segments: [seg(0, 60)], skips: [{ start: 6, end: 14 }] };

  it('splices for more than one segment or any skip', () => {
    expect(isSplicePlan(single)).toBe(false);
    expect(isSplicePlan(multi)).toBe(true);
    expect(isSplicePlan(skipped)).toBe(true);
    expect(isSplicePlan({ segments: [], skips: [{ start: 1, end: 2 }] })).toBe(true);
  });

  it('exposes a one-segment plan as the classic selection', () => {
    expect(planSelection(single)).toEqual({ start: 10, duration: 30, hasSelection: true });
    expect(planSelection(multi).hasSelection).toBe(false);
    expect(planSelection(skipped).hasSelection).toBe(false);
  });

  it('bounds a plan by its earliest start and latest end', () => {
    expect(planBounds(multi)).toEqual({ start: 0, duration: 95, hasSelection: true });
    expect(planBounds({ segments: [], skips: [] }).hasSelection).toBe(false);
  });
});

describe('subtractWindows', () => {
  it('splits a segment around a window inside it', () => {
    expect(subtractWindows([seg(0, 90, 'body')], [{ start: 6, end: 14 }])).toEqual([
      seg(0, 6, 'body'),
      seg(14, 90, 'body')
    ]);
  });

  it('trims a window overlapping either edge and drops a segment fully covered', () => {
    expect(subtractWindows([seg(10, 20)], [{ start: 5, end: 12 }])).toEqual([seg(12, 20)]);
    expect(subtractWindows([seg(10, 20)], [{ start: 18, end: 25 }])).toEqual([seg(10, 18)]);
    expect(subtractWindows([seg(10, 20)], [{ start: 0, end: 30 }])).toEqual([]);
  });

  it('leaves a segment the window does not touch, and keeps the order', () => {
    expect(subtractWindows([seg(90, 95), seg(0, 15)], [{ start: 20, end: 30 }])).toEqual([
      seg(90, 95),
      seg(0, 15)
    ]);
    expect(subtractWindows([seg(90, 95), seg(0, 15)], [{ start: 5, end: 10 }])).toEqual([
      seg(90, 95),
      seg(0, 5),
      seg(10, 15)
    ]);
  });

  it('applies several windows to one segment', () => {
    expect(
      subtractWindows(
        [seg(0, 120)],
        [
          { start: 6, end: 14 },
          { start: 70, end: 80 }
        ]
      )
    ).toEqual([seg(0, 6), seg(14, 70), seg(80, 120)]);
  });
});

describe('resolveTimeline', () => {
  it('is no selection when nothing was asked for', () => {
    expect(resolveTimeline({ segments: [], skips: [] })).toEqual({
      segments: [],
      totalDuration: 0,
      isMultiSegment: false,
      hasSelection: false
    });
  });

  it('keeps the written order and sums the durations', () => {
    const timeline = resolveTimeline({
      segments: [seg(90, 95), seg(0, 6), seg(14, 50)],
      skips: []
    });
    expect(timeline.segments.map((s) => [s.start, s.end])).toEqual([
      [90, 95],
      [0, 6],
      [14, 50]
    ]);
    expect(timeline.totalDuration).toBe(47);
    expect(timeline.isMultiSegment).toBe(true);
    expect(timeline.hasSelection).toBe(true);
  });

  it('cuts the skip windows out and drops slivers', () => {
    const timeline = resolveTimeline({
      segments: [seg(0, 90)],
      skips: [
        { start: 6, end: 14 },
        { start: 89.95, end: 90 }
      ]
    });
    expect(timeline.segments).toEqual([seg(0, 6), seg(14, 89.95)]);
    expect(timeline.segments.every((s) => s.duration >= MIN_SEGMENT_DURATION)).toBe(true);
  });

  it('is a single segment after skipping when only one piece is left', () => {
    const timeline = resolveTimeline({ segments: [seg(0, 60)], skips: [{ start: 0, end: 10 }] });
    expect(timeline.segments).toEqual([seg(10, 60)]);
    expect(timeline.isMultiSegment).toBe(false);
  });

  it('applies skips alone to the whole media once its length is known', () => {
    expect(() => resolveTimeline({ segments: [], skips: [{ start: 6, end: 14 }] })).toThrow(
      /needs the media length/
    );
    const timeline = resolveTimeline(
      { segments: [], skips: [{ start: 6, end: 14 }] },
      { duration: 30 }
    );
    expect(timeline.segments).toEqual([seg(0, 6), seg(14, 30)]);
  });

  it('shifts into the clock of a downloaded section', () => {
    const timeline = resolveTimeline(
      { segments: [seg(90, 95), seg(60, 75)], skips: [{ start: 62, end: 64 }] },
      { offset: 60, duration: 35 }
    );
    expect(timeline.segments).toEqual([seg(30, 35), seg(0, 2), seg(4, 15)]);
    expect(shiftSegments(timeline.segments, 60)).toEqual([seg(90, 95), seg(60, 62), seg(64, 75)]);
    expect(shiftSegments(timeline.segments, 0)).toBe(timeline.segments);
  });

  it('clamps a segment running past the media and rejects one starting after it', () => {
    const timeline = resolveTimeline(
      { segments: [seg(50, 70), seg(0, 5)], skips: [] },
      { duration: 60 }
    );
    expect(timeline.segments).toEqual([seg(50, 60), seg(0, 5)]);
    expect(timeline.totalDuration).toBe(15);
    expect(() =>
      resolveTimeline({ segments: [seg(90, 95), seg(0, 5)], skips: [] }, { duration: 60 })
    ).toThrow(/starts after the media ends/);
  });

  it('refuses a timeline with nothing left in it', () => {
    expect(() =>
      resolveTimeline({ segments: [seg(0, 10)], skips: [{ start: 0, end: 10 }] })
    ).toThrow(/Nothing left to keep/);
    expect(() => resolveTimeline({ segments: [seg(0, 0.05)], skips: [] })).toThrow(CliError);
  });
});

describe('timelineSuffix & describeTimeline', () => {
  it('names a one-segment timeline like a plain range', () => {
    expect(timelineSuffix([seg(80.4, 110.6)])).toBe('_80s-111s');
    expect(timelineSuffix([])).toBe('');
  });

  it('joins segments with + and counts the rest past three', () => {
    expect(timelineSuffix([seg(90, 95), seg(0, 6), seg(14, 50)])).toBe('_90s-95s+0s-6s+14s-50s');
    expect(timelineSuffix([seg(0, 1), seg(2, 3), seg(4, 5), seg(6, 7), seg(8, 9)])).toBe(
      '_0s-1s+2s-3s+4s-5s+2more'
    );
  });

  it('describes each segment with its times, length and tag', () => {
    expect(describeTimeline([seg(90, 95, 'hook'), seg(0, 6)])).toEqual([
      '1. 01:30 -> 01:35 (5.0s) hook',
      '2. 00:00 -> 00:06 (6.0s)'
    ]);
  });
});
