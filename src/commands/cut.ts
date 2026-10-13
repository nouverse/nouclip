import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import {
  type TimelineOptions,
  describeTimeline,
  isSplicePlan,
  parseTimelinePlan,
  planSelection,
  resolveTimeline,
  timelineSuffix
} from '@/core/selection';
import { CliError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
import { formatSecondsToTimestamp } from '@/utils/time';

export interface CutCommandOptions extends TimelineOptions {
  output?: string;
  reencode?: boolean;
}

export async function cutCommand(videoPath: string, options: CutCommandOptions = {}) {
  config.ensureDirs();

  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    throw new CliError(`Input file not found: ${videoPath} (Checked: ${input})`);
  }

  const plan = parseTimelinePlan(options);
  const baseName = basename(input, extname(input));

  // Several segments, or windows to skip: spliced in one re-encoding pass (a frame-accurate
  // cut cannot be stream-copied, so --reencode is implied).
  if (isSplicePlan(plan)) {
    const meta = await FFmpegRunner.getMetadata(input);
    const { segments, totalDuration } = resolveTimeline(plan, { duration: meta.duration });
    const output = options.output
      ? resolve(options.output)
      : join(config.segmentDir, `${baseName}_cut${timelineSuffix(segments)}.mp4`);

    logger.info(
      `Splicing ${segments.length} segment${segments.length === 1 ? '' : 's'} (${totalDuration.toFixed(1)}s, re-encoded)...`
    );
    for (const line of describeTimeline(segments)) logger.info(`  ${line}`);

    await FFmpegRunner.spliceTimeline(input, output, segments, { hasAudio: meta.hasAudio });
    logger.success(`Video spliced: ${output}`);
    return;
  }

  const selection = planSelection(plan);
  if (!selection.hasSelection) {
    throw new CliError(
      'Missing time range. Provide --range "MM:SS-MM:SS", --timeline "A-B + C-D", or --start with --end/--duration.'
    );
  }
  const { start, duration } = selection;

  const output = options.output
    ? resolve(options.output)
    : join(
        config.segmentDir,
        `${baseName}_cut_${Math.round(start)}s-${Math.round(start + duration)}s.mp4`
      );

  logger.info(
    `Cutting segment: ${formatSecondsToTimestamp(start)} -> ${formatSecondsToTimestamp(start + duration)} (${Math.round(duration)}s)...`
  );

  await FFmpegRunner.cutVideo(input, output, start, duration, options.reencode || false);
  logger.success(`Video clipped: ${output}`);
}
