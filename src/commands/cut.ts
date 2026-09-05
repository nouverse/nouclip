import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { type TimeSelectionOptions, requireTimeSelection } from '@/core/selection';
import { CliError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';
import { formatSecondsToTimestamp } from '@/utils/time';

export interface CutCommandOptions extends TimeSelectionOptions {
  output?: string;
  reencode?: boolean;
}

export async function cutCommand(videoPath: string, options: CutCommandOptions = {}) {
  config.ensureDirs();

  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    throw new CliError(`Input file not found: ${videoPath} (Checked: ${input})`);
  }

  const { start, duration } = requireTimeSelection(options);

  const baseName = basename(input, extname(input));
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
