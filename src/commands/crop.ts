import { existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { config } from '@/core/config';
import { FFmpegRunner, type FramingMode } from '@/core/ffmpeg';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export async function cropCommand(
  videoPath: string,
  options: {
    aspect?: string;
    mode?: FramingMode;
    blur?: boolean;
    output?: string;
  }
) {
  config.ensureDirs();
  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    logger.error(`Input file not found: ${videoPath} (Checked: ${input})`);
    process.exit(1);
  }

  const aspectStr = options.aspect || '9:16';
  const mode: FramingMode = options.blur ? 'blur' : options.mode || 'center';
  const preset = FFmpegRunner.parseAspectRatio(aspectStr);
  const baseName = basename(input, extname(input));

  const output = options.output
    ? resolve(options.output)
    : join(config.segmentDir, `${baseName}_${preset.name.replace(':', 'x')}_${mode}.mp4`);

  logger.info(
    `Reframing video to ${preset.name} (${preset.width}x${preset.height}, mode=${mode})...`
  );

  try {
    await FFmpegRunner.reframe(input, output, {
      aspect: aspectStr,
      mode
    });
    logger.success(`Framed video ready: ${output}`);
  } catch (err: any) {
    logger.error(`Crop/Reframe failed: ${err.message}`);
    process.exit(1);
  }
}
