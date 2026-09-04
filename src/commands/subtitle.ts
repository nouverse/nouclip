import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { ASSGenerator, type WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { logger } from '@/utils/logger';

export async function subtitleCommand(
  videoPath: string,
  options: {
    timestamps?: string;
    sub?: string;
    fontSize?: string;
    primaryColor?: string;
    highlightColor?: string;
    output?: string;
  }
) {
  config.ensureDirs();
  const input = resolve(videoPath);
  if (!existsSync(input)) {
    logger.error(`Video file not found: ${input}`);
    process.exit(1);
  }

  const subInput = options.sub || options.timestamps;
  if (!subInput) {
    logger.error(
      'Must provide subtitle file via --sub <file.ass|file.json> or --timestamps <file.json>'
    );
    process.exit(1);
  }

  const subPath = resolve(subInput);
  if (!existsSync(subPath)) {
    logger.error(`Subtitle file not found: ${subPath}`);
    process.exit(1);
  }

  const baseName = basename(input, extname(input));
  let burnAssPath = subPath;

  // If provided a JSON timestamps file, compile it to ASS
  if (subPath.endsWith('.json')) {
    logger.info(`Compiling word timestamps from ${subPath} into ASS styling...`);
    const rawJson = JSON.parse(readFileSync(subPath, 'utf-8'));
    const words: WordTimestamp[] = rawJson.words || [];

    if (words.length === 0) {
      logger.error('No words found in timestamps JSON.');
      process.exit(1);
    }

    const assContent = ASSGenerator.generateKineticASS(words, {
      fontSize: options.fontSize ? Number.parseInt(options.fontSize, 10) : 60,
      primaryColor: options.primaryColor,
      highlightColor: options.highlightColor
    });

    burnAssPath = join(config.transcriptDir, `${baseName}.kinetic.ass`);
    writeFileSync(burnAssPath, assContent, 'utf-8');
    logger.success(`Generated kinetic subtitle ASS: ${burnAssPath}`);
  }

  const output = options.output
    ? resolve(options.output)
    : join(config.outputDir, `${baseName}_subtitled.mp4`);

  logger.info(`Burning subtitle (${burnAssPath}) into ${output}...`);

  try {
    await FFmpegRunner.burnSubtitles(input, burnAssPath, output);
    logger.success(`🎉 Subtitled video rendered: ${output}`);
  } catch (err: any) {
    logger.error(`Subtitle burning failed: ${err.message}`);
    process.exit(1);
  }
}
