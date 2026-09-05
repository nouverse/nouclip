import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { ASSGenerator, type SubtitleStylePreset, type WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import { CliError, getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export interface SubtitleCommandOptions {
  timestamps?: string;
  sub?: string;
  style?: string;
  fontSize?: string;
  primaryColor?: string;
  highlightColor?: string;
  bgm?: string;
  bgmVolume?: string;
  ducking?: boolean;
  output?: string;
}

/** Reads `{ words: [...] }` from a Whisper JSON export. */
export function readWordsFromJson(jsonPath: string): WordTimestamp[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } catch (err) {
    throw new CliError(`Could not read timestamps JSON ${jsonPath}: ${getErrorMessage(err)}`);
  }

  const words = (raw as { words?: WordTimestamp[] })?.words;
  if (!Array.isArray(words) || words.length === 0) {
    throw new CliError(`No words found in timestamps JSON: ${jsonPath}`);
  }
  return words;
}

export async function subtitleCommand(videoPath: string, options: SubtitleCommandOptions = {}) {
  config.ensureDirs();

  const input = resolveMediaInput(videoPath);
  if (!existsSync(input)) {
    throw new CliError(`Video file not found: ${videoPath} (Checked: ${input})`);
  }

  const subInput = options.sub || options.timestamps;
  if (!subInput) {
    throw new CliError(
      'Must provide a subtitle file via --sub <file.ass|file.json> or --timestamps <file.json>'
    );
  }

  const subPath = resolveMediaInput(subInput);
  if (!existsSync(subPath)) {
    throw new CliError(`Subtitle file not found: ${subInput} (Checked: ${subPath})`);
  }

  const baseName = basename(input, extname(input));
  let burnAssPath = subPath;

  // A JSON word-timestamps file is compiled into ASS first.
  if (subPath.endsWith('.json')) {
    logger.info(`Compiling word timestamps from ${subPath} into ASS styling...`);
    const words = readWordsFromJson(subPath);

    const assContent = ASSGenerator.generateKineticASS(words, {
      style: (options.style || 'default') as SubtitleStylePreset,
      fontSize: parseFontSize(options.fontSize),
      primaryColor: options.primaryColor,
      highlightColor: options.highlightColor
    });

    burnAssPath = join(config.transcriptDir, `${baseName}.kinetic.ass`);
    writeFileSync(burnAssPath, assContent, 'utf-8');
    logger.success(
      `Generated kinetic subtitle ASS [style=${options.style || 'default'}]: ${burnAssPath}`
    );
  }

  const intermediateOutput = options.bgm
    ? join(config.segmentDir, `${baseName}_subtitled.temp.mp4`)
    : options.output
      ? resolve(options.output)
      : join(config.outputDir, `${baseName}_subtitled.mp4`);

  logger.info(`Burning subtitle (${burnAssPath}) into ${intermediateOutput}...`);
  await FFmpegRunner.burnSubtitles(input, burnAssPath, intermediateOutput);

  let finalOutput = intermediateOutput;

  if (options.bgm) {
    const bgmPath = resolveMediaInput(options.bgm);
    if (!existsSync(bgmPath)) {
      throw new CliError(`BGM audio file not found: ${options.bgm} (Checked: ${bgmPath})`);
    }

    finalOutput = options.output
      ? resolve(options.output)
      : join(config.outputDir, `${baseName}_subtitled.mp4`);

    logger.info(`Mixing BGM audio with sidechain ducking into ${finalOutput}...`);
    const bgmVol = options.bgmVolume ? Number.parseFloat(options.bgmVolume) : 0.1;
    await FFmpegRunner.mixBgm(intermediateOutput, bgmPath, finalOutput, {
      bgmVolume: Number.isFinite(bgmVol) ? bgmVol : 0.1,
      ducking: options.ducking !== false
    });
  }

  logger.success(`🎉 Subtitled video rendered: ${finalOutput}`);
}

/** Parses `--font-size`, rejecting values that would produce unreadable ASS. */
export function parseFontSize(value: string | undefined, fallback = 60): number {
  if (value === undefined) return fallback;
  const size = Number.parseInt(value, 10);
  if (!Number.isFinite(size) || size <= 0) {
    throw new CliError(`Invalid --font-size "${value}": expected a positive number.`);
  }
  return size;
}
