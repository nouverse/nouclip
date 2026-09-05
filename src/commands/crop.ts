import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { resolveFramingMode } from '@/commands/framing';
import { config } from '@/core/config';
import { FFmpegRunner, type FramingMode } from '@/core/ffmpeg';
import { CliError } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export interface CropCommandOptions {
  aspect?: string;
  mode?: string;
  blur?: boolean;
  center?: boolean;
  output?: string;
}

export async function cropCommand(videoPath: string, options: CropCommandOptions = {}) {
  config.ensureDirs();

  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    throw new CliError(`Input file not found: ${videoPath} (Checked: ${input})`);
  }

  const aspectStr = options.aspect || '9:16';
  const mode: FramingMode = resolveFramingMode(options);
  const preset = FFmpegRunner.parseAspectRatio(aspectStr);
  const baseName = basename(input, extname(input));

  const output = options.output
    ? resolve(options.output)
    : join(config.segmentDir, `${baseName}_${FFmpegRunner.aspectSlug(preset)}_${mode}.mp4`);

  logger.info(
    `Reframing video to ${preset.name} (${preset.width}x${preset.height}, mode=${mode})...`
  );

  await FFmpegRunner.reframe(input, output, { aspect: aspectStr, mode });
  logger.success(`Framed video ready: ${output}`);
}
