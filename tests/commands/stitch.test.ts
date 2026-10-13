import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stitchCommand } from '@/commands/stitch';
import { FFmpegRunner } from '@/core/ffmpeg';
import { CliError } from '@/utils/errors';

/**
 * ffmpeg is mocked: these tests pin what `stitch` asks of it and what it writes next to the
 * video, not the encoding itself (`tests/e2e/pipeline.test.ts` covers a real splice).
 */
const DIR_KEYS = [
  'NOUCLIP_WORKSPACE_DIR',
  'NOUCLIP_DOWNLOAD_DIR',
  'NOUCLIP_TRANSCRIPT_DIR',
  'NOUCLIP_SEGMENT_DIR',
  'NOUCLIP_OUTPUT_DIR'
];
const saved = new Map(DIR_KEYS.map((key) => [key, process.env[key]]));

let dir: string;
let video: string;
let transcript: string;

const sourceWords = Array.from({ length: 100 }, (_, i) => ({
  word: `w${i}`,
  start: i,
  end: i + 0.8
}));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'nouclip-stitch-'));
  process.env.NOUCLIP_WORKSPACE_DIR = dir;
  process.env.NOUCLIP_DOWNLOAD_DIR = join(dir, 'downloads');
  process.env.NOUCLIP_TRANSCRIPT_DIR = join(dir, 'transcripts');
  process.env.NOUCLIP_SEGMENT_DIR = join(dir, 'segments');
  process.env.NOUCLIP_OUTPUT_DIR = join(dir, 'output');

  video = join(dir, 'podcast.mp4');
  writeFileSync(video, 'not really a video');
  transcript = join(dir, 'podcast.whisper.json');
  writeFileSync(transcript, JSON.stringify({ language: 'id', words: sourceWords }));
});

afterAll(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  // Restore the real FFmpegRunner between tests.
  (FFmpegRunner.getMetadata as unknown as { mockRestore?: () => void }).mockRestore?.();
  (FFmpegRunner.spliceTimeline as unknown as { mockRestore?: () => void }).mockRestore?.();
});

function mockFFmpeg(duration = 100, hasAudio = true) {
  const metadata = spyOn(FFmpegRunner, 'getMetadata').mockResolvedValue({
    duration,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio
  });
  const splice = spyOn(FFmpegRunner, 'spliceTimeline').mockResolvedValue(undefined);
  return { metadata, splice };
}

describe('stitch command', () => {
  it('splices the timeline in order and re-times the words onto it', async () => {
    const { splice } = mockFFmpeg();
    const output = join(dir, 'hook-first.mp4');
    const outputSubtitles = join(dir, 'hook-first.json');

    await stitchCommand(video, {
      timeline: '1:30-1:35 + 0:00-0:06 + 0:14-0:50',
      subtitles: transcript,
      output,
      outputSubtitles
    });

    expect(splice).toHaveBeenCalledTimes(1);
    const [input, out, segments, options] = splice.mock.calls[0];
    expect(input).toBe(video);
    expect(out).toBe(output);
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [90, 95],
      [0, 6],
      [14, 50]
    ]);
    expect(options).toEqual({ hasAudio: true });

    const written = JSON.parse(readFileSync(outputSubtitles, 'utf-8'));
    expect(written.source).toBe('stitch');
    expect(written.language).toBe('id');
    expect(written.duration).toBe(47);
    expect(written.sourceTranscript).toBe(transcript);
    expect(written.timeline.map((s: { start: number }) => s.start)).toEqual([90, 0, 14]);
    expect(written.words[0]).toMatchObject({ word: 'w90', start: 0, end: 0.8, segment: 0 });
    expect(written.words.find((w: { word: string }) => w.word === 'w0')).toMatchObject({
      start: 5,
      segment: 1
    });
    expect(written.words.at(-1)).toMatchObject({ word: 'w49', end: 46.8, segment: 2 });
    expect(written.text.startsWith('w90 w91')).toBe(true);
  });

  it('names its outputs after the timeline and keeps the transcript beside the others', async () => {
    const { splice } = mockFFmpeg();

    await stitchCommand(video, { range: '0:00-1:00', skip: '0:06-0:14', subtitles: transcript });

    const out = splice.mock.calls[0][1];
    expect(out).toBe(join(dir, 'segments', 'podcast_stitched_0s-6s+14s-60s.mp4'));
    expect(
      existsSync(join(dir, 'transcripts', 'podcast_stitched_0s-6s+14s-60s.whisper.json'))
    ).toBe(true);
  });

  it('clamps the timeline to the probed media and passes along a missing audio track', async () => {
    const { splice } = mockFFmpeg(30, false);

    await stitchCommand(video, { timeline: '20-40 + 0-5' });

    const [, , segments, options] = splice.mock.calls[0];
    expect(segments.map((s) => [s.start, s.end])).toEqual([
      [20, 30],
      [0, 5]
    ]);
    expect(options).toEqual({ hasAudio: false });
  });

  it('refuses to run without a timeline, and never touches ffmpeg when it does', async () => {
    const { metadata, splice } = mockFFmpeg();
    await expect(stitchCommand(video, {})).rejects.toThrow(/Nothing to stitch/);
    await expect(stitchCommand(video, { output: 'x.mp4' })).rejects.toBeInstanceOf(CliError);
    expect(metadata).not.toHaveBeenCalled();
    expect(splice).not.toHaveBeenCalled();
  });

  it('validates the subtitles JSON before encoding anything', async () => {
    const { splice } = mockFFmpeg();
    const empty = join(dir, 'empty.json');
    writeFileSync(empty, JSON.stringify({ words: [] }));

    await expect(
      stitchCommand(video, { timeline: '0-5 + 10-15', subtitles: empty })
    ).rejects.toThrow(/No words found/);
    await expect(
      stitchCommand(video, { timeline: '0-5 + 10-15', subtitles: join(dir, 'missing.json') })
    ).rejects.toThrow(/not found/);
    await expect(
      stitchCommand(video, { timeline: '0-5 + 10-15', subtitles: video })
    ).rejects.toThrow(/must be a word timestamps JSON/);
    await expect(
      stitchCommand(video, { timeline: '0-5 + 10-15', outputSubtitles: 'out.json' })
    ).rejects.toThrow(/needs --subtitles/);
    expect(splice).not.toHaveBeenCalled();
  });

  it('reports a missing input before anything else', async () => {
    await expect(stitchCommand(join(dir, 'nope.mp4'), { timeline: '0-5 + 6-7' })).rejects.toThrow(
      /Input file not found/
    );
  });
});
