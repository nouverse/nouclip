import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { logger } from '@/utils/logger';
import { formatSecondsToTimestamp, parseRange, parseTimestamp } from '@/utils/time';

export async function cutCommand(
  videoPath: string,
  options: {
    range?: string;
    start?: string;
    from?: string;
    end?: string;
    to?: string;
    duration?: string;
    output?: string;
    reencode?: boolean;
  }
) {
  config.ensureDirs();
  const input = resolve(videoPath);
  if (!existsSync(input)) {
    logger.error(`Input file not found: ${input}`);
    process.exit(1);
  }

  let startSec = 0;
  let durSec = 0;

  if (options.range) {
    const parsed = parseRange(options.range);
    startSec = parsed.start;
    durSec = parsed.duration;
  } else if (options.start || options.from) {
    startSec = parseTimestamp(options.start || options.from);
    if (options.duration) {
      durSec = parseTimestamp(options.duration);
    } else if (options.end || options.to) {
      durSec = parseTimestamp(options.end || options.to) - startSec;
    } else {
      logger.error('Must provide --end/--to, --duration, or use --range "MM:SS-MM:SS"');
      process.exit(1);
    }
  } else {
    logger.error('Must provide --range, --start/--from, or timestamp options');
    process.exit(1);
  }

  const baseName = basename(input, extname(input));
  const output = options.output
    ? resolve(options.output)
    : join(
        config.segmentDir,
        `${baseName}_cut_${Math.round(startSec)}s-${Math.round(startSec + durSec)}s.mp4`
      );

  logger.info(
    `Cutting segment: ${formatSecondsToTimestamp(startSec)} -> ${formatSecondsToTimestamp(startSec + durSec)} (${Math.round(durSec)}s)...`
  );

  try {
    await FFmpegRunner.cutVideo(input, output, startSec, durSec, options.reencode || false);
    logger.success(`Video clipped: ${output}`);
  } catch (err: any) {
    logger.error(`Cut failed: ${err.message}`);
    process.exit(1);
  }
}
