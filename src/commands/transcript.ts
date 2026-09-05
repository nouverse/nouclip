import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { removeQuietly } from '@/commands/extract';
import type { WordTimestamp } from '@/core/ass';
import { config } from '@/core/config';
import { FFmpegRunner } from '@/core/ffmpeg';
import {
  TRANSCRIPT_FORMATS,
  type TranscriptData,
  isTranscriptFormat,
  renderTranscript
} from '@/core/transcript';
import { WhisperClient } from '@/core/whisper';
import { CliError, getErrorMessage } from '@/utils/errors';
import { logger } from '@/utils/logger';
import { resolveMediaInput } from '@/utils/path';

export interface TranscriptCommandOptions {
  format?: string;
  lang?: string;
  output?: string;
}

export async function transcriptCommand(
  videoOrJsonPath: string,
  options: TranscriptCommandOptions = {}
) {
  config.ensureDirs();

  const input = resolveMediaInput(videoOrJsonPath);
  if (!existsSync(input)) {
    throw new CliError(`File not found: ${videoOrJsonPath} (Checked: ${input})`);
  }

  const format = (options.format || 'txt').toLowerCase();
  if (!isTranscriptFormat(format)) {
    throw new CliError(
      `Unknown transcript format "${options.format}". Expected one of: ${TRANSCRIPT_FORMATS.join(', ')}.`
    );
  }

  const baseName = basename(input, extname(input));
  const data = await loadTranscript(input, baseName, options.lang || 'id');

  if (data.words.length === 0) {
    throw new CliError(`No words found in transcript: ${input}`);
  }

  const outPath = options.output
    ? resolve(options.output)
    : join(config.transcriptDir, `${baseName}_transcript.${format}`);

  writeFileSync(outPath, renderTranscript(data, format, input), 'utf-8');
  logger.success(`Transcript exported (${format.toUpperCase()}): ${outPath}`);
}

async function loadTranscript(
  input: string,
  baseName: string,
  language: string
): Promise<TranscriptData> {
  if (input.endsWith('.json')) {
    logger.info(`Loading transcript from JSON: ${input}`);
    try {
      const raw = JSON.parse(readFileSync(input, 'utf-8')) as Partial<TranscriptData>;
      return {
        words: (raw.words ?? []) as WordTimestamp[],
        text: raw.text,
        duration: raw.duration
      };
    } catch (err) {
      throw new CliError(`Could not read transcript JSON ${input}: ${getErrorMessage(err)}`);
    }
  }

  logger.info(`Extracting and transcribing ${input}...`);
  const tempWav = join(config.segmentDir, `${baseName}.temp.wav`);

  try {
    await FFmpegRunner.extractAudio(input, tempWav);
    return await WhisperClient.transcribe(tempWav, { language });
  } finally {
    removeQuietly(tempWav);
  }
}
