import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import {
  type TimelineOptions,
  type TimelineSegment,
  describeTimeline,
  parseTimelinePlan,
  resolveTimeline,
  timelineSuffix
} from '@/core/selection';
import { remapTimelineWordTimestamps } from '@/core/transcript';
import { CliError, getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export interface StitchCommandOptions extends TimelineOptions {
  output?: string;
  /** Word timestamps JSON of the source video, to re-time onto the stitched clip. */
  subtitles?: string;
  outputSubtitles?: string;
}

/** What `stitch` writes next to the words it re-timed, so the file explains itself. */
export interface StitchedTranscript {
  language?: string;
  duration: number;
  text: string;
  words: WordTimestamp[];
  source: 'stitch';
  /** The transcript the words were re-timed from. */
  sourceTranscript: string;
  /** The segments spliced, in the source video's clock and in output order. */
  timeline: TimelineSegment[];
}

/**
 * Splices segments of one video into one clip, in the order given, and re-times its existing
 * word timestamps to match — the primitive under `auto --timeline`, for pipelines that cut,
 * subtitle and burn as separate steps.
 */
export async function stitchCommand(videoPath: string, options: StitchCommandOptions = {}) {
  config.ensureDirs();

  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    throw new CliError(`Input file not found: ${videoPath} (Checked: ${input})`);
  }
  if (options.outputSubtitles && !options.subtitles) {
    throw new CliError('--output-subtitles needs --subtitles <words.json> to re-time.');
  }

  const plan = parseTimelinePlan(options);
  if (plan.segments.length === 0 && plan.skips.length === 0) {
    throw new CliError(
      'Nothing to stitch. Give --timeline "1:30-1:35 + 0:00-0:15", --timeline-file <json>, or --range with --skip.'
    );
  }

  // The words are read before any encoding, so a bad JSON fails fast.
  const source = options.subtitles ? readSourceTranscript(options.subtitles) : undefined;

  const meta = await FFmpegRunner.getMetadata(input);
  const { segments, totalDuration } = resolveTimeline(plan, { duration: meta.duration });

  const baseName = basename(input, extname(input));
  const output = options.output
    ? resolve(options.output)
    : join(config.segmentDir, `${baseName}_stitched${timelineSuffix(segments)}.mp4`);

  logger.info(
    `Stitching ${segments.length} segment${segments.length === 1 ? '' : 's'} (${totalDuration.toFixed(1)}s) from ${input}`
  );
  for (const line of describeTimeline(segments)) logger.info(`  ${line}`);

  await FFmpegRunner.spliceTimeline(input, output, segments, { hasAudio: meta.hasAudio });
  logger.success(`Stitched video: ${output}`);

  if (!source) return;

  const words = remapTimelineWordTimestamps(source.words, segments);
  if (words.length === 0) {
    logger.warn(
      `None of the ${source.words.length} words in ${source.path} fall inside the stitched segments; writing an empty transcript.`
    );
  }

  const outputSubtitles = options.outputSubtitles
    ? resolve(options.outputSubtitles)
    : join(config.transcriptDir, `${basename(output, extname(output))}.whisper.json`);

  const stitched: StitchedTranscript = {
    ...(source.language ? { language: source.language } : {}),
    duration: totalDuration,
    text: words.map((w) => w.word.trim()).join(' '),
    words,
    source: 'stitch',
    sourceTranscript: source.path,
    timeline: segments
  };
  writeFileSync(outputSubtitles, JSON.stringify(stitched, null, 2), 'utf-8');
  logger.success(`Subtitles re-timed: ${words.length} words -> ${outputSubtitles}`);

  console.log('');
  console.log('Burn them with:');
  console.log(`👉 nouclip subtitle "${output}" --sub "${outputSubtitles}"`);
}

interface SourceTranscript {
  path: string;
  words: WordTimestamp[];
  language?: string;
}

/** Reads `{ words: [...] }` timed against the source video — a `.whisper.json` or the like. */
function readSourceTranscript(file: string): SourceTranscript {
  const path = resolveMediaInput(file);
  if (!existsSync(path)) {
    throw new CliError(`Subtitles JSON not found: ${file} (Checked: ${path})`);
  }
  if (extname(path).toLowerCase() !== '.json') {
    throw new CliError(
      `--subtitles must be a word timestamps JSON (e.g. a .whisper.json), got: ${file}`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new CliError(`Could not read subtitles JSON ${file}: ${getErrorMessage(err)}`);
  }

  const data = (raw ?? {}) as { words?: unknown; language?: unknown };
  const words = Array.isArray(data.words)
    ? (data.words as WordTimestamp[]).filter(
        (w) => typeof w?.word === 'string' && Number.isFinite(w.start) && Number.isFinite(w.end)
      )
    : [];
  if (words.length === 0) {
    throw new CliError(`No words found in subtitles JSON: ${file}`);
  }

  return {
    path,
    words,
    ...(typeof data.language === 'string' ? { language: data.language } : {})
  };
}
